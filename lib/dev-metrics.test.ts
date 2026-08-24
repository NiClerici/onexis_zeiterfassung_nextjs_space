// Tests für lib/dev-metrics.ts — Datenschicht der Developer-Übersicht
// (/dev). Läuft, wie lib/customer-months.test.ts, gegen die echte Dev-DB mit
// einer eigenen, per Suite-Lauf eindeutigen Org statt gemocktem Prisma: die
// Aggregate hier sind reine groupBy/count-Kombinationen, deren Verhalten sich
// mit einem Mock kaum vertrauenswürdig nachbilden liesse.

import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  activityStatus,
  buildWeeklyBuckets,
  getPlatformSummary,
  getOrgOverview,
  getOrgDetail,
  getAuthHealth,
  getEnvStatus,
  getBackupStatus,
  BACKUP_STALE_HOURS,
  ACTIVITY_ACTIVE_DAYS,
  ACTIVITY_SLEEPY_DAYS,
} from "@/lib/dev-metrics";

describe("activityStatus", () => {
  const now = new Date("2026-08-24T12:00:00Z");

  it("ist 'nie' ohne jede Aktivität", () => {
    expect(activityStatus(null, now)).toBe("nie");
  });

  it("ist 'aktiv' innerhalb der Aktiv-Grenze", () => {
    const recent = new Date(now.getTime() - (ACTIVITY_ACTIVE_DAYS - 1) * 24 * 60 * 60 * 1000);
    expect(activityStatus(recent, now)).toBe("aktiv");
  });

  it("ist 'schläfrig' zwischen Aktiv- und Schläfrig-Grenze", () => {
    const mid = new Date(now.getTime() - (ACTIVITY_ACTIVE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(activityStatus(mid, now)).toBe("schläfrig");
  });

  it("ist 'inaktiv' jenseits der Schläfrig-Grenze", () => {
    const old = new Date(now.getTime() - (ACTIVITY_SLEEPY_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(activityStatus(old, now)).toBe("inaktiv");
  });
});

describe("buildWeeklyBuckets", () => {
  it("erzeugt genau N Wochen-Buckets, älteste zuerst, mit korrekter Zählung", () => {
    const now = new Date("2026-08-24T12:00:00Z"); // ein Montag
    const dates = [new Date("2026-08-24T08:00:00Z"), new Date("2026-08-20T08:00:00Z"), new Date("2026-08-17T08:00:00Z")];
    const buckets = buildWeeklyBuckets(dates, now, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[buckets.length - 1].weekStart).toBe("2026-08-24");
    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(buckets[buckets.length - 2].count).toBe(2); // 20. + 17. fallen in dieselbe Woche
  });

  it("liefert ausschliesslich Null-Buckets ohne Daten", () => {
    const buckets = buildWeeklyBuckets([], new Date("2026-08-24T12:00:00Z"), 3);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});

const ORG = "test_dev_metrics_org";
const ORG2 = "test_dev_metrics_org2";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: ORG, name: "Dev Metrics Test GmbH", slug: "dev-metrics-test-gmbh", plan: "pro" },
  });
  await prisma.organization.create({
    data: { id: ORG2, name: "Dev Metrics Test AG (Trial)", slug: "dev-metrics-test-ag-trial", plan: "trial", trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
  });
  const user = await prisma.user.create({
    data: { email: "dev-metrics-user@example.test", password: "irrelevant", firstName: "Test", lastName: "User" },
  });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "owner", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Testkunde Dev" } });
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date(), type: "arbeit", hours: 4, customerId: customer.id },
  });
  await prisma.absenceRequest.create({
    data: { orgId: ORG, userId, fromDate: new Date(), toDate: new Date(), type: "ferien", status: "offen" },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.absenceRequest.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
});

describe("getPlatformSummary", () => {
  it("zählt die Test-Orgs je Plan und erkennt den bald ablaufenden Trial", async () => {
    const summary = await getPlatformSummary();
    expect(summary.error).toBeUndefined();
    expect(summary.orgsTotal).toBeGreaterThanOrEqual(2);
    expect(summary.orgsByPlan.pro).toBeGreaterThanOrEqual(1);
    expect(summary.orgsByPlan.trial).toBeGreaterThanOrEqual(1);
    expect(summary.trialsExpiringSoon).toBeGreaterThanOrEqual(1);
  });
});

describe("getOrgOverview", () => {
  it("liefert eine Zeile für die Test-Org mit korrekten Kennzahlen", async () => {
    const { rows, error } = await getOrgOverview();
    expect(error).toBeUndefined();
    const row = rows.find((r) => r.id === ORG);
    expect(row).toBeDefined();
    expect(row?.seatsActive).toBe(1);
    expect(row?.entries30d).toBe(1);
    expect(row?.activeUsers30d).toBe(1);
    expect(row?.openAbsenceRequests).toBe(1);
    expect(row?.customerCount).toBe(1);
    expect(row?.activityStatus).toBe("aktiv");
    expect(row?.maxUsers).toBe(50); // PLAN_LIMITS.pro.maxUsers
  });

  it("zeigt eine frische Org ohne Aktivität als 'nie'", async () => {
    const { rows } = await getOrgOverview();
    const row = rows.find((r) => r.id === ORG2);
    expect(row?.activityStatus).toBe("nie");
    expect(row?.entries30d).toBe(0);
  });
});

describe("getOrgDetail", () => {
  it("liefert die Detailsicht der Test-Org über den Slug", async () => {
    const detail = await getOrgDetail("dev-metrics-test-gmbh");
    expect(detail).not.toBeNull();
    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].email).toBe("dev-metrics-user@example.test");
    expect(detail?.customerCount).toBe(1);
    expect(detail?.openAbsenceRequests).toBe(1);
  });

  it("liefert null für einen unbekannten Slug", async () => {
    expect(await getOrgDetail("gibt-es-nicht-" + Date.now())).toBeNull();
  });
});

describe("getAuthHealth", () => {
  it("liefert eine Struktur ohne zu werfen", async () => {
    const health = await getAuthHealth();
    expect(health.error).toBeUndefined();
    expect(typeof health.failedLogins24h).toBe("number");
    expect(Array.isArray(health.lockedBuckets)).toBe(true);
  });
});

describe("getEnvStatus", () => {
  it("liefert nur Booleans/Namen, nie Secret-Werte", () => {
    const status = getEnvStatus();
    expect(typeof status.smtpConfigured).toBe("boolean");
    expect(typeof status.nodeEnv).toBe("string");
  });
});

describe("getBackupStatus", () => {
  afterEach(async () => {
    await prisma.opsEvent.deleteMany({ where: { kind: { in: ["backup", "errorlog-prune"] } } });
  });

  it("meldet 'missing' ohne jeden protokollierten Lauf", async () => {
    const status = await getBackupStatus();
    expect(status.status).toBe("missing");
    expect(status.lastRunAt).toBeNull();
  });

  it("übernimmt den Status der jüngsten Zeile, nicht den ältesten", async () => {
    await prisma.opsEvent.create({ data: { kind: "backup", status: "failed", detail: "alt", createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await prisma.opsEvent.create({ data: { kind: "backup", status: "ok", detail: "neu (12M)" } });

    const status = await getBackupStatus();
    expect(status.status).toBe("ok");
    expect(status.detail).toBe("neu (12M)");
  });

  it("berechnet ageHours korrekt und markiert nichts als überfällig innerhalb der Toleranz", async () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h alt
    await prisma.opsEvent.create({ data: { kind: "backup", status: "ok", detail: "frisch", createdAt } });

    const status = await getBackupStatus();
    expect(status.ageHours).not.toBeNull();
    expect(status.ageHours!).toBeGreaterThan(1.9);
    expect(status.ageHours!).toBeLessThan(2.1);
    expect(status.ageHours!).toBeLessThan(BACKUP_STALE_HOURS);
  });

  it("ignoriert Zeilen anderer kind-Werte (z.B. errorlog-prune)", async () => {
    await prisma.opsEvent.create({ data: { kind: "errorlog-prune", status: "ok", detail: "0 Zeilen" } });
    const status = await getBackupStatus();
    expect(status.status).toBe("missing");
  });
});
