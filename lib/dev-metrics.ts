// Datenschicht für die Developer-Übersicht (/dev, siehe lib/dev-access.ts).
// Jede Funktion fängt ihre eigenen Fehler und liefert { error } statt zu
// werfen — eine kaputte Kachel darf nie die ganze Seite reissen (anders als
// im normalen App-Code, wo requireOrg()/AccessError absichtlich werfen).
//
// Bewusst KEIN N+1: alle Aggregate laufen über groupBy/count, gebündelt in
// Promise.all, statt pro Organisation einzeln nachzufragen. (Kein
// prisma.$transaction() hier: dessen Batch-Overload lässt die TS-Typisierung
// von groupBy()-Ergebnissen kollabieren — Promise.all liefert dieselbe
// Parallelität ohne diese Einschränkung; echte Transaktionsgarantien
// braucht diese rein lesende Übersicht ohnehin nicht.)

import { prisma } from "@/lib/db";
import { PLAN_LIMITS, type Plan } from "@/lib/billing-rules";
import { WINDOW_MS as RATE_LIMIT_WINDOW_MS, MAX_ATTEMPTS as RATE_LIMIT_MAX_ATTEMPTS } from "@/lib/rate-limit";
import { isSmtpConfigured } from "@/lib/mail";

const DAY_MS = 24 * 60 * 60 * 1000;
// Ampel-Grenzen für "letzte Aktivität einer Org" (Kalendertage).
export const ACTIVITY_ACTIVE_DAYS = 14;
export const ACTIVITY_SLEEPY_DAYS = 30;

export type ActivityStatus = "aktiv" | "schläfrig" | "inaktiv" | "nie";

export function activityStatus(lastActivity: Date | null, now: Date = new Date()): ActivityStatus {
  if (!lastActivity) return "nie";
  const ageDays = (now.getTime() - lastActivity.getTime()) / DAY_MS;
  if (ageDays <= ACTIVITY_ACTIVE_DAYS) return "aktiv";
  if (ageDays <= ACTIVITY_SLEEPY_DAYS) return "schläfrig";
  return "inaktiv";
}

// ---------------------------------------------------------------------------
// Plattform-Zusammenfassung
// ---------------------------------------------------------------------------

export interface PlatformSummary {
  orgsTotal: number;
  orgsByPlan: Record<Plan, number>;
  usersTotal: number;
  trialsExpiringSoon: number; // trialEndsAt in den nächsten 7 Tagen
  trialsExpired: number; // trialEndsAt in der Vergangenheit, plan noch "trial"
  signupsPerWeek: { weekStart: string; count: number }[]; // letzte 12 Wochen
  error?: string;
}

export async function getPlatformSummary(now: Date = new Date()): Promise<PlatformSummary> {
  const empty: Record<Plan, number> = { trial: 0, starter: 0, pro: 0 };
  try {
    const in7Days = new Date(now.getTime() + 7 * DAY_MS);
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * DAY_MS);

    const [byPlan, usersTotal, trialsExpiringSoon, trialsExpired, recentOrgs] = await Promise.all([
      prisma.organization.groupBy({ by: ["plan"], _count: { _all: true }, orderBy: { plan: "asc" } }),
      prisma.user.count(),
      prisma.organization.count({
        where: { plan: "trial", trialEndsAt: { gte: now, lte: in7Days } },
      }),
      prisma.organization.count({
        where: { plan: "trial", trialEndsAt: { lt: now } },
      }),
      prisma.organization.findMany({
        where: { createdAt: { gte: twelveWeeksAgo } },
        select: { createdAt: true },
      }),
    ]);

    const orgsByPlan = { ...empty };
    let orgsTotal = 0;
    for (const row of byPlan) {
      const plan = row.plan as Plan;
      if (plan in orgsByPlan) orgsByPlan[plan] = row._count._all;
      orgsTotal += row._count._all;
    }

    const signupsPerWeek = buildWeeklyBuckets(recentOrgs.map((o) => o.createdAt), now, 12);

    return { orgsTotal, orgsByPlan, usersTotal, trialsExpiringSoon, trialsExpired, signupsPerWeek };
  } catch (error: any) {
    console.error("getPlatformSummary failed:", error);
    return {
      orgsTotal: 0,
      orgsByPlan: empty,
      usersTotal: 0,
      trialsExpiringSoon: 0,
      trialsExpired: 0,
      signupsPerWeek: [],
      error: "Zusammenfassung konnte nicht geladen werden.",
    };
  }
}

// Teilt Zeitstempel in wochenweise Buckets (Montag–Sonntag), älteste zuerst.
export function buildWeeklyBuckets(dates: Date[], now: Date, weeks: number): { weekStart: string; count: number }[] {
  const startOfThisWeek = startOfWeek(now);
  const buckets: { weekStart: string; count: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(startOfThisWeek.getTime() - i * 7 * DAY_MS);
    buckets.push({ weekStart: weekStart.toISOString().slice(0, 10), count: 0 });
  }
  for (const date of dates) {
    const weekStart = startOfWeek(date).toISOString().slice(0, 10);
    const bucket = buckets.find((b) => b.weekStart === weekStart);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function startOfWeek(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sonntag
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  return monday;
}

// ---------------------------------------------------------------------------
// Kunden-/Org-Übersicht
// ---------------------------------------------------------------------------

export interface OrgOverviewRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  seatsActive: number;
  seatsInactive: number;
  maxUsers: number | null;
  lastActivity: Date | null;
  activityStatus: ActivityStatus;
  entries30d: number;
  activeUsers30d: number;
  openAbsenceRequests: number;
  customerCount: number;
  projectCount: number;
  holidaysConfigured: boolean;
}

export interface OrgOverviewResult {
  rows: OrgOverviewRow[];
  error?: string;
}

export async function getOrgOverview(now: Date = new Date()): Promise<OrgOverviewResult> {
  try {
    const since30d = new Date(now.getTime() - 30 * DAY_MS);

    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true, plan: true, trialEndsAt: true, createdAt: true },
    });
    if (orgs.length === 0) return { rows: [] };

    const orgIds = orgs.map((o) => o.id);

    const [
      membershipCounts,
      lastEntries,
      entries30dCounts,
      activeUsers30dRows,
      openAbsenceCounts,
      customerCounts,
      projectCounts,
      holidayOrgIds,
    ] = await Promise.all([
      prisma.membership.groupBy({ by: ["orgId", "status"], where: { orgId: { in: orgIds } }, _count: { _all: true }, orderBy: { orgId: "asc" } }),
      prisma.timeEntry.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds }, deletedAt: null }, _max: { date: true }, orderBy: { orgId: "asc" } }),
      prisma.timeEntry.groupBy({
        by: ["orgId"],
        where: { orgId: { in: orgIds }, deletedAt: null, date: { gte: since30d } },
        _count: { _all: true },
        orderBy: { orgId: "asc" },
      }),
      prisma.timeEntry.findMany({
        where: { orgId: { in: orgIds }, deletedAt: null, date: { gte: since30d } },
        select: { orgId: true, userId: true },
        distinct: ["orgId", "userId"],
      }),
      prisma.absenceRequest.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds }, status: "offen" }, _count: { _all: true }, orderBy: { orgId: "asc" } }),
      prisma.customer.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _count: { _all: true }, orderBy: { orgId: "asc" } }),
      prisma.project.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _count: { _all: true }, orderBy: { orgId: "asc" } }),
      prisma.holiday.findMany({ where: { orgId: { in: orgIds } }, select: { orgId: true }, distinct: ["orgId"] }),
    ]);

    const seatsByOrg = new Map<string, { active: number; inactive: number }>();
    for (const row of membershipCounts) {
      const entry = seatsByOrg.get(row.orgId) ?? { active: 0, inactive: 0 };
      if (row.status === "aktiv") entry.active += row._count._all;
      else entry.inactive += row._count._all;
      seatsByOrg.set(row.orgId, entry);
    }
    const lastActivityByOrg = new Map(lastEntries.map((r) => [r.orgId, r._max.date]));
    const entries30dByOrg = new Map(entries30dCounts.map((r) => [r.orgId, r._count._all]));
    const activeUsers30dByOrg = new Map<string, number>();
    for (const row of activeUsers30dRows) {
      activeUsers30dByOrg.set(row.orgId, (activeUsers30dByOrg.get(row.orgId) ?? 0) + 1);
    }
    const openAbsenceByOrg = new Map(openAbsenceCounts.map((r) => [r.orgId, r._count._all]));
    const customerCountByOrg = new Map(customerCounts.map((r) => [r.orgId, r._count._all]));
    const projectCountByOrg = new Map(projectCounts.map((r) => [r.orgId, r._count._all]));
    const holidaysConfiguredSet = new Set(holidayOrgIds.map((r) => r.orgId));

    const rows: OrgOverviewRow[] = orgs.map((org) => {
      const seats = seatsByOrg.get(org.id) ?? { active: 0, inactive: 0 };
      const lastActivity = lastActivityByOrg.get(org.id) ?? null;
      const plan = (org.plan as Plan) in PLAN_LIMITS ? (org.plan as Plan) : "trial";
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        trialEndsAt: org.trialEndsAt,
        createdAt: org.createdAt,
        seatsActive: seats.active,
        seatsInactive: seats.inactive,
        maxUsers: PLAN_LIMITS[plan].maxUsers,
        lastActivity,
        activityStatus: activityStatus(lastActivity, now),
        entries30d: entries30dByOrg.get(org.id) ?? 0,
        activeUsers30d: activeUsers30dByOrg.get(org.id) ?? 0,
        openAbsenceRequests: openAbsenceByOrg.get(org.id) ?? 0,
        customerCount: customerCountByOrg.get(org.id) ?? 0,
        projectCount: projectCountByOrg.get(org.id) ?? 0,
        holidaysConfigured: holidaysConfiguredSet.has(org.id),
      };
    });

    // Aktivste Orgs zuerst; Orgs ohne jede Aktivität ("nie") ans Ende.
    rows.sort((a, b) => (b.lastActivity?.getTime() ?? -Infinity) - (a.lastActivity?.getTime() ?? -Infinity));

    return { rows };
  } catch (error: any) {
    console.error("getOrgOverview failed:", error);
    return { rows: [], error: "Kunden-Übersicht konnte nicht geladen werden." };
  }
}

// Detailsicht für app/(dev)/dev/orgs/[slug] — bewusst eine eigene, gezielte
// Query statt getOrgOverview() zu filtern: der Drilldown braucht zusätzliche
// Felder (Mitgliederliste, ArG-Toggles), die die Tabellenübersicht nicht.
export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  maxWeeklyHours: number;
  warnPauseZuKurz: boolean;
  warnSonntagsarbeit: boolean;
  members: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    entryDate: Date;
    exitDate: Date | null;
    pensum: number;
    mustSetPassword: boolean;
  }[];
  monthlyUsage: { month: string; entries: number; hours: number }[]; // letzte 12 Monate
  customerCount: number;
  projectCount: number;
  monthLocksCount: number;
  openAbsenceRequests: number;
  holidaysByYear: { year: number; count: number }[];
}

export async function getOrgDetail(slug: string, now: Date = new Date()): Promise<OrgDetail | null> {
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) return null;

  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const [memberships, entries, customerCount, projectCount, monthLocksCount, openAbsenceRequests, holidays] =
    await prisma.$transaction([
      prisma.membership.findMany({
        where: { orgId: org.id },
        include: { user: { select: { email: true, firstName: true, lastName: true, mustSetPassword: true } } },
        orderBy: { entryDate: "asc" },
      }),
      prisma.timeEntry.findMany({
        where: { orgId: org.id, deletedAt: null, date: { gte: twelveMonthsAgo } },
        select: { date: true, hours: true },
      }),
      prisma.customer.count({ where: { orgId: org.id } }),
      prisma.project.count({ where: { orgId: org.id } }),
      prisma.monthLock.count({ where: { orgId: org.id } }),
      prisma.absenceRequest.count({ where: { orgId: org.id, status: "offen" } }),
      prisma.holiday.findMany({ where: { orgId: org.id }, select: { date: true } }),
    ]);

  const monthlyUsageMap = new Map<string, { entries: number; hours: number }>();
  for (const entry of entries) {
    const key = entry.date.toISOString().slice(0, 7); // YYYY-MM
    const bucket = monthlyUsageMap.get(key) ?? { entries: 0, hours: 0 };
    bucket.entries += 1;
    bucket.hours += entry.hours ?? 0;
    monthlyUsageMap.set(key, bucket);
  }
  const monthlyUsage = Array.from(monthlyUsageMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const holidaysByYearMap = new Map<number, number>();
  for (const h of holidays) {
    const year = h.date.getUTCFullYear();
    holidaysByYearMap.set(year, (holidaysByYearMap.get(year) ?? 0) + 1);
  }
  const holidaysByYear = Array.from(holidaysByYearMap.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    trialEndsAt: org.trialEndsAt,
    createdAt: org.createdAt,
    maxWeeklyHours: org.maxWeeklyHours,
    warnPauseZuKurz: org.warnPauseZuKurz,
    warnSonntagsarbeit: org.warnSonntagsarbeit,
    members: memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
      status: m.status,
      entryDate: m.entryDate,
      exitDate: m.exitDate,
      pensum: m.pensum,
      mustSetPassword: m.user.mustSetPassword,
    })),
    monthlyUsage,
    customerCount,
    projectCount,
    monthLocksCount,
    openAbsenceRequests,
    holidaysByYear,
  };
}

// ---------------------------------------------------------------------------
// System-Health
// ---------------------------------------------------------------------------

export interface SystemHealth {
  databaseOk: boolean;
  databaseSizeBytes: number | null;
  tableRowCounts: { table: string; rows: number }[];
  lastMigration: { name: string; finishedAt: Date | null } | null;
  migrationsCount: number;
  pendingMigration: boolean;
  error?: string;
}

// Tabellen, deren Zeilenzahl auf der Statusleiste interessiert — bewusst eine
// feste Liste statt information_schema abzufragen, damit die Reihenfolge
// stabil und lesbar bleibt.
const TRACKED_TABLES = [
  "Organization",
  "User",
  "Membership",
  "TimeEntry",
  "TimeEntryAudit",
  "AbsenceRequest",
  "Customer",
  "Project",
  "CustomerMonth",
  "Invitation",
  "LoginAttempt",
] as const;

export async function getSystemHealth(): Promise<SystemHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    const [sizeRows, migrationRows, tableCounts, migrationsCountRows] = await Promise.all([
      prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      prisma.$queryRaw<
        { migration_name: string; finished_at: Date | null }[]
      >`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1`,
      prisma.$queryRaw<{ table_name: string; row_count: number }[]>`
        SELECT relname AS table_name, n_live_tup AS row_count
        FROM pg_stat_user_tables
        WHERE relname = ANY(${TRACKED_TABLES as unknown as string[]})
      `,
      prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM _prisma_migrations`,
    ]);

    const rowCountByTable = new Map(tableCounts.map((r) => [r.table_name, Number(r.row_count)]));
    const tableRowCounts = TRACKED_TABLES.map((table) => ({ table, rows: rowCountByTable.get(table) ?? 0 }));

    const lastMigration = migrationRows[0]
      ? { name: migrationRows[0].migration_name, finishedAt: migrationRows[0].finished_at }
      : null;

    return {
      databaseOk: true,
      databaseSizeBytes: sizeRows[0] ? Number(sizeRows[0].size) : null,
      tableRowCounts,
      lastMigration,
      migrationsCount: Number(migrationsCountRows[0]?.count ?? 0),
      pendingMigration: lastMigration ? lastMigration.finishedAt === null : false,
    };
  } catch (error: any) {
    console.error("getSystemHealth failed:", error);
    return {
      databaseOk: false,
      databaseSizeBytes: null,
      tableRowCounts: [],
      lastMigration: null,
      migrationsCount: 0,
      pendingMigration: false,
      error: "Datenbank nicht erreichbar.",
    };
  }
}

// ---------------------------------------------------------------------------
// Auth-/Integritäts-Health
// ---------------------------------------------------------------------------

export interface AuthHealth {
  failedLogins24h: number;
  failedLogins7d: number;
  lockedBuckets: { bucket: string; value: string; attempts: number }[];
  openInvitations: number;
  expiredInvitations: number;
  usersMustSetPassword: number;
  openPasswordResetTokens: number;
  error?: string;
}

export async function getAuthHealth(now: Date = new Date()): Promise<AuthHealth> {
  try {
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const rateLimitWindowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

    const [
      failedLogins24h,
      failedLogins7d,
      lockedByEmail,
      lockedByIp,
      openInvitations,
      expiredInvitations,
      usersMustSetPassword,
      openPasswordResetTokens,
    ] = await Promise.all([
      prisma.loginAttempt.count({ where: { action: "login", success: false, createdAt: { gte: since24h } } }),
      prisma.loginAttempt.count({ where: { action: "login", success: false, createdAt: { gte: since7d } } }),
      prisma.loginAttempt.groupBy({
        by: ["email"],
        where: { action: "login", success: false, createdAt: { gte: rateLimitWindowStart } },
        _count: { _all: true },
        having: { email: { _count: { gte: RATE_LIMIT_MAX_ATTEMPTS } } },
        orderBy: { email: "asc" },
      }),
      prisma.loginAttempt.groupBy({
        by: ["ip"],
        where: { action: "login", success: false, createdAt: { gte: rateLimitWindowStart } },
        _count: { _all: true },
        having: { ip: { _count: { gte: RATE_LIMIT_MAX_ATTEMPTS } } },
        orderBy: { ip: "asc" },
      }),
      prisma.invitation.count({ where: { usedAt: null, expiresAt: { gte: now } } }),
      prisma.invitation.count({ where: { usedAt: null, expiresAt: { lt: now } } }),
      prisma.user.count({ where: { mustSetPassword: true } }),
      prisma.passwordResetToken.count({ where: { usedAt: null, expiresAt: { gte: now } } }),
    ]);

    const lockedBuckets = [
      ...lockedByEmail.map((r) => ({ bucket: "email" as const, value: r.email, attempts: r._count._all })),
      ...lockedByIp.map((r) => ({ bucket: "ip" as const, value: r.ip, attempts: r._count._all })),
    ];

    return {
      failedLogins24h,
      failedLogins7d,
      lockedBuckets,
      openInvitations,
      expiredInvitations,
      usersMustSetPassword,
      openPasswordResetTokens,
    };
  } catch (error: any) {
    console.error("getAuthHealth failed:", error);
    return {
      failedLogins24h: 0,
      failedLogins7d: 0,
      lockedBuckets: [],
      openInvitations: 0,
      expiredInvitations: 0,
      usersMustSetPassword: 0,
      openPasswordResetTokens: 0,
      error: "Auth-Kennzahlen konnten nicht geladen werden.",
    };
  }
}

// ---------------------------------------------------------------------------
// Umgebungsstatus — nur Booleans/Namen, nie Secrets
// ---------------------------------------------------------------------------

export interface EnvStatus {
  smtpConfigured: boolean;
  nodeEnv: string;
  appVersion: string | null;
}

export function getEnvStatus(): EnvStatus {
  return {
    smtpConfigured: isSmtpConfigured(),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    // npm_package_version war hier vorher ein totes Feld: der Standalone-
    // Container startet mit "node server.js", nie über npm, die Variable
    // ist dort nie gesetzt. APP_VERSION wird stattdessen als Git-SHA beim
    // Build eingebacken (Dockerfile ARG GIT_SHA, docker-compose.yml
    // app.build.args, gesetzt von deploy/deploy.sh) — beantwortet "welcher
    // Commit läuft gerade?" aus der laufenden App heraus.
    appVersion: process.env.APP_VERSION ?? null,
  };
}

// ---------------------------------------------------------------------------
// Betriebsereignisse (Backup, ErrorLog-Aufräumung) — geschrieben von
// deploy/backup.sh über "docker compose exec -T db psql", ausserhalb jedes
// Node-Prozesses. Ohne diese Sicht fiele ein stiller Backup-Fehlschlag nie
// auf (5-jährige Aufbewahrungspflicht, ArG).
// ---------------------------------------------------------------------------

export type OpsEventStatus = "ok" | "failed" | "missing";

export interface BackupStatus {
  status: OpsEventStatus;
  detail: string | null;
  lastRunAt: Date | null;
  ageHours: number | null;
  error?: string;
}

// Ab wann ein an sich erfolgreiches Backup trotzdem als überfällig gilt —
// bei täglich 03:00 Uhr lässt ein Cronjob-Ausfall die Zeile ein oder zwei
// Tage stehen, 26h Toleranz statt exakt 24h wegen möglicher DST-Verschiebung
// und Cron-Jitter.
export const BACKUP_STALE_HOURS = 26;

export async function getBackupStatus(now: Date = new Date()): Promise<BackupStatus> {
  try {
    const last = await prisma.opsEvent.findFirst({
      where: { kind: "backup" },
      orderBy: { createdAt: "desc" },
    });
    if (!last) {
      return { status: "missing", detail: null, lastRunAt: null, ageHours: null };
    }
    const ageHours = (now.getTime() - last.createdAt.getTime()) / (60 * 60 * 1000);
    return {
      status: last.status === "ok" ? "ok" : "failed",
      detail: last.detail,
      lastRunAt: last.createdAt,
      ageHours,
    };
  } catch (error: any) {
    console.error("getBackupStatus failed:", error);
    return { status: "missing", detail: null, lastRunAt: null, ageHours: null, error: "Backup-Status konnte nicht geladen werden." };
  }
}
