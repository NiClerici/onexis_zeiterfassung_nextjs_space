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
import { sollStundenTag } from "@/lib/calc";
import type { EintragTyp, Profil, PensumChangeInput, HolidayInput } from "@/lib/calc";

export interface CreateAbsenceEntriesResult {
  created: number;
  updated: number;
  skipped: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Baut das Profil, das sollStundenTag/pensumAt (lib/calc.ts) erwarten, aus
// einer Membership mit geladener Organisation — dieselbe Feldzuordnung wie
// buildProfil in lib/export-helpers.ts, hier separat gehalten, damit dieses
// Modul nicht den ExcelJS-Import der Export-Helfer mitschleppt.
function profilFromMembership(membership: { basePensum: number | null; pensum: number; baseWeeklyHours: number | null; weeklyHours: number; startDate: Date | null; exitDate: Date | null; vacationDays: number; org: { maxWeeklyHours: number } }): Profil {
  return {
    pensum: membership.basePensum ?? membership.pensum,
    wochenstunden: membership.baseWeeklyHours ?? membership.weeklyHours,
    startDate: membership.startDate,
    exitDate: membership.exitDate,
    ferientage: membership.vacationDays,
    maxWeeklyHours: membership.org.maxWeeklyHours,
  };
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

  const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
  if (!membership) throw new Error("Membership not found");

  const pensumChangeRows = await prisma.pensumChange.findMany({ where: { userId, orgId }, orderBy: { effectiveFrom: "asc" } });
  const holidayRows = await prisma.holiday.findMany({ where: { orgId } });

  // Kanonische Berechnung aus lib/calc.ts statt einer eigenen Kopie der
  // Pensum-Auflösung — berücksichtigt dadurch auch Feiertage (ein
  // Ferientag, der auf einen Feiertag fällt, bekam vorher fälschlich die
  // volle Tagesrate statt 0/halb).
  const profil = profilFromMembership(membership);
  const changes: PensumChangeInput[] = pensumChangeRows.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
  const holidays: HolidayInput[] = holidayRows.map((h) => ({ date: h.date, halfDay: h.halfDay }));

  function getDailyRateForDate(date: Date): number {
    return sollStundenTag(date, profil, changes, holidays);
  }

  const existing = await prisma.timeEntry.findMany({
    where: { userId, orgId, deletedAt: null, date: { gte: fromDate, lte: toDate } },
    select: { id: true, date: true, type: true, hours: true },
  });
  // Array pro Tag statt einer einzelnen Zeile — ein Tag kann mehrere Zeilen
  // haben (z.B. auf mehrere Projekte aufgeteilte Arbeitszeit). Ohne das
  // würde beim Überschreiben nur die zuletzt in der Liste stehende Zeile
  // umgebaut und alle übrigen Zeilen desselben Tages blieben als
  // Karteileichen neben dem neuen Absenz-Eintrag liegen.
  const existingMap = new Map<string, { id: string; type: string; hours: number | null }[]>();
  for (const e of existing) {
    const key = dateKey(new Date(e.date));
    const list = existingMap.get(key) ?? [];
    list.push({ id: e.id, type: e.type, hours: e.hours });
    existingMap.set(key, list);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  type PlannedUpdate = { id: string; before: { type: string; hours: number | null }; after: { type: string; hours: number } };
  type PlannedDelete = { id: string; before: { type: string; hours: number | null } };
  const creates: Array<{ date: Date; hours: number }> = [];
  const updatesToApply: PlannedUpdate[] = [];
  const deletesToApply: PlannedDelete[] = [];

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

    const exList = existingMap.get(key) ?? [];
    if (exList.length === 0) {
      creates.push({ date: dbDate, hours });
      created++;
    } else if (exList.some((e) => e.type === "feiertag" || e.type === type)) {
      // Feiertage werden nie überschrieben; ein bereits vorhandener Eintrag
      // desselben Typs ist idempotent (nichts zu tun) — beides gilt, sobald
      // IRGENDEINE Zeile des Tages das erfüllt, auch wenn daneben noch
      // andere Zeilen (z.B. Projektaufteilung) liegen.
      skipped++;
    } else if (!overwriteExisting) {
      skipped++;
    } else {
      // Erste Zeile zum Absenztyp umbauen, alle weiteren Zeilen desselben
      // Tages (z.B. mehrere Projekt-Zeilen) weich löschen statt sie als
      // Karteileiche neben dem neuen Absenz-Eintrag liegen zu lassen.
      const [first, ...rest] = exList;
      updatesToApply.push({ id: first.id, before: { type: first.type, hours: first.hours }, after: { type, hours } });
      for (const extra of rest) {
        deletesToApply.push({ id: extra.id, before: { type: extra.type, hours: extra.hours } });
      }
      updated++;
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Alle Operationen atomar in einer Transaktion ausführen, inkl.
  // Audit-Trail für jedes Update/Löschen (MIGRATION.md Punkt 6b) —
  // Erstellungen werden bewusst nicht auditiert (siehe lib/audit.ts).
  if (creates.length > 0 || updatesToApply.length > 0 || deletesToApply.length > 0) {
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
        // Zeitgleich mit dem Umbau der ersten Zeile: überzählige Zeilen
        // desselben Tages (Projektaufteilung) weich löschen — gleiches
        // Muster wie DELETE /api/time-entries (app/api/time-entries/route.ts).
        for (const d of deletesToApply) {
          const deletedAt = new Date();
          await tx.timeEntry.update({ where: { id: d.id }, data: { deletedAt } });
          await tx.timeEntryAudit.create({
            data: { entryId: d.id, orgId, changedBy, field: "deletedAt", oldValue: null, newValue: deletedAt.toISOString() },
          });
        }
      },
      { timeout: 30000 }
    );
  }

  return { created, updated, skipped };
}

export interface RecomputeAbsenceHoursResult {
  updated: number;
  skipped: number;
}

// Bugfix (Betrieb.md/FOLLOWUP-Nachtrag): Absenz-Einträge (alles ausser
// "arbeit") speichern ihre Stunden als festen Wert beim Anlegen. Eine
// rückwirkende PensumChange ändert diesen Wert bisher nie, wodurch sowohl
// die Anzeige als auch feriensaldo() (lib/calc.ts) mit veralteten Zahlen
// rechnen. Wird nach jedem Anlegen/Löschen einer PensumChange aufgerufen
// (app/api/pensum-changes/route.ts).
//
// Ein Eintrag gilt nur dann als automatisch erzeugt und wird aktualisiert,
// wenn sein gespeicherter Stundenwert exakt dem Tagessoll VOR dieser
// Änderung entsprach. Weicht er ab, hat jemand von Hand einen abweichenden
// Wert eingetragen (z.B. ein halber Ferientag) — dieser Eintrag bleibt
// unangetastet, damit die Neuberechnung keine bewussten Korrekturen
// stillschweigend überschreibt. "unbezahlt" wird ausgenommen: dessen
// Stunden werden von stundenAusEintrag ohnehin immer als 0 behandelt
// (lib/calc.ts), eine Neuberechnung hätte keinen sichtbaren Effekt.
export async function recomputeAbsenceHours(params: {
  orgId: string;
  userId: string;
  // Person, die die PensumChange angelegt/gelöscht hat — für den Audit-Trail.
  changedBy: string;
  // PensumChange-Stand unmittelbar VOR der auslösenden Änderung.
  previousChanges: PensumChangeInput[];
  // PensumChange-Stand NACH der auslösenden Änderung.
  currentChanges: PensumChangeInput[];
}): Promise<RecomputeAbsenceHoursResult> {
  const { orgId, userId, changedBy, previousChanges, currentChanges } = params;

  const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
  if (!membership) return { updated: 0, skipped: 0 };

  const holidayRows = await prisma.holiday.findMany({ where: { orgId } });
  const holidays: HolidayInput[] = holidayRows.map((h) => ({ date: h.date, halfDay: h.halfDay }));
  const profil = profilFromMembership(membership);

  const entries = await prisma.timeEntry.findMany({
    where: { orgId, userId, deletedAt: null, type: { notIn: ["arbeit", "unbezahlt"] } },
    select: { id: true, date: true, hours: true },
  });
  if (entries.length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const entry of entries) {
        const oldSoll = round2(sollStundenTag(entry.date, profil, previousChanges, holidays));
        const newSoll = round2(sollStundenTag(entry.date, profil, currentChanges, holidays));

        if (oldSoll === newSoll) { skipped++; continue; }
        if (entry.hours === null || Math.abs(entry.hours - oldSoll) > 0.005) { skipped++; continue; }

        await tx.timeEntry.update({ where: { id: entry.id }, data: { hours: newSoll } });
        const changes = diffTimeEntryFields({ hours: entry.hours }, { hours: newSoll });
        if (changes.length > 0) {
          await tx.timeEntryAudit.createMany({
            data: changes.map((c) => ({ entryId: entry.id, orgId, changedBy, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
          });
        }
        updated++;
      }
    },
    { timeout: 30000 }
  );

  return { updated, skipped };
}
