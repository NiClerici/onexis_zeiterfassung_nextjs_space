// Test für HARDENING.md A2-Nachtrag (Projektaufteilung): bulk-apply
// (Standardwoche einfüllen) darf einen Tag mit mehreren bestehenden Zeilen
// (z.B. Arbeitszeit auf zwei Projekte verteilt) nicht anfassen — welche der
// Zeilen "die" zu ersetzende wäre, ist mehrdeutig. Ruft den Route-Handler
// direkt auf, gleiches Muster wie lib/month-locks.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as bulkApplyPost } from "@/app/api/time-entries/bulk-apply/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_bulk_apply_multi_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Bulk Apply Multi Test Org", slug: "bulk-apply-multi-test-org" } });
  const user = await prisma.user.create({ data: { email: "bulk-apply-multi@example.test", password: "irrelevant", firstName: "B", lastName: "Ulk" } });
  userId = user.id;
  await prisma.membership.create({
    data: {
      orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"),
      stdHoursMon: 8, stdHoursTue: 8, stdHoursWed: 8, stdHoursThu: 8, stdHoursFri: 8,
    },
  });
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("bulk-apply an einem Tag mit mehreren Zeilen (Projektaufteilung)", () => {
  it("lässt einen Tag mit zwei bestehenden Zeilen unangetastet, auch mit overwriteExisting", async () => {
    setSession(userId, ORG, "member");
    const day = new Date("2026-07-13T00:00:00.000Z"); // Mo
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt A" } });
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt B" } });

    const res = await bulkApplyPost(
      jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: "2026-07-13", toDate: "2026-07-13", overwriteExisting: true })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.updated).toBe(0);
    expect(body.skippedMultiple).toBe(1);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === "arbeit" && r.hours === 4)).toBe(true);
  });

  it("befüllt einen leeren Tag weiterhin normal (Regressionsschutz)", async () => {
    setSession(userId, ORG, "member");
    const res = await bulkApplyPost(
      jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: "2026-07-14", toDate: "2026-07-14", overwriteExisting: false })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skippedMultiple).toBe(0);
  });
});
