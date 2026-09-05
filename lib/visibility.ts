// "Meine Kunden"/"Meine Projekte" — die Sichtbarkeitsregel, die GET
// /api/projects (und seit dem Customer.createdBy-Fund auch GET /api/customers)
// für ein Mitglied anwendet, als geteilter Helfer. Weiterer Aufrufer ist der
// Stundenrapport-Export (app/api/export/stundenrapport), dessen Projektkatalog
// vorher ALLE aktiven Projekte des Kunden zeigte — also auch Projekte von
// Kolleg:innen, meist mit 0.00 Stunden. Geteilt statt mehrfach geschrieben,
// damit Dropdowns und Rapport nicht auseinanderlaufen (siehe REVIEW_LOOP.md,
// Querschnittliches Muster 2 — "Dieselbe Regel ist mehrfach implementiert und
// läuft auseinander").
//
// Achtung: Die Regel ist bewusst rollenfrei. In /api/projects und
// /api/customers entscheidet der Aufrufer, ob er sie überhaupt anwendet
// (manager/admin/owner sehen dort alles); der Rapport wendet sie für JEDE
// Rolle an, weil er ein persönliches Dokument ist.
//
// Ehemals lib/project-visibility.ts — umbenannt, als die Kunden-Variante
// dazukam (REVIEW_LOOP.md, "Kundenerfassung ist für die Rolle member eine
// Sackgasse").

import { prisma } from "@/lib/db";

type OwnWhere = { OR: Array<{ id: { in: string[] } } | { createdBy: string }> };

// Prisma-where-Fragment für Project: gebucht (TimeEntry oder CustomerMonth)
// ODER selbst angelegt. Zum Kombinieren mit weiteren Bedingungen gedacht:
//   where: { orgId, active: true, ...(await ownProjectsWhere(orgId, userId)) }
export async function ownProjectsWhere(orgId: string, userId: string): Promise<OwnWhere> {
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

// Dasselbe Muster für Customer, seit Customer.createdBy existiert. Vorher
// gab es hier nur den ersten Zweig (gebucht) — ein frisch angelegter, noch
// nie bebuchter Kunde war für die erstellende Person deshalb dauerhaft
// unsichtbar, siehe REVIEW_LOOP.md.
export async function ownCustomersWhere(orgId: string, userId: string): Promise<OwnWhere> {
  const [fromEntries, fromMonths] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, customerId: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.customerMonth.findMany({
      where: { userId, orgId },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);
  const ids = Array.from(
    new Set([...fromEntries.map((e) => e.customerId), ...fromMonths.map((m) => m.customerId)].filter((id): id is string => !!id))
  );

  return { OR: [{ id: { in: ids } }, { createdBy: userId }] };
}
