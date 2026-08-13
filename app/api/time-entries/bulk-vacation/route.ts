export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import type { Prisma } from "@prisma/client";

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
    const { userId, orgId } = await requireOrg();

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

    const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 366) {
      return NextResponse.json({ error: "Zeitraum zu gross (max. 366 Tage)" }, { status: 400 });
    }

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    // Fetch pensum changes for accurate daily rate
    const pensumChanges = await prisma.pensumChange.findMany({
      where: { userId, orgId },
      orderBy: { effectiveFrom: "asc" },
    });

    function getDailyRateForDate(date: Date): number {
      let effectivePensum = membership?.basePensum ?? membership?.pensum ?? 100;
      let effectiveWeeklyHours = membership?.baseWeeklyHours ?? membership?.weeklyHours ?? 42;
      for (const change of pensumChanges) {
        const changeDate = new Date(change.effectiveFrom);
        if (changeDate <= date) {
          effectivePensum = change.pensum;
          effectiveWeeklyHours = change.weeklyHours;
        }
      }
      return (effectiveWeeklyHours * effectivePensum / 100) / 5;
    }

    // Load existing entries in the range
    const existing = await prisma.timeEntry.findMany({
      where: { userId, orgId, date: { gte: fromDate, lte: toDate } },
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
    let skipped = 0;

    const current = new Date(fromDate);
    const operations: Prisma.PrismaPromise<any>[] = [];

    while (current <= toDate) {
      const dayOfWeek = current.getUTCDay();
      const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
      // UTC-Grenzen: siehe parseDateYMD oben.
      const dbDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));

      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        current.setUTCDate(current.getUTCDate() + 1);
        continue;
      }

      const hours = Math.round(getDailyRateForDate(current) * 100) / 100;

      const ex = existingMap.get(key);
      if (ex) {
        // Never overwrite holidays
        if (ex.type === "feiertag") {
          skipped++;
        } else if (ex.type === "ferien") {
          // Already vacation — skip
          skipped++;
        } else if (!overwriteExisting) {
          skipped++;
        } else {
          operations.push(
            prisma.timeEntry.update({
              where: { id: ex.id },
              data: { hours, type: "ferien" },
            })
          );
          updated++;
        }
      } else {
        operations.push(
          prisma.timeEntry.create({
            data: { userId, orgId, date: dbDate, hours, type: "ferien" },
          })
        );
        created++;
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
      skipped,
      totalDays: diffDays,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("bulk-vacation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
