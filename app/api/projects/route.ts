export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";

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

    const [fromEntries, fromMonths] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { userId, orgId, deletedAt: null, projectId: { not: null } },
        select: { projectId: true },
        distinct: ["projectId"],
      }),
      prisma.customerMonth.findMany({
        where: { userId, orgId, projectId: { not: null } },
        select: { projectId: true },
        distinct: ["projectId"],
      }),
    ]);
    const visibleIds = Array.from(
      new Set([...fromEntries.map((e) => e.projectId), ...fromMonths.map((m) => m.projectId)].filter((id): id is string => !!id))
    );
    if (visibleIds.length === 0) return NextResponse.json({ projects: [] });

    const projects = await prisma.project.findMany({
      where: { orgId, id: { in: visibleIds }, ...(customerId ? { customerId } : {}) },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ projects: projects ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { customerId, name, hourlyRate, budgetHours } = body ?? {};

    const trimmedName = name?.trim?.();
    if (!trimmedName) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    if (!customerId) return NextResponse.json({ error: "Kunde fehlt" }, { status: 400 });

    const customer = await prisma.customer.findFirst({ where: { id: customerId, orgId } });
    if (!customer) return NextResponse.json({ error: "Ungültiger Kunde" }, { status: 400 });

    const existing = await prisma.project.findFirst({ where: { orgId, customerId, name: trimmedName } });
    if (existing) return NextResponse.json({ error: "Projekt existiert bereits für diesen Kunden" }, { status: 409 });

    const parsedRate = hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "" ? Number(hourlyRate) : null;
    const parsedBudget = budgetHours !== undefined && budgetHours !== null && budgetHours !== "" ? Number(budgetHours) : null;
    if (parsedRate !== null && (isNaN(parsedRate) || parsedRate < 0)) {
      return NextResponse.json({ error: "Ungültiger Stundensatz" }, { status: 400 });
    }
    if (parsedBudget !== null && (isNaN(parsedBudget) || parsedBudget < 0)) {
      return NextResponse.json({ error: "Ungültiges Budget" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: { orgId, customerId, name: trimmedName, hourlyRate: parsedRate, budgetHours: parsedBudget },
    });

    return NextResponse.json({ project });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, name, hourlyRate, budgetHours, active } = body ?? {};

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
    if (active !== undefined) updateData.active = Boolean(active);

    const project = await prisma.project.update({ where: { id }, data: updateData });

    return NextResponse.json({ project });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.project.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // TimeEntry.projectId ist onDelete: SetNull — bereits erfasste Stunden
    // bleiben erhalten, verlieren nur die Projektzuordnung.
    await prisma.project.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
