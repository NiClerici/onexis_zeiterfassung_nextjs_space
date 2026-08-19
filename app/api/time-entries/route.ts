export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EINTRAG_TYPEN, type EintragTyp } from "@/lib/calc";
import { requireOrg, assertMonthEditable, AccessError } from "@/lib/access";
import { diffTimeEntryFields } from "@/lib/audit";

function isValidType(type: unknown): type is EintragTyp {
  return typeof type === "string" && (EINTRAG_TYPEN as readonly string[]).includes(type);
}

// Nimmt nur "YYYY-MM-DD" (führender Teil, Rest wird ignoriert) und baut UTC-Mitternacht.
// new Date(date) auf einem vollen ISO-Datetime ohne Offset würde lokal statt UTC
// interpretiert und könnte auf einem Server mit TZ≠UTC den Tag verschieben.
function parseDateYMD(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

// Löst customerId/projectId auf und liefert das für neue/geänderte Zeilen
// passende billable-Default. Ein Projekt gehört immer zu genau einem Kunden
// (Project.customerId ist required) — ist projectId gesetzt, gewinnt dessen
// customerId gegenüber einer abweichend mitgeschickten customerId, damit die
// beiden Felder nie auseinanderlaufen.
async function resolveProjectAndCustomer(
  orgId: string,
  projectId: unknown,
  customerId: unknown
): Promise<{ projectId: string | null; customerId: string | null; defaultBillable: boolean } | { error: string }> {
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId as string, orgId } });
    if (!project) return { error: "Invalid project" };
    const customer = await prisma.customer.findUnique({ where: { id: project.customerId } });
    return { projectId: project.id, customerId: project.customerId, defaultBillable: customer?.billable ?? false };
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId as string, orgId } });
    if (!customer) return { error: "Invalid customer" };
    return { projectId: null, customerId: customer.id, defaultBillable: customer.billable };
  }
  return { projectId: null, customerId: null, defaultBillable: false };
}

export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const url = new URL(req.url);
    const year = parseInt(url?.searchParams?.get?.("year") ?? "0");
    const month = parseInt(url?.searchParams?.get?.("month") ?? "0");

    if (!year || !month) return NextResponse.json({ entries: [] });

    // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
    // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC den letzten Tag der Periode abschneiden.
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));

    const entries = await prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } },
      orderBy: [{ date: "asc" }, { von: "asc" }],
    });

    return NextResponse.json({
      entries: entries?.map?.((e: any) => ({
        id: e?.id,
        date: e?.date?.toISOString?.()?.split?.("T")?.[0] ?? "",
        type: e?.type ?? "arbeit",
        von: e?.von ?? null,
        bis: e?.bis ?? null,
        pauseMin: e?.pauseMin ?? 0,
        notiz: e?.notiz ?? null,
        customerId: e?.customerId ?? null,
        projectId: e?.projectId ?? null,
        billable: e?.billable ?? false,
        hours: e?.hours ?? null,
      })) ?? [],
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { date, type, von, bis, pauseMin, notiz, customerId, projectId, billable, hours } = body ?? {};

    const parsedDate = parseDateYMD(date);
    if (!parsedDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!isValidType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    await assertMonthEditable(orgId, userId, role, parsedDate);

    const resolved = await resolveProjectAndCustomer(orgId, projectId, customerId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

    const isArbeit = type === "arbeit";
    const clampedPause = Math.max(0, Math.min(1440, Number(pauseMin) || 0));
    const clampedHours = hours != null && hours !== "" ? Math.max(0, Math.min(24, Number(hours))) : null;
    const resolvedBillable = billable !== undefined ? Boolean(billable) : resolved.defaultBillable;

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        orgId,
        date: parsedDate,
        type,
        von: isArbeit ? (von || null) : null,
        bis: isArbeit ? (bis || null) : null,
        pauseMin: isArbeit ? clampedPause : 0,
        notiz: notiz?.trim?.() || null,
        customerId: resolved.customerId,
        projectId: resolved.projectId,
        billable: resolvedBillable,
        hours: clampedHours,
      },
    });

    return NextResponse.json({ entry });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, date, type, von, bis, pauseMin, notiz, customerId, projectId, billable, hours } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let parsedDate: Date | undefined;
    if (date) {
      const p = parseDateYMD(date);
      if (!p) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      parsedDate = p;
    }
    if (type !== undefined && !isValidType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    // Sowohl der bisherige als auch ein neu gesetzter Monat müssen entsperrt
    // sein — sonst liesse sich eine gesperrte Zeile durch Verschieben des
    // Datums umgehen, oder ein Eintrag unbemerkt in einen gesperrten Monat
    // hinein verschieben (MIGRATION.md Punkt 6e).
    await assertMonthEditable(orgId, userId, role, existing.date);
    if (parsedDate) await assertMonthEditable(orgId, userId, role, parsedDate);

    // projectId/customerId nur neu auflösen, wenn mindestens eines der beiden
    // Felder im Request mitkommt — sonst bleiben beide unangetastet.
    let nextCustomerId: string | null | undefined = undefined;
    let nextProjectId: string | null | undefined = undefined;
    let defaultBillable = existing.billable;
    if (projectId !== undefined || customerId !== undefined) {
      const resolved = await resolveProjectAndCustomer(orgId, projectId, customerId);
      if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
      nextCustomerId = resolved.customerId;
      nextProjectId = resolved.projectId;
      defaultBillable = resolved.defaultBillable;
    }

    const nextType: EintragTyp = isValidType(type) ? type : (existing.type as EintragTyp);
    const isArbeit = nextType === "arbeit";
    const clampedHours =
      hours !== undefined ? (hours === null || hours === "" ? null : Math.max(0, Math.min(24, Number(hours)))) : undefined;

    // Vollständig aufgelöster Zielzustand — Basis sowohl für das Update als
    // auch für den Feld-Diff gegen "existing" (MIGRATION.md Punkt 6b). Felder,
    // die nicht mitgeschickt wurden, fallen auf den bestehenden Wert zurück,
    // damit der Diff nur tatsächliche Änderungen sieht, keine Prisma-"undefined
    // heisst unverändert"-Semantik.
    const nextState = {
      date: parsedDate ?? existing.date,
      type: nextType,
      von: isArbeit ? (von !== undefined ? von || null : existing.von) : null,
      bis: isArbeit ? (bis !== undefined ? bis || null : existing.bis) : null,
      pauseMin: isArbeit
        ? pauseMin !== undefined
          ? Math.max(0, Math.min(1440, Number(pauseMin) || 0))
          : existing.pauseMin
        : 0,
      notiz: notiz !== undefined ? notiz?.trim?.() || null : existing.notiz,
      customerId: nextCustomerId !== undefined ? nextCustomerId : existing.customerId,
      projectId: nextProjectId !== undefined ? nextProjectId : existing.projectId,
      billable: billable !== undefined ? Boolean(billable) : defaultBillable,
      hours: clampedHours !== undefined ? clampedHours : existing.hours,
    };
    const changes = diffTimeEntryFields(existing, nextState);

    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.timeEntry.update({ where: { id }, data: nextState });
      if (changes.length > 0) {
        await tx.timeEntryAudit.createMany({
          data: changes.map((c) => ({ entryId: id, orgId, changedBy: userId, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
        });
      }
      return updated;
    });

    return NextResponse.json({ entry });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertMonthEditable(orgId, userId, role, existing.date);

    // Soft-Delete statt Hard-Delete (MIGRATION.md Punkt 6b) — die gesetzliche
    // Aufbewahrungspflicht von 5 Jahren verlangt, dass gelöschte Einträge
    // rekonstruierbar bleiben.
    const deletedAt = new Date();
    await prisma.$transaction([
      prisma.timeEntry.update({ where: { id }, data: { deletedAt } }),
      prisma.timeEntryAudit.create({
        data: { entryId: id, orgId, changedBy: userId, field: "deletedAt", oldValue: null, newValue: deletedAt.toISOString() },
      }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
