export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";

export async function GET() {
  try {
    const { userId, orgId } = await requireOrg();

    const changes = await prisma.pensumChange.findMany({
      where: { userId, orgId },
      orderBy: { effectiveFrom: "asc" },
    });

    return NextResponse.json({ changes: changes ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { pensum, weeklyHours, effectiveFrom } = body ?? {};

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
      const membership = await tx.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
      if (membership && (membership.basePensum === null || membership.baseWeeklyHours === null)) {
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            basePensum: membership.basePensum ?? membership.pensum,
            baseWeeklyHours: membership.baseWeeklyHours ?? membership.weeklyHours,
          },
        });
      }

      const newChange = await tx.pensumChange.create({
        data: {
          userId,
          orgId,
          pensum: parsedPensum,
          weeklyHours: parsedWeeklyHours,
          effectiveFrom: new Date(effectiveFrom),
        },
      });

      // Aktuelles Pensum auf den neusten Wert setzen
      const latestChange = await tx.pensumChange.findFirst({
        where: { userId, orgId },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latestChange) {
        await tx.membership.update({
          where: { orgId_userId: { orgId, userId } },
          data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
        });
      }

      return newChange;
    });

    return NextResponse.json({ change });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.pensumChange.findFirst({ where: { id, userId, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.pensumChange.delete({ where: { id } });

    // Membership auf das neuste verbleibende Pensum setzen
    const latestChange = await prisma.pensumChange.findFirst({
      where: { userId, orgId },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latestChange) {
      await prisma.membership.update({
        where: { orgId_userId: { orgId, userId } },
        data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
      });
    } else {
      // Keine Änderungen mehr vorhanden: ursprüngliche Werte wiederherstellen
      const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
