// Löschschutz für Customer/Project (Audit-Fund KRITISCH, REVIEW_LOOP.md
// Batch 5) — an einer Stelle statt zweimal separat, damit die beiden Regeln
// nicht wie schon einmal (siehe Querschnittliches Muster 2 des Audits)
// auseinanderlaufen.
//
// Zwei unabhängige Sperren, beide müssen passieren:
//  1. assertMayDelete: WER darf löschen — owner/admin immer, sonst nur die
//     Person, die die Entität selbst angelegt hat (Customer.createdBy /
//     Project.createdBy).
//  2. countCustomerReferences/countProjectReferences: OB überhaupt gelöscht
//     werden darf — sobald TimeEntry-, CustomerMonth- oder (bei Kunden)
//     Project-Zeilen darauf verweisen, ist Löschen für JEDE Rolle gesperrt.
//     Das ist der eigentliche Schutz vor dem Audit-Fund: der versehentliche
//     Klick auf den Papierkorb in der Profilseite kam von einem owner/admin
//     genauso in Frage wie von einem member, eine reine Rollenprüfung hätte
//     ihn nicht verhindert.
import { prisma } from "@/lib/db";
import { AccessError, type Role } from "@/lib/access";

export function assertMayDelete(role: Role, createdBy: string | null, userId: string): void {
  if (role === "owner" || role === "admin") return;
  if (createdBy && createdBy === userId) return;
  throw new AccessError(403, "Forbidden");
}

export interface ReferenceCounts {
  timeEntries: number;
  customerMonths: number;
  projects: number;
  total: number;
}

export async function countCustomerReferences(orgId: string, customerId: string): Promise<ReferenceCounts> {
  const [timeEntries, customerMonths, projects] = await Promise.all([
    prisma.timeEntry.count({ where: { orgId, customerId, deletedAt: null } }),
    prisma.customerMonth.count({ where: { orgId, customerId } }),
    prisma.project.count({ where: { orgId, customerId } }),
  ]);
  return { timeEntries, customerMonths, projects, total: timeEntries + customerMonths + projects };
}

export async function countProjectReferences(orgId: string, projectId: string): Promise<ReferenceCounts> {
  const [timeEntries, customerMonths] = await Promise.all([
    prisma.timeEntry.count({ where: { orgId, projectId, deletedAt: null } }),
    prisma.customerMonth.count({ where: { orgId, projectId } }),
  ]);
  return { timeEntries, customerMonths, projects: 0, total: timeEntries + customerMonths };
}

// Deutschsprachige Meldung für die 409-Antwort — nennt die Zahlen, damit ein
// owner/admin nachvollziehen kann, warum das Löschen abgelehnt wurde, statt
// nur "Forbidden" zu sehen.
export function referenceCountsMessage(kind: "Kunde" | "Projekt", counts: ReferenceCounts): string {
  const parts: string[] = [];
  if (counts.timeEntries > 0) parts.push(`${counts.timeEntries} Zeiteintrag(en)`);
  if (counts.customerMonths > 0) parts.push(`${counts.customerMonths} Monatswert(en)`);
  if (counts.projects > 0) parts.push(`${counts.projects} Projekt(en)`);
  return `${kind} wird von ${parts.join(", ")} verwendet und kann nicht gelöscht werden.`;
}
