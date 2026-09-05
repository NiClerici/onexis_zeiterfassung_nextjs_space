// Prisma-gestützte Hilfsfunktionen für TimeEntry-Routen — gemeinsam genutzt
// von app/api/time-entries/route.ts (Einzelzeile) und
// app/api/time-entries/day/route.ts (ganzer Tag auf einmal), damit die Logik
// nicht zweimal existiert.

import { prisma } from "@/lib/db";
import type { EintragTyp } from "@/lib/calc";
import type { VergleichbarerEintrag } from "@/lib/entry-overlap";

// Löst customerId/projectId auf. Ein Projekt gehört immer zu genau einem
// Kunden (Project.customerId ist required) — ist projectId gesetzt, gewinnt
// dessen customerId gegenüber einer abweichend mitgeschickten customerId,
// damit die beiden Felder nie auseinanderlaufen.
export async function resolveProjectAndCustomer(
  orgId: string,
  projectId: unknown,
  customerId: unknown
): Promise<{ projectId: string | null; customerId: string | null } | { error: string }> {
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId as string, orgId } });
    if (!project) return { error: "Invalid project" };
    return { projectId: project.id, customerId: project.customerId };
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId as string, orgId } });
    if (!customer) return { error: "Invalid customer" };
    return { projectId: null, customerId: customer.id };
  }
  return { projectId: null, customerId: null };
}

// Alle anderen (nicht gelöschten) Zeilen desselben Kalendertags, als Basis
// für pruefeEintragKonflikte() (lib/entry-overlap.ts). excludeId schliesst
// bei PUT die eigene Zeile aus, damit sie nicht gegen sich selbst geprüft
// wird — bei POST (neue Zeile) ist excludeId immer undefined.
export async function loadOtherEntriesOfDay(
  orgId: string,
  userId: string,
  date: Date,
  excludeId?: string
): Promise<VergleichbarerEintrag[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { userId, orgId, deletedAt: null, date, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, type: true, von: true, bis: true, pauseMin: true, hours: true, countsAsWorktime: true },
  });
  return rows.map((r) => ({
    id: r.id,
    typ: r.type as EintragTyp,
    von: r.von,
    bis: r.bis,
    pauseMin: r.pauseMin,
    hours: r.hours,
    countsAsWorktime: r.countsAsWorktime,
  }));
}
