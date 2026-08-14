// Gemeinsame Kernlogik zum Erzeugen von Absenz-TimeEntries für alle
// Werktage in einem Zeitraum — extrahiert aus
// app/api/time-entries/bulk-vacation/route.ts (MIGRATION.md Punkt 9: "Bei
// Genehmigung werden die TimeEntries automatisch erzeugt (bestehende
// bulk-vacation-Logik wiederverwenden)"). Zwei Aufrufer:
//   - bulk-vacation selbst (member-Self-Service, immer type="ferien")
//   - die Genehmigung eines AbsenceRequest (beliebiger Absenztyp, ausgeführt
//     von der genehmigenden Person, nicht vom Antragsteller)
// Kein pure-lib wie lib/calc.ts (braucht Prisma) — lebt deshalb hier statt
// dort.

import { prisma } from "@/lib/db";
import { diffTimeEntryFields } from "@/lib/audit";
import type { EintragTyp } from "@/lib/calc";

export interface CreateAbsenceEntriesResult {
  created: number;
  updated: number;
  skipped: number;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function createAbsenceEntries(params: {
  orgId: string;
  userId: string;
  // Person, die die Erstellung auslöst — für den Audit-Trail bei Updates
  // (bei einer Genehmigung: die genehmigende Person, nicht der Antragsteller).
  changedBy: string;
  fromDate: Date;
  toDate: Date;
  type: EintragTyp;
  overwriteExisting?: boolean;
  // Zusätzlich zu überspringende Tage ("YYYY-MM-DD", UTC) — z.B. gesperrte
  // Monate für member (MIGRATION.md Punkt 6e), die der Aufrufer selbst
  // ermittelt, weil diese Logik rollenabhängig ist und nicht in diese
  // generische Funktion gehört.
  skipDates?: Set<string>;
}): Promise<CreateAbsenceEntriesResult> {
  const { orgId, userId, changedBy, fromDate, toDate, type, overwriteExisting = false, skipDates } = params;

  const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!membership) throw new Error("Membership not found");

  const pensumChanges = await prisma.pensumChange.findMany({ where: { userId, orgId }, orderBy: { effectiveFrom: "asc" } });

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
    return (effectiveWeeklyHours * effectivePensum) / 100 / 5;
  }

  const existing = await prisma.timeEntry.findMany({
    where: { userId, orgId, deletedAt: null, date: { gte: fromDate, lte: toDate } },
    select: { id: true, date: true, type: true, hours: true },
  });
  const existingMap = new Map<string, { id: string; type: string; hours: number | null }>();
  for (const e of existing) {
    existingMap.set(dateKey(new Date(e.date)), { id: e.id, type: e.type, hours: e.hours });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  type PlannedUpdate = { id: string; before: { type: string; hours: number | null }; after: { type: string; hours: number } };
  const creates: Array<{ date: Date; hours: number }> = [];
  const updatesToApply: PlannedUpdate[] = [];

  const current = new Date(fromDate);
  while (current <= toDate) {
    const dayOfWeek = current.getUTCDay();
    const key = dateKey(current);
    const dbDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }

    if (skipDates?.has(key)) {
      skipped++;
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }

    const hours = Math.round(getDailyRateForDate(current) * 100) / 100;

    const ex = existingMap.get(key);
    if (ex) {
      // Feiertage werden nie überschrieben; ein bereits vorhandener Eintrag
      // desselben Typs ist idempotent (nichts zu tun).
      if (ex.type === "feiertag" || ex.type === type) {
        skipped++;
      } else if (!overwriteExisting) {
        skipped++;
      } else {
        updatesToApply.push({ id: ex.id, before: { type: ex.type, hours: ex.hours }, after: { type, hours } });
        updated++;
      }
    } else {
      creates.push({ date: dbDate, hours });
      created++;
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Alle Operationen atomar in einer Transaktion ausführen, inkl.
  // Audit-Trail für jedes Update (MIGRATION.md Punkt 6b) — Erstellungen
  // werden bewusst nicht auditiert (siehe lib/audit.ts).
  if (creates.length > 0 || updatesToApply.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const c of creates) {
          await tx.timeEntry.create({ data: { userId, orgId, date: c.date, hours: c.hours, type } });
        }
        for (const u of updatesToApply) {
          await tx.timeEntry.update({ where: { id: u.id }, data: u.after });
          const changes = diffTimeEntryFields(u.before, u.after);
          if (changes.length > 0) {
            await tx.timeEntryAudit.createMany({
              data: changes.map((c) => ({ entryId: u.id, orgId, changedBy, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
            });
          }
        }
      },
      { timeout: 30000 }
    );
  }

  return { created, updated, skipped };
}
