// Gemeinsame Hilfsfunktionen für Kundenstunden (verrechenbare Arbeitszeit
// pro Kunde). Ursprünglich (Betrieb.md-Nachtrag, 18.08.2026) monatlich über
// ein eigenes Modell (CustomerMonth) erfasst; seit dem Nachtrag "Projekt-
// stunden pro Tag" wird die Zuordnung wieder am einzelnen TimeEntry über
// projectId/customerId gepflegt (siehe components/day-entry-dialog.tsx).
//
// sumCustomerHours()/sumCustomerHoursByUser() liefern deshalb pro Monat die
// NEUE, aus TimeEntry berechnete Summe — fällt ein Monat dabei auf 0 UND
// existieren für ihn noch CustomerMonth-Zeilen (Altbestand, nie auf die
// Tagesebene nacherfasst), gilt für GENAU DIESEN Monat der alte Wert. Die
// Entscheidung läuft je (userId, Jahr, Monat), nicht über den ganzen
// angefragten Zeitraum — sonst würde ein einzelner bereits migrierter Monat
// mit 0 Kundenstunden fälschlich den Altwert eines ANDEREN Monats im selben
// Aufruf verdecken oder umgekehrt.
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

// Kundenstunden je (userId, Jahr, Monat) — die eigentliche, für alle
// Aufrufer (Teamsicht, Export, Analytics) gemeinsame Berechnung. Nur Stunden
// bei verrechenbaren Kunden zählen als "Kundenstunden" im Sinne von
// kennzahlen().verrechnungsgrad — dieselbe Bedeutung wie früher
// TimeEntry.billable, jetzt wieder direkt an TimeEntry.customerId/billable.
export async function billableHoursByUserAndMonth(params: {
  orgId: string;
  userIds: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, Map<string, number>>> {
  const { orgId, userIds, from, to } = params;
  const result = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return result;
  const months = monthsInRange(from, to);
  if (months.length === 0) return result;

  const monthStart = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));
  const lastMonth = months[months.length - 1];
  const monthEnd = new Date(Date.UTC(lastMonth.year, lastMonth.month, 0));

  // Neue Quelle: TimeEntry mit Kundenzuordnung eines verrechenbaren Kunden.
  // "arbeit" braucht kein Tagessoll (stundenAusEintrag rechnet für diesen
  // Typ direkt aus von/bis/pauseMin bzw. hours), deshalb genügt ein
  // einzelnes Query ohne Pensum-/Feiertagsauflösung.
  const entries = await prisma.timeEntry.findMany({
    where: { orgId, userId: { in: userIds }, type: "arbeit", deletedAt: null, customerId: { not: null }, date: { gte: monthStart, lte: monthEnd } },
    select: { userId: true, date: true, von: true, bis: true, pauseMin: true, hours: true, billable: true, customer: { select: { billable: true } } },
  });
  const neuByUserMonth = new Map<string, Map<string, number>>();
  for (const e of entries) {
    // billable ist am Tageseintrag überschreibbar (Tagesdialog) — Standard
    // aus dem Kunden-Flag, aber die konkrete Zeile entscheidet.
    if (!e.billable) continue;
    const d = new Date(e.date);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const stunden = stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0);
    const perMonth = neuByUserMonth.get(e.userId) ?? new Map<string, number>();
    perMonth.set(key, (perMonth.get(key) ?? 0) + stunden);
    neuByUserMonth.set(e.userId, perMonth);
  }

  // Alte Quelle: CustomerMonth, ausschliesslich als Fallback für Monate ohne
  // eigene TimeEntry-Summe (siehe Modulkommentar).
  const oldRows = await prisma.customerMonth.findMany({
    where: { orgId, userId: { in: userIds }, OR: months.map((mo) => ({ year: mo.year, month: mo.month })) },
    include: { customer: { select: { billable: true } } },
  });
  const altByUserMonth = new Map<string, Map<string, number>>();
  for (const r of oldRows) {
    if (!r.customer.billable) continue;
    const key = `${r.year}-${r.month}`;
    const perMonth = altByUserMonth.get(r.userId) ?? new Map<string, number>();
    perMonth.set(key, (perMonth.get(key) ?? 0) + r.hours);
    altByUserMonth.set(r.userId, perMonth);
  }

  for (const userId of userIds) {
    const perMonth = new Map<string, number>();
    for (const mo of months) {
      const key = `${mo.year}-${mo.month}`;
      const neu = neuByUserMonth.get(userId)?.get(key) ?? 0;
      perMonth.set(key, neu > 0 ? neu : altByUserMonth.get(userId)?.get(key) ?? 0);
    }
    result.set(userId, perMonth);
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
    result.set(userId, [...monthly.values()].reduce((s, h) => s + h, 0));
  }
  return result;
}
