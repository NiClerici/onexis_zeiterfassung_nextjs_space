// Vollständiger Organisationsexport (MIGRATION.md Punkt 12) — sammelt
// wirklich ALLE Daten einer Organisation, inkl. soft-gelöschter TimeEntries
// und beider Audit-Trails (TimeEntryAudit, MonthLockAudit), damit der
// JSON-Export echte Datenportabilität/DSGVO-Auskunft abdeckt, nicht nur
// die aktuell sichtbaren Datensätze.

import { prisma } from "@/lib/db";

export async function gatherOrgExport(orgId: string) {
  const [
    organization,
    memberships,
    timeEntries,
    timeEntryAudits,
    customers,
    projects,
    holidays,
    pensumChanges,
    overtimePayouts,
    monthLocks,
    monthLockAudits,
    absenceRequests,
    invitations,
  ] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Bewusst OHNE deletedAt: null — der Export soll auch soft-gelöschte
    // Einträge enthalten (Punkt 6b), das ist genau der Zweck der
    // gesetzlichen Aufbewahrungspflicht.
    prisma.timeEntry.findMany({ where: { orgId }, orderBy: { date: "asc" } }),
    prisma.timeEntryAudit.findMany({ where: { orgId }, orderBy: { changedAt: "asc" } }),
    prisma.customer.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    prisma.holiday.findMany({ where: { orgId }, orderBy: { date: "asc" } }),
    prisma.pensumChange.findMany({ where: { orgId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.overtimePayout.findMany({ where: { orgId }, orderBy: { date: "asc" } }),
    prisma.monthLock.findMany({ where: { orgId }, orderBy: { lockedAt: "asc" } }),
    prisma.monthLockAudit.findMany({ where: { orgId }, orderBy: { performedAt: "asc" } }),
    prisma.absenceRequest.findMany({
      where: { orgId },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    organization,
    memberships,
    timeEntries,
    timeEntryAudits,
    customers,
    projects,
    holidays,
    pensumChanges,
    overtimePayouts,
    monthLocks,
    monthLockAudits,
    absenceRequests,
    invitations,
  };
}

export type OrgExportData = Awaited<ReturnType<typeof gatherOrgExport>>;
