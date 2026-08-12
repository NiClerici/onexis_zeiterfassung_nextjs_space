export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const changes = await prisma.pensumChange.findMany({
      where: { userId },
      orderBy: { effectiveFrom: "asc" },
    });

    return NextResponse.json({ changes: changes ?? [] });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

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
      // Vor der ersten Pensumsänderung: aktuelle Profilwerte als historische Basis sichern.
      // Sonst würde die spätere Überschreibung von user.pensum rückwirkend auf alle
      // Tage vor dem "Gültig ab"-Datum wirken.
      const currentUser = await tx.user.findUnique({ where: { id: userId } });
      if (currentUser && (currentUser.basePensum === null || currentUser.baseWeeklyHours === null)) {
        await tx.user.update({
          where: { id: userId },
          data: {
            basePensum: currentUser.basePensum ?? currentUser.pensum,
            baseWeeklyHours: currentUser.baseWeeklyHours ?? currentUser.weeklyHours,
          },
        });
      }

      const newChange = await tx.pensumChange.create({
        data: {
          userId,
          pensum: parsedPensum,
          weeklyHours: parsedWeeklyHours,
          effectiveFrom: new Date(effectiveFrom),
        },
      });

      // Aktuelles Profil auf den neusten Pensum-Wert setzen
      const latestChange = await tx.pensumChange.findFirst({
        where: { userId },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latestChange) {
        await tx.user.update({
          where: { id: userId },
          data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
        });
      }

      return newChange;
    });

    return NextResponse.json({ change });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.pensumChange.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.pensumChange.delete({ where: { id } });

    // Update user's current pensum to latest remaining change
    const latestChange = await prisma.pensumChange.findFirst({
      where: { userId },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latestChange) {
      await prisma.user.update({
        where: { id: userId },
        data: { pensum: latestChange.pensum, weeklyHours: latestChange.weeklyHours },
      });
    } else {
      // Keine Änderungen mehr vorhanden: ursprüngliche Werte wiederherstellen
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (u && (u.basePensum !== null || u.baseWeeklyHours !== null)) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            pensum: u.basePensum ?? u.pensum,
            weeklyHours: u.baseWeeklyHours ?? u.weeklyHours,
            basePensum: null,
            baseWeeklyHours: null,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
