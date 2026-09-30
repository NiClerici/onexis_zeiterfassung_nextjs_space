// Gemeinsame Hilfsfunktionen für Kundenstunden (verrechenbare Arbeitszeit
// pro Kunde). Ursprünglich (Betrieb.md-Nachtrag, 18.08.2026) monatlich über
// ein eigenes Modell (CustomerMonth) erfasst; seit dem Nachtrag "Projekt-
// stunden pro Tag" wird die Zuordnung wieder am einzelnen TimeEntry über
// projectId/customerId gepflegt (siehe components/day-entry-dialog.tsx).
//
// Drei Quellen fliessen zusammen (Betrieb.md-Nachtrag 20.08.2026):
//
// 1. Laufende Tageserfassung: TimeEntry mit countsAsWorktime=true — echte,
//    tagesgenaue Arbeitszeit.
// 2. CustomerMonth: manuell im Profil nacherfasste Monatssummen für
//    migrierte Altmonate.
// 3. Legacy-TimeEntry-Zeilen aus dem inzwischen entfernten Stundenrapport-
//    Import (Commit 751dd9b) — erkennbar an countsAsWorktime=false
//    (prisma/schema.prisma TimeEntry.countsAsWorktime). Bilden dieselbe
//    Migration ab wie CustomerMonth, nur in einem anderen Format.
//
// combineCustomerHours() addiert (1) mit dem GEWINNER aus (2)/(3) — niemals
// alle drei, sonst zählt ein migrierter Monat doppelt, sobald für ihn sowohl
// Legacy-Zeilen als auch ein manuell erfasster CustomerMonth-Wert existieren
// (das war der Bug: April–Juli hatten beides, wurden also verdoppelt).
// CustomerMonth gewinnt über Legacy, weil ein Abgleich mit den Original-
// Stundenrapporten zeigte, dass die Legacy-Zeilen unvollständig sein können
// (April: 96.75h Legacy vs. 102.75h im Rapport = 102.8h CustomerMonth) —
// Legacy ist nur noch Fallback für Monate, die nie manuell nacherfasst
// wurden. Die Auflösung läuft pro (userId, Jahr, Monat, Kunde), nicht nur
// pro Monat, damit zwei Kunden im selben Monat sich nicht gegenseitig
// verdecken.
//
// Für einen Zeitraum [from, to], der keine vollen Kalendermonate trifft
// (z.B. "custom"-Export vom 10. bis 20. eines Monats), werden die
// überlappenden Monate VOLL gezählt — das ist unscharf, aber die einzige
// Zahl, die sich aus Kalendermonaten hergibt. Aufrufer, die das anzeigen,
// sollten das entsprechend kennzeichnen (siehe app/(app)/team/page.tsx).

import { prisma } from "@/lib/db";
import { stundenAusEintrag } from "@/lib/calc";

export function monthsInRange(from: Date, to: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1; // 1-12
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

// Die bereits pro Kunde aufgelösten Summen für einen (userId, Jahr, Monat)-
// Schlüssel — siehe combineCustomerHours() für die Kombinationsregel.
// fromMigration ist selbst schon das Ergebnis von "CustomerMonth gewinnt
// über Legacy-TimeEntry-Zeilen" (siehe Modulkommentar), pro Kunde einzeln
// entschieden und über alle Kunden des Monats aufsummiert.
export interface MonthlyCustomerHours {
  fromEntries: number;
  fromMigration: number;
}

// Kombinationsregel: laufende Tageserfassung (fromEntries) plus Migration
// (fromMigration, bereits pro Kunde zwischen CustomerMonth und Legacy-
// TimeEntry-Zeilen aufgelöst — siehe Modulkommentar) — an dieser einzigen
// Stelle gekapselt, damit sie sich später ändern lässt, ohne jeden Aufrufer
// einzeln anzufassen.
export function combineCustomerHours(v: MonthlyCustomerHours): number {
  return v.fromEntries + v.fromMigration;
}

// Dreifach verschachtelte Summe: userId -> "Jahr-Monat" -> customerId ->
// Stunden. Gemeinsame Hilfsstruktur für die drei Rohquellen unten.
type NestedSums = Map<string, Map<string, Map<string, number>>>;

function addToNested(map: NestedSums, userId: string, monthKey: string, customerId: string, hours: number): void {
  const perMonth = map.get(userId) ?? new Map<string, Map<string, number>>();
  const perCustomer = perMonth.get(monthKey) ?? new Map<string, number>();
  perCustomer.set(customerId, (perCustomer.get(customerId) ?? 0) + hours);
  perMonth.set(monthKey, perCustomer);
  map.set(userId, perMonth);
}

// Lädt die drei Rohquellen (Modulkommentar 1.–3.) für [from, to] und
// gruppiert sie bereits nach (userId, Monat, Kunde) — die gemeinsame
// Grundlage für billableHoursByUserAndMonth() (Monats-Summen) und
// customerHoursByUserAndCustomer() (Kunden-Summen). Zwei Queries statt vier,
// unabhängig davon, wie viele Aufrufer die Auflösung brauchen.
async function loadCustomerHourSources(params: { orgId: string; userIds: string[]; from: Date; to: Date }): Promise<{
  months: { year: number; month: number }[];
  fromEntriesSums: NestedSums;
  legacySums: NestedSums;
  customerMonthSums: NestedSums;
}> {
  const { orgId, userIds, from, to } = params;
  const months = monthsInRange(from, to);
  const empty = { months, fromEntriesSums: new Map(), legacySums: new Map(), customerMonthSums: new Map() };
  if (userIds.length === 0 || months.length === 0) return empty;

  const monthStart = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
  const lastMonth = months[months.length - 1];
  const monthEnd = new Date(Date.UTC(lastMonth.year, lastMonth.month, 0));

  // Laufende Tageserfassung (countsAsWorktime=true) UND Legacy-Zeilen aus
  // dem entfernten Stundenrapport-Import (countsAsWorktime=false) getrennt
  // summieren, je (userId, Monat, Kunde) — siehe Modulkommentar, warum diese
  // Trennung nötig ist. "arbeit" braucht kein Tagessoll (stundenAusEintrag
  // rechnet für diesen Typ direkt aus von/bis/pauseMin bzw. hours), deshalb
  // genügt ein einzelnes Query ohne Pensum-/Feiertagsauflösung.
  const entries = await prisma.timeEntry.findMany({
    where: { orgId, userId: { in: userIds }, type: "arbeit", deletedAt: null, customerId: { not: null }, date: { gte: monthStart, lte: monthEnd } },
    select: { userId: true, date: true, von: true, bis: true, pauseMin: true, hours: true, customerId: true, countsAsWorktime: true },
  });
  const fromEntriesSums: NestedSums = new Map();
  const legacySums: NestedSums = new Map();
  for (const e of entries) {
    const d = new Date(e.date);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const stunden = stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0);
    const target = e.countsAsWorktime ? fromEntriesSums : legacySums;
    addToNested(target, e.userId, monthKey, e.customerId as string, stunden);
  }

  // CustomerMonth: manuell nacherfasste Migrationswerte, je (userId, Monat,
  // Kunde) — gewinnt über die Legacy-Zeilen desselben Kunden/Monats (siehe
  // Modulkommentar).
  const oldRows = await prisma.customerMonth.findMany({
    where: { orgId, userId: { in: userIds }, OR: months.map((mo) => ({ year: mo.year, month: mo.month })) },
  });
  const customerMonthSums: NestedSums = new Map();
  for (const r of oldRows) {
    addToNested(customerMonthSums, r.userId, `${r.year}-${r.month}`, r.customerId, r.hours);
  }

  return { months, fromEntriesSums, legacySums, customerMonthSums };
}

// Kundenstunden je (userId, Jahr, Monat) — die eigentliche, für alle
// Aufrufer (Teamsicht, Export, Analytics) gemeinsame Berechnung. Jede
// "arbeit"-Stunde mit Kunden-/Projektzuordnung zählt als "Kundenstunde" im
// Sinne von kennzahlen().verrechnungsgrad (Betrieb.md-Nachtrag, 19.08.2026 —
// vorher gab es zusätzlich einen "billable"-Haken pro Kunde/Eintrag, der
// entfiel, weil die Zuordnung selbst schon die einzig relevante Aussage ist).
// Liefert die bereits kombinierten Summen zurück (siehe MonthlyCustomerHours)
// — Aufrufer, die nur die Gesamtsumme brauchen, nutzen combineCustomerHours()
// oder direkt sumCustomerHours()/sumCustomerHoursByUser() unten.
export async function billableHoursByUserAndMonth(params: {
  orgId: string;
  userIds: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, Map<string, MonthlyCustomerHours>>> {
  const { userIds } = params;
  const result = new Map<string, Map<string, MonthlyCustomerHours>>();
  if (userIds.length === 0) return result;
  const { months, fromEntriesSums, legacySums, customerMonthSums } = await loadCustomerHourSources(params);
  if (months.length === 0) return result;

  for (const userId of userIds) {
    const perMonth = new Map<string, MonthlyCustomerHours>();
    for (const mo of months) {
      const monthKey = `${mo.year}-${mo.month}`;
      const fromEntriesByCustomer = fromEntriesSums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const legacyByCustomer = legacySums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const customerMonthByCustomer = customerMonthSums.get(userId)?.get(monthKey) ?? new Map<string, number>();

      let fromEntries = 0;
      for (const h of fromEntriesByCustomer.values()) fromEntries += h;

      // Pro Kunde einzeln auflösen: CustomerMonth gewinnt über Legacy, sonst
      // würden sich zwei Kunden im selben Monat gegenseitig verdecken.
      const customerIds = new Set([...legacyByCustomer.keys(), ...customerMonthByCustomer.keys()]);
      let fromMigration = 0;
      for (const customerId of customerIds) {
        const cm = customerMonthByCustomer.get(customerId) ?? 0;
        const legacy = legacyByCustomer.get(customerId) ?? 0;
        fromMigration += cm > 0 ? cm : legacy;
      }

      perMonth.set(monthKey, { fromEntries, fromMigration });
    }
    result.set(userId, perMonth);
  }
  return result;
}

// Kundenstunden je (userId, Kunde), über [from, to] überlappende Monate
// summiert — dieselbe Auflösungsregel wie billableHoursByUserAndMonth()
// (CustomerMonth gewinnt über Legacy, pro Kunde einzeln), nur nach Kunde
// statt nach Monat aggregiert. Grundlage für die Kunden-Aufschlüsselung in
// der Teamsicht (app/api/team/route.ts) — vorher zeigte die dortige
// Kundentabelle AUSSCHLIESSLICH CustomerMonth-Migrationswerte, die laufende
// Tageserfassung (fromEntries) fehlte komplett.
export async function customerHoursByUserAndCustomer(params: {
  orgId: string;
  userIds: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, Map<string, number>>> {
  const { userIds } = params;
  const result = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return result;
  const { months, fromEntriesSums, legacySums, customerMonthSums } = await loadCustomerHourSources(params);
  if (months.length === 0) return result;

  for (const userId of userIds) {
    const perCustomer = new Map<string, number>();
    for (const mo of months) {
      const monthKey = `${mo.year}-${mo.month}`;
      const fromEntriesByCustomer = fromEntriesSums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const legacyByCustomer = legacySums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const customerMonthByCustomer = customerMonthSums.get(userId)?.get(monthKey) ?? new Map<string, number>();

      for (const [customerId, h] of fromEntriesByCustomer) {
        perCustomer.set(customerId, (perCustomer.get(customerId) ?? 0) + h);
      }
      // Pro Kunde einzeln auflösen: CustomerMonth gewinnt über Legacy (siehe
      // Modulkommentar bzw. billableHoursByUserAndMonth() oben).
      const customerIds = new Set([...legacyByCustomer.keys(), ...customerMonthByCustomer.keys()]);
      for (const customerId of customerIds) {
        const cm = customerMonthByCustomer.get(customerId) ?? 0;
        const legacy = legacyByCustomer.get(customerId) ?? 0;
        const fromMigration = cm > 0 ? cm : legacy;
        perCustomer.set(customerId, (perCustomer.get(customerId) ?? 0) + fromMigration);
      }
    }
    result.set(userId, perCustomer);
  }
  return result;
}

// Dieselbe Drei-Quellen-Kombination wie loadCustomerHourSources() oben, nur
// nach Projekt statt nach Kunde gruppiert — Grundlage für die Projektsicht
// im Team-Hub (app/api/team/route.ts). Eigene, schlanke Funktion statt einer
// Erweiterung von loadCustomerHourSources(): die dort gefilterten
// TimeEntry-Zeilen (customerId not null) sind nicht automatisch dieselben
// wie die hier gebrauchten (projectId not null) — ein Direktkunde ohne
// Projekt hat z.B. eine customerId, aber nie eine projectId.
async function loadProjectHourSources(params: { orgId: string; userIds: string[]; from: Date; to: Date }): Promise<{
  months: { year: number; month: number }[];
  fromEntriesSums: NestedSums;
  legacySums: NestedSums;
  customerMonthSums: NestedSums;
}> {
  const { orgId, userIds, from, to } = params;
  const months = monthsInRange(from, to);
  const empty = { months, fromEntriesSums: new Map(), legacySums: new Map(), customerMonthSums: new Map() };
  if (userIds.length === 0 || months.length === 0) return empty;

  const monthStart = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
  const lastMonth = months[months.length - 1];
  const monthEnd = new Date(Date.UTC(lastMonth.year, lastMonth.month, 0));

  const entries = await prisma.timeEntry.findMany({
    where: { orgId, userId: { in: userIds }, type: "arbeit", deletedAt: null, projectId: { not: null }, date: { gte: monthStart, lte: monthEnd } },
    select: { userId: true, date: true, von: true, bis: true, pauseMin: true, hours: true, projectId: true, countsAsWorktime: true },
  });
  const fromEntriesSums: NestedSums = new Map();
  const legacySums: NestedSums = new Map();
  for (const e of entries) {
    const d = new Date(e.date);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const stunden = stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0);
    const target = e.countsAsWorktime ? fromEntriesSums : legacySums;
    addToNested(target, e.userId, monthKey, e.projectId as string, stunden);
  }

  const oldRows = await prisma.customerMonth.findMany({
    where: { orgId, userId: { in: userIds }, projectId: { not: null }, OR: months.map((mo) => ({ year: mo.year, month: mo.month })) },
  });
  const customerMonthSums: NestedSums = new Map();
  for (const r of oldRows) {
    if (!r.projectId) continue;
    addToNested(customerMonthSums, r.userId, `${r.year}-${r.month}`, r.projectId, r.hours);
  }

  return { months, fromEntriesSums, legacySums, customerMonthSums };
}

// Projektstunden je (userId, Projekt), über [from, to] überlappende Monate
// summiert — dieselbe Auflösungsregel wie customerHoursByUserAndCustomer()
// (CustomerMonth gewinnt über Legacy, pro Projekt einzeln), nur nach Projekt
// aggregiert. Ersetzt die frühere Projektsicht im Team-Hub, die
// ausschliesslich CustomerMonth-Zeilen zeigte: täglich über
// TimeEntry.projectId erfasste Projektstunden (seit dem Nachtrag
// "Projektstunden pro Tag") fehlten dort komplett.
export async function projectHoursByUserAndProject(params: {
  orgId: string;
  userIds: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, Map<string, number>>> {
  const { userIds } = params;
  const result = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return result;
  const { months, fromEntriesSums, legacySums, customerMonthSums } = await loadProjectHourSources(params);
  if (months.length === 0) return result;

  for (const userId of userIds) {
    const perProject = new Map<string, number>();
    for (const mo of months) {
      const monthKey = `${mo.year}-${mo.month}`;
      const fromEntriesByProject = fromEntriesSums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const legacyByProject = legacySums.get(userId)?.get(monthKey) ?? new Map<string, number>();
      const customerMonthByProject = customerMonthSums.get(userId)?.get(monthKey) ?? new Map<string, number>();

      for (const [projectId, h] of fromEntriesByProject) {
        perProject.set(projectId, (perProject.get(projectId) ?? 0) + h);
      }
      const projectIds = new Set([...legacyByProject.keys(), ...customerMonthByProject.keys()]);
      for (const projectId of projectIds) {
        const cm = customerMonthByProject.get(projectId) ?? 0;
        const legacy = legacyByProject.get(projectId) ?? 0;
        const fromMigration = cm > 0 ? cm : legacy;
        perProject.set(projectId, (perProject.get(projectId) ?? 0) + fromMigration);
      }
    }
    result.set(userId, perProject);
  }
  return result;
}

// Kundenstunden EINER Person, über [from, to] überlappende Monate summiert.
export async function sumCustomerHours(params: { orgId: string; userId: string; from: Date; to: Date }): Promise<number> {
  const map = await sumCustomerHoursByUser({ orgId: params.orgId, userIds: [params.userId], from: params.from, to: params.to });
  return map.get(params.userId) ?? 0;
}

// Batched Variante für mehrere Personen auf einmal (Teamsicht) — ein
// Query-Paar statt eines pro Person, gleiches Muster wie die übrigen Batch-
// Queries in app/api/team/route.ts (HARDENING.md B4).
export async function sumCustomerHoursByUser(params: { orgId: string; userIds: string[]; from: Date; to: Date }): Promise<Map<string, number>> {
  const perMonth = await billableHoursByUserAndMonth(params);
  const result = new Map<string, number>();
  for (const [userId, monthly] of perMonth) {
    result.set(userId, [...monthly.values()].reduce((s, v) => s + combineCustomerHours(v), 0));
  }
  return result;
}
