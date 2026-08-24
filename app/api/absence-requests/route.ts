export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, canSeeUser, listVisibleUserIds, assertMonthEditable, AccessError } from "@/lib/access";
import { createAbsenceEntries } from "@/lib/absence-entries";
import type { EintragTyp } from "@/lib/calc";
import { logError } from "@/lib/error-log";

// Absenzanträge dürfen nur für tatsächliche Absenztypen gestellt werden —
// nicht "arbeit" (keine Absenz) oder "feiertag" (organisationsweiter Fakt
// aus Punkt 6c, kein persönlicher Antrag).
const ABSENCE_TYPES: EintragTyp[] = ["ferien", "krank", "militaer", "unbezahlt"];

function parseDateYMD(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function serialize(r: any) {
  return {
    id: r.id,
    userId: r.userId,
    name: r.user ? `${r.user.firstName} ${r.user.lastName}` : undefined,
    fromDate: r.fromDate.toISOString().split("T")[0],
    toDate: r.toDate.toISOString().split("T")[0],
    type: r.type,
    status: r.status,
    comment: r.comment,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// scope=mine (Standard): eigene Anträge, jede Rolle. scope=team: nur
// owner/admin/manager — Anträge der SICHTBAREN Mitglieder (dieselbe
// Hierarchie wie /api/team), ohne den eigenen Antrag (das ist die
// Genehmigungs-Warteschlange, kein "alles"-Feed).
export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, userId, role } = ctx;

    const url = new URL(req.url);
    const scope = url?.searchParams?.get?.("scope") ?? "mine";

    if (scope === "team") {
      requireRole(role, ["owner", "admin", "manager"]);
      const visibleUserIds = await listVisibleUserIds(ctx);
      // Eigenen Antrag ausschliessen — das ist die Genehmigungs-
      // Warteschlange für ANDERE, kein "alles inkl. mir selbst"-Feed.
      const visibilityFilter = visibleUserIds
        ? { userId: { in: visibleUserIds.filter((id) => id !== userId) } }
        : { userId: { not: userId } };
      const requests = await prisma.absenceRequest.findMany({
        where: { orgId, ...visibilityFilter },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ requests: requests.map(serialize) });
    }

    const requests = await prisma.absenceRequest.findMany({
      where: { orgId, userId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ requests: requests.map(serialize) });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET absence-requests error:", error);
    await logError("GET /api/absence-requests", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Self-service: jede Rolle darf für sich selbst einen Antrag stellen (auch
// admin/owner/manager brauchen Ferien). userId kommt aus der Session, nicht
// aus dem Body — gleiches Prinzip wie /api/time-entries.
export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { fromDate: fromStr, toDate: toStr, type, comment } = body ?? {};

    const fromDate = parseDateYMD(fromStr);
    const toDate = parseDateYMD(toStr);
    if (!fromDate || !toDate) return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    if (toDate < fromDate) return NextResponse.json({ error: "Enddatum liegt vor Startdatum" }, { status: 400 });
    if (!ABSENCE_TYPES.includes(type)) return NextResponse.json({ error: "Ungültiger Absenztyp" }, { status: 400 });

    // Ein Antrag für einen bereits gesperrten Monat wäre ohnehin sinnlos —
    // dieselbe Regel wie direkte TimeEntry-Mutationen (Punkt 6e), hier schon
    // beim Stellen des Antrags geprüft statt erst bei der Genehmigung.
    await assertMonthEditable(orgId, userId, role, fromDate);
    await assertMonthEditable(orgId, userId, role, toDate);

    const created = await prisma.absenceRequest.create({
      data: { orgId, userId, fromDate, toDate, type, comment: comment?.trim?.() || null },
    });

    return NextResponse.json({ request: serialize(created) });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST absence-requests error:", error);
    await logError("POST /api/absence-requests", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// action=approve|reject — nur owner/admin/manager, und nur für sichtbare
// Mitglieder (canSeeUser), nicht für den eigenen Antrag (Selbst-Genehmigung
// wäre eine Rechteausweitung, dieselbe Vorsicht wie bei den
// Team-Schutzregeln in Punkt 4c).
export async function PATCH(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, userId: actorId, role } = ctx;
    requireRole(role, ["owner", "admin", "manager"]);

    const body = await req?.json?.().catch(() => ({}));
    const { id, action, comment } = body ?? {};
    if (!id || (action !== "approve" && action !== "reject")) {
      return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
    }

    const existing = await prisma.absenceRequest.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "offen") return NextResponse.json({ error: "Antrag wurde bereits entschieden" }, { status: 400 });
    if (existing.userId === actorId) return NextResponse.json({ error: "Eigener Antrag kann nicht selbst entschieden werden" }, { status: 403 });
    if (!(await canSeeUser(ctx, existing.userId))) throw new AccessError(403, "Forbidden");

    if (action === "reject") {
      const updated = await prisma.absenceRequest.update({
        where: { id },
        data: { status: "abgelehnt", decidedBy: actorId, decidedAt: new Date(), comment: comment?.trim?.() || existing.comment },
      });
      return NextResponse.json({ request: serialize(updated) });
    }

    // action === "approve": TimeEntries erzeugen (lib/absence-entries.ts,
    // wiederverwendete bulk-vacation-Kernlogik) — kein skipDates/Monatssperre
    // nötig, da nur manager/admin/owner genehmigen und diese Rollen laut
    // Punkt 6e ohnehin nicht durch eine Sperre eingeschränkt sind.
    let result;
    try {
      result = await createAbsenceEntries({
        orgId,
        userId: existing.userId,
        changedBy: actorId,
        fromDate: existing.fromDate,
        toDate: existing.toDate,
        type: existing.type as EintragTyp,
      });
    } catch (e: any) {
      if (e?.message === "Membership not found") return NextResponse.json({ error: "Membership not found" }, { status: 404 });
      throw e;
    }

    const updated = await prisma.absenceRequest.update({
      where: { id },
      data: { status: "genehmigt", decidedBy: actorId, decidedAt: new Date(), comment: comment?.trim?.() || existing.comment },
    });

    return NextResponse.json({ request: serialize(updated), entries: result });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PATCH absence-requests error:", error);
    await logError("PATCH /api/absence-requests", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Zurückziehen — nur die antragstellende Person selbst, nur solange der
// Antrag noch offen ist (ein bereits entschiedener Antrag ist ein
// nachvollziehbarer Vorgang, kein Entwurf mehr).
export async function DELETE(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.absenceRequest.findFirst({ where: { id, orgId, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "offen") return NextResponse.json({ error: "Bereits entschiedene Anträge können nicht zurückgezogen werden" }, { status: 400 });

    await prisma.absenceRequest.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE absence-requests error:", error);
    await logError("DELETE /api/absence-requests", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
