// "Meine Projekte" — die Sichtbarkeitsregel, die GET /api/projects für ein
// Mitglied schon immer anwendet, als geteilter Helfer. Zweiter Aufrufer ist
// der Stundenrapport-Export (app/api/export/stundenrapport), dessen
// Projektkatalog vorher ALLE aktiven Projekte des Kunden zeigte — also auch
// Projekte von Kolleg:innen, meist mit 0.00 Stunden. Geteilt statt zweimal
// geschrieben, damit Projekt-Dropdown und Rapport nicht auseinanderlaufen.
//
// Achtung: Die Regel ist bewusst rollenfrei. In /api/projects entscheidet der
// Aufrufer, ob er sie überhaupt anwendet (manager/admin/owner sehen dort
// alles); der Rapport wendet sie für JEDE Rolle an, weil er ein persönliches
// Dokument ist.

import { prisma } from "@/lib/db";

// Prisma-where-Fragment für Project: gebucht (TimeEntry oder CustomerMonth)
// ODER selbst angelegt. Zum Kombinieren mit weiteren Bedingungen gedacht:
//   where: { orgId, active: true, ...(await ownProjectsWhere(orgId, userId)) }
export async function ownProjectsWhere(orgId: string, userId: string): Promise<{ OR: Array<{ id: { in: string[] } } | { createdBy: string }> }> {
  const [fromEntries, fromMonths] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, projectId: { not: null } },
      select: { projectId: true },
      distinct: ["projectId"],
    }),
    prisma.customerMonth.findMany({
      where: { userId, orgId, projectId: { not: null } },
      select: { projectId: true },
      distinct: ["projectId"],
    }),
  ]);
  const ids = Array.from(
    new Set([...fromEntries.map((e) => e.projectId), ...fromMonths.map((m) => m.projectId)].filter((id): id is string => !!id))
  );

  // Ohne den createdBy-Zweig wäre ein frisch erstelltes Projekt für die
  // erstellende Person unsichtbar, bis sie zum ersten Mal Stunden darauf
  // gebucht hat — Henne-Ei-Problem, da das Projekt-Dropdown im Kalender
  // genau aus dieser Liste gespeist wird.
  return { OR: [{ id: { in: ids } }, { createdBy: userId }] };
}
