export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { recomputeAbsenceHours } from "@/lib/absence-entries";
import type { PensumChangeInput } from "@/lib/calc";

function toPensumChangeInput(rows: { effectiveFrom: Date; pensum: number; weeklyHours: number }[]): PensumChangeInput[] {
  return rows.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
}

// Ein userId-Parameter erlaubt owner/admin, Pensumsänderungen für ANDERE
// Personen zu verwalten (MIGRATION.md Punkt 4c, /admin/team). Ohne Parameter
// oder mit der eigenen userId verhält sich die Route wie zuvor (Selbstbedienung
// über /profile). Fremde userId ohne ausreichende Rolle wird abgewiesen.
async function resolveTargetUserId(orgId: string, callerUserId: string, callerRole: string, requestedUserId: unknown): Promise<string> {
  const targetUserId = typeof requestedUserId === "string" && requestedUserId ? requestedUserId : callerUserId;
  if (targetUserId !== callerUserId) {
    requireRole(callerRole as any, ["owner", "admin"]);
    const targetMembership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
    if (!targetMembership) throw new AccessError(404, "Membership not found");
  }
  return targetUserId;
}

export async function GET(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();
    const url = new URL(req.url);
    const targetUserId = await resolveTargetUserId(orgId, userId, role, url.searchParams.get("userId"));

    const changes = await prisma.pensumChange.findMany({
      where: { userId: targetUserId, orgId },
      orderBy: { effectiveFrom: "asc" },
    });

    return NextResponse.json({ changes: changes ?? [] });
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
    const { pensum, weeklyHours, effectiveFrom } = body ?? {};
    const targetUserId = await resolveTargetUserId(orgId, userId, role, body?.userId);

    if (pensum === undefined || weeklyHours === undefined || !effectiveFrom) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const parsedPensum = parseFloat(pensum);
    const parsedWeeklyHours = parseFloat(weeklyHours);
    if (isNaN(parsedPensum) || parsedPensum <= 0 || parsedPensum > 500) {
      return NextResponse.json({ error: "Ungültiges Pensum (1–500%)" }, { status: 400 });
    }
    if (isNaN(parsedWeeklyHours) || parsedWeeklyHours <= 0 || parsedWeeklyHours > 80) {
      return NextResponse.json({ error: "Ungültige Wochenstunden (1–80h)" }, { status: 400 });
    }
    if (isNaN(new Date(effectiveFrom).getTime())) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }

    // Alle DB-Operationen atomar ausführen, um Race Conditions zu vermeiden
    const change = await prisma.$transaction(async (tx) => {
      // Vor der ersten Pensumsänderung: aktuelle Membership-Werte als historische
      // Basis sichern. Sonst würde die spätere Überschreibung von
      // membership.pensum rückwirkend auf alle Tage vor dem "Gültig ab"-Datum wirken.
      const membership = await tx.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
      if (membership && (membership.basePensum === null || membership.baseWeeklyHours === null)) {
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            basePensum: membership.basePensum ?? membership.pensum,
            baseWeeklyHours: membership.baseWeeklyHours ?? membership.weeklyHours,
          },
        });
      }

      // Stand VOR der neuen Änderung — Basis für recomputeAbsenceHours
      // unten, damit sich erkennen lässt, welche Absenz-Einträge noch das
      // alte (automatisch berechnete) Tagessoll trugen.
      const previousChangeRows = await tx.pensumChange.findMany({
        where: { userId: targetUserId, orgId },
        orderBy: { effectiveFrom: "asc" },
      });

      const newChange = await tx.pensumChange.create({
        data: {
          userId: targetUserId,
          orgId,
          pensum: parsedPensum,
          weeklyHours: parsedWeeklyHours,
          effectiveFrom: new Date(effectiveFrom),
        },
      });

      // Aktuelles Pensum auf den neusten Wert setzen
      const latestChange = await tx.pensumChange.findFirst({
        where: { userId: targetUserId, orgId },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latestChange) {
        await tx.membership.update({
          where: { orgId_userId: { orgId, userId: targetUserId } },
          data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
        });
      }

      return { newChange, previousChangeRows, targetUserId };
    });

    // Ausserhalb der Transaktion: bestehende Absenz-Einträge, deren
    // gespeicherte Stunden noch das alte (automatisch berechnete) Tagessoll
    // trugen, auf das neue Pensum nachziehen (Bugfix: Ferien-Einträge, die
    // vor einer rückwirkenden Pensumsänderung angelegt wurden, zeigten
    // sonst dauerhaft die alte Stundenzahl — auch im Feriensaldo).
    const recompute = await recomputeAbsenceHours({
      orgId,
      userId: change.targetUserId,
      changedBy: userId,
      previousChanges: toPensumChangeInput(change.previousChangeRows),
      currentChanges: toPensumChangeInput([...change.previousChangeRows, change.newChange]),
    });

    return NextResponse.json({ change: change.newChange, recompute });
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

    const existing = await prisma.pensumChange.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // existing.userId ist die tatsächliche Zielperson — nicht aus dem Body
    // vertrauen, sonst könnte eine falsche userId im Body die Berechtigungs-
    // prüfung umgehen.
    const targetUserId = existing.userId;
    if (targetUserId !== userId) {
      requireRole(role, ["owner", "admin"]);
    }

    // Stand VOR dem Löschen — für recomputeAbsenceHours unten.
    const previousChangeRows = await prisma.pensumChange.findMany({
      where: { userId: targetUserId, orgId },
      orderBy: { effectiveFrom: "asc" },
    });

    await prisma.pensumChange.delete({ where: { id } });

    // Membership auf das neuste verbleibende Pensum setzen
    const latestChange = await prisma.pensumChange.findFirst({
      where: { userId: targetUserId, orgId },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latestChange) {
      await prisma.membership.update({
        where: { orgId_userId: { orgId, userId: targetUserId } },
        data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
      });
    } else {
      // Keine Änderungen mehr vorhanden: ursprüngliche Werte wiederherstellen
      const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
      if (m && (m.basePensum !== null || m.baseWeeklyHours !== null)) {
        await prisma.membership.update({
          where: { id: m.id },
          data: {
            pensum: m.basePensum ?? m.pensum,
            weeklyHours: m.baseWeeklyHours ?? m.weeklyHours,
            basePensum: null,
            baseWeeklyHours: null,
          },
        });
      }
    }

    // Absenz-Einträge nachziehen, deren Stunden noch das (jetzt entfallene)
    // Pensum trugen — spiegelbildlich zu POST oben.
    const currentChangeRows = previousChangeRows.filter((c) => c.id !== id);
    const recompute = await recomputeAbsenceHours({
      orgId,
      userId: targetUserId,
      changedBy: userId,
      previousChanges: toPensumChangeInput(previousChangeRows),
      currentChanges: toPensumChangeInput(currentChangeRows),
    });

    return NextResponse.json({ success: true, recompute });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
