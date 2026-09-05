// Test für PUT /api/profile — deckt den Audit-Fund HOCH ab (REVIEW_LOOP.md):
// pensum/weeklyHours/vacationDays gingen bisher ungeprüft in die Membership,
// und startDate war dort ebenso frei schreibbar wie exitDate es NICHT ist,
// obwohl beide in sollStundenTag() (lib/calc.ts) spiegelbildlich wirken.
// Gleiches Muster wie lib/projects-route.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as profileGet, PUT as profilePut } from "@/app/api/profile/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_profile_route_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Profile Route Test Org", slug: "profile-route-test-org" } });
  const user = await prisma.user.create({ data: { email: "profile-route@example.test", password: "irrelevant", firstName: "P", lastName: "Rofile" } });
  userId = user.id;
  await prisma.membership.create({
    data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), startDate: new Date("2020-01-01"), pensum: 100, weeklyHours: 42 },
  });
  setSession(userId, ORG, "member");
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("PUT /api/profile — Bereichs-/Typprüfung für pensum/weeklyHours/vacationDays", () => {
  it("pensum: -100 wird mit 400 abgelehnt statt negative Sollstunden zu erzeugen", async () => {
    const res = await profilePut(jsonReq("/api/profile", "PUT", { pensum: -100 }));
    expect(res.status).toBe(400);

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId } } });
    expect(membership?.pensum).toBe(100); // unverändert
  });

  it("weeklyHours: 'vierzig' wird mit 400 abgelehnt statt eines 500ers auf einen Prisma-Typfehler", async () => {
    const res = await profilePut(jsonReq("/api/profile", "PUT", { weeklyHours: "vierzig" }));
    expect(res.status).toBe(400);
  });

  it("vacationDays: 200 (ausserhalb 0-60) wird mit 400 abgelehnt", async () => {
    const res = await profilePut(jsonReq("/api/profile", "PUT", { vacationDays: 200 }));
    expect(res.status).toBe(400);
  });

  it("gültige Werte innerhalb des Bereichs werden weiterhin gespeichert", async () => {
    const res = await profilePut(jsonReq("/api/profile", "PUT", { pensum: 80, weeklyHours: 40, vacationDays: 22 }));
    expect(res.status).toBe(200);

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId } } });
    expect(membership?.pensum).toBe(80);
    expect(membership?.weeklyHours).toBe(40);
    expect(membership?.vacationDays).toBe(22);
  });
});

describe("PUT /api/profile — startDate ist nicht mehr über das Profil änderbar (Audit-Fund HOCH)", () => {
  it("ein mitgeschicktes startDate wird ignoriert, nicht geschrieben", async () => {
    const before = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId } } });

    const res = await profilePut(jsonReq("/api/profile", "PUT", { startDate: "2026-08-01" }));
    expect(res.status).toBe(200);

    const after = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId } } });
    expect(after?.startDate?.toISOString()).toBe(before?.startDate?.toISOString());
  });

  it("GET /api/profile liefert startDate weiterhin nur lesend zurück", async () => {
    const res = await profileGet();
    const data = await res.json();
    expect(data.startDate).toBeTruthy();
  });
});
