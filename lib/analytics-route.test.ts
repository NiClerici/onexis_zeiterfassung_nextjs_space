// Test für GET /api/analytics — deckt den Nebenbefund aus der Untersuchung
// des gemeldeten "Analytics zeigt scheinbar alte Zahlen"-Falls ab (siehe
// REVIEW_LOOP.md): type=custom fiel ohne/mit kaputten from/to bisher
// stillschweigend auf das ganze Jahr zurück bzw. ergab NaN-Vergleiche über
// "Invalid Date". Gleiches Muster wie lib/time-entries-conflict-route.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as analyticsGet } from "@/app/api/analytics/route";

function req(query: string): Request {
  return new Request(`http://localhost/api/analytics?${query}`);
}

const ORG = "test_analytics_route_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Analytics Route Test Org", slug: "analytics-route-test-org" } });
  const user = await prisma.user.create({ data: { email: "analytics-route@example.test", password: "irrelevant", firstName: "A", lastName: "Nalytics" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), startDate: new Date("2026-01-01") } });
  setSession(userId, ORG, "member");
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("GET /api/analytics — type=custom ohne oder mit ungültigem Zeitraum", () => {
  it("ganz ohne from/to wird mit 400 abgelehnt statt stillschweigend das ganze Jahr zu liefern", async () => {
    const res = await analyticsGet(req("type=custom"));
    expect(res.status).toBe(400);
  });

  it("nur from ohne to wird mit 400 abgelehnt", async () => {
    const res = await analyticsGet(req("type=custom&from=2026-01-01"));
    expect(res.status).toBe(400);
  });

  it("ein unparsbares Datum (kein Kalendertag) wird mit 400 abgelehnt statt Invalid Date/NaN durchzureichen", async () => {
    const res = await analyticsGet(req("type=custom&from=2026-02-30&to=2026-03-01"));
    expect(res.status).toBe(400);
  });

  it("to vor from wird mit 400 abgelehnt", async () => {
    const res = await analyticsGet(req("type=custom&from=2026-06-01&to=2026-01-01"));
    expect(res.status).toBe(400);
  });

  it("ein gültiger Zeitraum wird weiterhin akzeptiert (200)", async () => {
    const res = await analyticsGet(req("type=custom&from=2026-01-01&to=2026-01-31"));
    expect(res.status).toBe(200);
  });
});
