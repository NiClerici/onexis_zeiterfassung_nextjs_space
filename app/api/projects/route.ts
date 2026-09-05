export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { logError } from "@/lib/error-log";
import { ownProjectsWhere } from "@/lib/visibility";
import { assertMayDelete, countProjectReferences, referenceCountsMessage } from "@/lib/entity-deletion";

// Projekte gehören wie Kunden der Organisation (MIGRATION.md Punkt 5) — kein
// Rollen-Gate für Anlegen/Pflegen, das darf jedes Mitglied. Beim Lesen
// (GET) gilt wie bei customers/route.ts: manager/admin/owner sehen alles,
// ein Mitglied nur Projekte, bei denen es selbst schon Stunden erfasst hat.
export async function GET(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();
    const url = new URL(req.url);
    const customerId = url.searchParams.get("customerId");

    if (role === "manager" || role === "admin" || role === "owner") {
      const projects = await prisma.project.findMany({
        where: { orgId, ...(customerId ? { customerId } : {}) },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({ projects: projects ?? [] });
    }

    // Sichtbarkeitsregel ausgelagert nach lib/visibility.ts — der
    // Stundenrapport-Export (app/api/export/stundenrapport) braucht dieselbe
    // Regel für seinen Projektkatalog.
    const ownFilter = await ownProjectsWhere(orgId, userId);
    const projects = await prisma.project.findMany({
      where: {
        orgId,
        ...ownFilter,
        ...(customerId ? { customerId } : {}),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ projects: projects ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("GET /api/projects", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { customerId, name, hourlyRate, budgetHours, externalRef } = body ?? {};

    const trimmedName = name?.trim?.();
    if (!trimmedName) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    if (!customerId) return NextResponse.json({ error: "Kunde fehlt" }, { status: 400 });

    const customer = await prisma.customer.findFirst({ where: { id: customerId, orgId } });
    if (!customer) return NextResponse.json({ error: "Ungültiger Kunde" }, { status: 400 });

    const existing = await prisma.project.findFirst({ where: { orgId, customerId, name: trimmedName } });
    if (existing) return NextResponse.json({ error: "Projekt existiert bereits für diesen Kunden" }, { status: 409 });

    const parsedRate = hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "" ? Number(hourlyRate) : null;
    const parsedBudget = budgetHours !== undefined && budgetHours !== null && budgetHours !== "" ? Number(budgetHours) : null;
    const trimmedExternalRef = externalRef?.trim?.() || null;
    if (parsedRate !== null && (isNaN(parsedRate) || parsedRate < 0)) {
      return NextResponse.json({ error: "Ungültiger Stundensatz" }, { status: 400 });
    }
    if (parsedBudget !== null && (isNaN(parsedBudget) || parsedBudget < 0)) {
      return NextResponse.json({ error: "Ungültiges Budget" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: { orgId, customerId, name: trimmedName, hourlyRate: parsedRate, budgetHours: parsedBudget, externalRef: trimmedExternalRef, createdBy: userId },
    });

    return NextResponse.json({ project });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("POST /api/projects", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, name, hourlyRate, budgetHours, externalRef, active } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.project.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trimmedName = name?.trim?.();
    if (trimmedName && trimmedName !== existing.name) {
      const duplicate = await prisma.project.findFirst({ where: { orgId, customerId: existing.customerId, name: trimmedName } });
      if (duplicate) return NextResponse.json({ error: "Projekt existiert bereits für diesen Kunden" }, { status: 409 });
    }

    const updateData: any = { name: trimmedName || existing.name };
    if (hourlyRate !== undefined) {
      const parsedRate = hourlyRate === null || hourlyRate === "" ? null : Number(hourlyRate);
      if (parsedRate !== null && (isNaN(parsedRate) || parsedRate < 0)) {
        return NextResponse.json({ error: "Ungültiger Stundensatz" }, { status: 400 });
      }
      updateData.hourlyRate = parsedRate;
    }
    if (budgetHours !== undefined) {
      const parsedBudget = budgetHours === null || budgetHours === "" ? null : Number(budgetHours);
      if (parsedBudget !== null && (isNaN(parsedBudget) || parsedBudget < 0)) {
        return NextResponse.json({ error: "Ungültiges Budget" }, { status: 400 });
      }
      updateData.budgetHours = parsedBudget;
    }
    if (externalRef !== undefined) {
      updateData.externalRef = externalRef === null || externalRef === "" ? null : String(externalRef).trim();
    }
    if (active !== undefined) updateData.active = Boolean(active);

    const project = await prisma.project.update({ where: { id }, data: updateData });

    return NextResponse.json({ project });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("PUT /api/projects", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.project.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // owner/admin dürfen jedes Projekt löschen, sonst nur die Person, die es
    // selbst angelegt hat (REVIEW_LOOP.md, Audit-Fund KRITISCH — dieselbe
    // Lücke wie bei /api/customers, hier per lib/entity-deletion.ts geteilt).
    assertMayDelete(role, existing.createdBy, userId);

    // Referenzsperre gilt für JEDE Rolle. TimeEntry.projectId ist zwar
    // onDelete: SetNull — bereits erfasste Stunden blieben also technisch
    // erhalten —, aber das Löschen soll trotzdem verhindert werden, solange
    // noch gebucht wurde, statt Stunden stillschweigend ihre Projektzuordnung
    // verlieren zu lassen.
    const refs = await countProjectReferences(orgId, id);
    if (refs.total > 0) {
      return NextResponse.json({ error: referenceCountsMessage("Projekt", refs) }, { status: 409 });
    }

    await prisma.project.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("DELETE /api/projects", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
