export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { diffTimeEntryFields } from "@/lib/audit";

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
    const { userId, orgId, role } = await requireOrg();

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
      where: { userId, orgId, deletedAt: null, date: { gte: fromDate, lte: toDate } },
      select: { id: true, date: true, type: true, hours: true },
    });
    const existingMap = new Map<string, { id: string; type: string; hours: number | null }>();
    for (const e of existing) {
      const d = new Date(e.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      existingMap.set(key, { id: e.id, type: e.type, hours: e.hours });
    }

    // Gesperrte Monate für member read-only (MIGRATION.md Punkt 6e) — als Set
    // vorab geladen statt pro Tag eine Query, da ein Zeitraum bis zu 366 Tage
    // umfassen kann.
    const lockedMonths = role === "member"
      ? new Set(
          (await prisma.monthLock.findMany({ where: { orgId, userId }, select: { year: true, month: true } }))
            .map((l) => `${l.year}-${l.month}`)
        )
      : new Set<string>();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const current = new Date(fromDate);
    // entryId → alt/neu für den Audit-Trail bei Updates (MIGRATION.md Punkt
    // 6b) — Erstellungen werden nicht auditiert, nur Änderungen bestehender
    // Einträge, siehe lib/audit.ts.
    type PlannedUpdate = { id: string; before: { type: string; hours: number | null }; after: { type: string; hours: number } };
    const creates: Array<{ date: Date; hours: number }> = [];
    const updatesToApply: PlannedUpdate[] = [];

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

      // Gesperrter Monat: für member wie ein Feiertag/Ferien-Tag überspringen
      // statt den ganzen Aufruf abzulehnen — der Rest des Zeitraums bleibt so
      // nutzbar, auch wenn er über eine Monatsgrenze in einen gesperrten
      // Monat hineinreicht.
      if (lockedMonths.has(`${current.getUTCFullYear()}-${current.getUTCMonth() + 1}`)) {
        skipped++;
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
          updatesToApply.push({ id: ex.id, before: { type: ex.type, hours: ex.hours }, after: { type: "ferien", hours } });
          updated++;
        }
      } else {
        creates.push({ date: dbDate, hours });
        created++;
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Alle Operationen atomar in einer Transaktion ausführen, inkl.
    // Audit-Trail für jedes Update (MIGRATION.md Punkt 6b).
    if (creates.length > 0 || updatesToApply.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          for (const c of creates) {
            await tx.timeEntry.create({ data: { userId, orgId, date: c.date, hours: c.hours, type: "ferien" } });
          }
          for (const u of updatesToApply) {
            await tx.timeEntry.update({ where: { id: u.id }, data: u.after });
            const changes = diffTimeEntryFields(u.before, u.after);
            if (changes.length > 0) {
              await tx.timeEntryAudit.createMany({
                data: changes.map((c) => ({ entryId: u.id, orgId, changedBy: userId, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
              });
            }
          }
        },
        { timeout: 30000 }
      );
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
