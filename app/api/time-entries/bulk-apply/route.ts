export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Start 08:00, 30min Pause ab 6h Tagesstunden — liefert von/bis für "arbeit"-Einträge
function buildArbeitszeit(hours: number): { von: string; bis: string; pauseMin: number } {
  const pauseMin = hours >= 6 ? 30 : 0;
  const startMinutes = 8 * 60;
  const endMinutes = Math.min(23 * 60 + 59, startMinutes + Math.round(hours * 60) + pauseMin);
  const bh = Math.floor(endMinutes / 60);
  const bm = endMinutes % 60;
  return {
    von: "08:00",
    bis: `${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`,
    pauseMin,
  };
}

// Wochentag-Index (0=So, 1=Mo, ... 6=Sa) → Template-Key
function getTemplateHoursForDay(date: Date, tpl: {
  mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number;
}): number {
  const d = date.getUTCDay();
  switch (d) {
    case 1: return tpl.mon;
    case 2: return tpl.tue;
    case 3: return tpl.wed;
    case 4: return tpl.thu;
    case 5: return tpl.fri;
    case 6: return tpl.sat;
    case 0: return tpl.sun;
    default: return 0;
  }
}

function parseDateYMD(s: string): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1]);
  const mo = parseInt(m[2]);
  const d = parseInt(m[3]);
  if (!y || !mo || !d) return null;
  // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
  // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC auf den falschen Tag verschieben.
  return new Date(Date.UTC(y, mo - 1, d));
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const fromStr = body?.fromDate ?? "";
    const toStr = body?.toDate ?? "";
    const overwriteExisting = Boolean(body?.overwriteExisting ?? false);

    const fromDate = parseDateYMD(fromStr);
    const toDate = parseDateYMD(toStr);
    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }
    if (toDate < fromDate) {
      return NextResponse.json({ error: "Enddatum liegt vor Startdatum" }, { status: 400 });
    }

    // Limit: max. 366 Tage pro Aufruf (ein Jahr)
    const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 366) {
      return NextResponse.json({ error: "Zeitraum zu gross (max. 366 Tage)" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const tpl = {
      mon: user.stdHoursMon ?? 0,
      tue: user.stdHoursTue ?? 0,
      wed: user.stdHoursWed ?? 0,
      thu: user.stdHoursThu ?? 0,
      fri: user.stdHoursFri ?? 0,
      sat: user.stdHoursSat ?? 0,
      sun: user.stdHoursSun ?? 0,
    };

    // Prüfen, ob das Template überhaupt Stunden enthält
    const tplSum = tpl.mon + tpl.tue + tpl.wed + tpl.thu + tpl.fri + tpl.sat + tpl.sun;
    if (tplSum <= 0) {
      return NextResponse.json({ error: "Standardwoche ist leer. Bitte zuerst im Profil hinterlegen." }, { status: 400 });
    }

    // Bestehende Einträge im Zielzeitraum laden
    const existing = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: fromDate, lte: toDate } },
      select: { id: true, date: true, type: true },
    });
    const existingMap = new Map<string, { id: string; type: string }>();
    for (const e of existing) {
      const d = new Date(e.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      existingMap.set(key, { id: e.id, type: e.type });
    }

    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedZero = 0;
    let skippedProtected = 0; // Ferien/Feiertage werden nie überschrieben

    const current = new Date(fromDate);
    const operations: Prisma.PrismaPromise<any>[] = [];

    while (current <= toDate) {
      const hours = getTemplateHoursForDay(current, tpl);
      const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
      // UTC-Grenzen: siehe parseDateYMD oben.
      const dbDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));

      if (hours <= 0) {
        skippedZero++;
      } else {
        const ex = existingMap.get(key);
        if (ex) {
          // Ferien/Feiertage immer schützen
          if (ex.type === "ferien" || ex.type === "feiertag") {
            skippedProtected++;
          } else if (!overwriteExisting) {
            skippedExisting++;
          } else {
            const { von, bis, pauseMin } = buildArbeitszeit(hours);
            operations.push(
              prisma.timeEntry.update({
                where: { id: ex.id },
                data: { type: "arbeit", von, bis, pauseMin, hours: null },
              })
            );
            updated++;
          }
        } else {
          const { von, bis, pauseMin } = buildArbeitszeit(hours);
          operations.push(
            prisma.timeEntry.create({
              data: { userId, date: dbDate, type: "arbeit", von, bis, pauseMin, hours: null },
            })
          );
          created++;
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Alle Operationen atomar in einer Transaktion ausführen
    if (operations.length > 0) {
      await prisma.$transaction(operations);
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      skippedExisting,
      skippedZero,
      skippedProtected,
      totalDays: diffDays,
    });
  } catch (error: any) {
    console.error("bulk-apply error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
