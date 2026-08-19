// Gemeinsame Hilfsfunktionen für monatlich erfasste Kundenstunden
// (Betrieb.md-Nachtrag, 18.08.2026 — Kundenstunden hängen nicht mehr am
// einzelnen TimeEntry, sondern werden separat pro Monat erfasst,
// CustomerMonth). Braucht Prisma, lebt deshalb hier statt in lib/calc.ts.
//
// Für einen Zeitraum [from, to], der keine vollen Kalendermonate trifft
// (z.B. "custom"-Export vom 10. bis 20. eines Monats), werden die
// überlappenden Monate VOLL gezählt — das ist unscharf, aber die einzige
// Zahl, die CustomerMonth hergibt. Aufrufer, die das anzeigen, sollten das
// entsprechend kennzeichnen (siehe app/(app)/team/page.tsx).

import { prisma } from "@/lib/db";

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

// Kundenstunden EINER Person, über [from, to] überlappende Monate summiert.
// Nur Stunden bei verrechenbaren Kunden zählen als "Kundenstunden" im Sinne
// von kennzahlen().verrechnungsgrad — dieselbe Bedeutung wie früher
// TimeEntry.billable, jetzt aber Customer.billable, weil die Zuordnung auf
// Kundenebene liegt.
export async function sumCustomerHours(params: { orgId: string; userId: string; from: Date; to: Date }): Promise<number> {
  const { orgId, userId, from, to } = params;
  const months = monthsInRange(from, to);
  if (months.length === 0) return 0;
  const rows = await prisma.customerMonth.findMany({
    where: { orgId, userId, OR: months.map((mo) => ({ year: mo.year, month: mo.month })) },
    include: { customer: { select: { billable: true } } },
  });
  return rows.filter((r) => r.customer.billable).reduce((s, r) => s + r.hours, 0);
}

// Batched Variante für mehrere Personen auf einmal (Teamsicht) — eine
// Query statt einer pro Person, gleiches Muster wie die übrigen Batch-
// Queries in app/api/team/route.ts (HARDENING.md B4).
export async function sumCustomerHoursByUser(params: { orgId: string; userIds: string[]; from: Date; to: Date }): Promise<Map<string, number>> {
  const { orgId, userIds, from, to } = params;
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;
  const months = monthsInRange(from, to);
  if (months.length === 0) return result;
  const rows = await prisma.customerMonth.findMany({
    where: { orgId, userId: { in: userIds }, OR: months.map((mo) => ({ year: mo.year, month: mo.month })) },
    include: { customer: { select: { billable: true } } },
  });
  for (const row of rows) {
    if (!row.customer.billable) continue;
    result.set(row.userId, (result.get(row.userId) ?? 0) + row.hours);
  }
  return result;
}
