export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";

const VALID_ROLES = ["owner", "admin", "manager", "member"];
const VALID_STATUS = ["aktiv", "inaktiv"];

// Nur owner/admin verwalten die Mitgliederliste — Rollen ändern und
// deaktivieren ist eine administrative Handlung, keine Team-Übersicht
// (die bekommt manager in Punkt 8 als eigene, engere Sicht).
export async function GET() {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const memberships = await prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      members: memberships.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
        status: m.status,
        managerId: m.managerId,
        entryDate: m.entryDate,
        exitDate: m.exitDate,
        weeklyHours: m.weeklyHours,
        pensum: m.pensum,
        vacationDays: m.vacationDays,
        startDate: m.startDate,
        standardWeek: {
          mon: m.stdHoursMon, tue: m.stdHoursTue, wed: m.stdHoursWed, thu: m.stdHoursThu,
          fri: m.stdHoursFri, sat: m.stdHoursSat, sun: m.stdHoursSun,
        },
      })),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET admin/team error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId, userId: actingUserId, role: actingRole } = await requireOrg();
    requireRole(actingRole, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const { userId: targetUserId, role, status, managerId, entryDate, exitDate, weeklyHours, pensum, vacationDays, startDate, standardWeek } = body ?? {};

    if (!targetUserId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    const target = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updateData: any = {};

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Ungültige Rolle" }, { status: 400 });
      // Nur owner darf jemanden zum owner machen — admin könnte sich sonst
      // selbst zum owner hochstufen und die Rollenhierarchie umgehen.
      if (role === "owner" && actingRole !== "owner") {
        return NextResponse.json({ error: "Nur owner kann die owner-Rolle vergeben" }, { status: 403 });
      }
      if (target.role === "owner" && role !== "owner") {
        const ownerCount = await prisma.membership.count({ where: { orgId, role: "owner" } });
        if (ownerCount <= 1) return NextResponse.json({ error: "Der letzte owner kann nicht degradiert werden" }, { status: 400 });
      }
      updateData.role = role;
    }

    if (status !== undefined) {
      if (!VALID_STATUS.includes(status)) return NextResponse.json({ error: "Ungültiger Status" }, { status: 400 });
      if (targetUserId === actingUserId && status === "inaktiv") {
        return NextResponse.json({ error: "Du kannst dich nicht selbst deaktivieren" }, { status: 400 });
      }
      if (target.role === "owner" && status === "inaktiv") {
        const activeOwnerCount = await prisma.membership.count({ where: { orgId, role: "owner", status: "aktiv" } });
        if (activeOwnerCount <= 1) return NextResponse.json({ error: "Der letzte aktive owner kann nicht deaktiviert werden" }, { status: 400 });
      }
      updateData.status = status;
    }

    if (managerId !== undefined) {
      if (managerId === null) {
        updateData.managerId = null;
      } else {
        if (managerId === target.id) return NextResponse.json({ error: "Kann nicht die eigene Vorgesetzte Person sein" }, { status: 400 });
        const managerMembership = await prisma.membership.findFirst({ where: { id: managerId, orgId } });
        if (!managerMembership) return NextResponse.json({ error: "Ungültige Vorgesetzte Person" }, { status: 400 });
        updateData.managerId = managerId;
      }
    }

    if (entryDate !== undefined) updateData.entryDate = new Date(entryDate);
    if (exitDate !== undefined) updateData.exitDate = exitDate ? new Date(exitDate) : null;
    if (weeklyHours !== undefined) updateData.weeklyHours = weeklyHours;
    if (pensum !== undefined) updateData.pensum = pensum;
    if (vacationDays !== undefined) updateData.vacationDays = vacationDays;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;

    const clampDay = (v: any) => Math.max(0, Math.min(24, Number(v) || 0));
    if (standardWeek && typeof standardWeek === "object") {
      if (standardWeek.mon !== undefined) updateData.stdHoursMon = clampDay(standardWeek.mon);
      if (standardWeek.tue !== undefined) updateData.stdHoursTue = clampDay(standardWeek.tue);
      if (standardWeek.wed !== undefined) updateData.stdHoursWed = clampDay(standardWeek.wed);
      if (standardWeek.thu !== undefined) updateData.stdHoursThu = clampDay(standardWeek.thu);
      if (standardWeek.fri !== undefined) updateData.stdHoursFri = clampDay(standardWeek.fri);
      if (standardWeek.sat !== undefined) updateData.stdHoursSat = clampDay(standardWeek.sat);
      if (standardWeek.sun !== undefined) updateData.stdHoursSun = clampDay(standardWeek.sun);
    }

    await prisma.membership.update({ where: { id: target.id }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PUT admin/team error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
