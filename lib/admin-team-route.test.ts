// Tests für PUT /api/admin/team — beschränkt auf die entryDate/startDate-
// Synchronisierung (Produktionsfund: beide Felder liefen auseinander).
// Die übrige Verwaltung (Rolle, Status, Vorgesetzte Person, Pensum) ist
// nicht Gegenstand dieser Datei.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as adminTeamGet, PUT as adminTeamPut } from "@/app/api/admin/team/route";

const ORG = "test_admin_team_dates_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}
function jsonReq(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

let adminId: string, memberId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Admin Team Dates Test Org", slug: "admin-team-dates-test-org" } });
  adminId = (await prisma.user.create({ data: { email: "admin-team-dates-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } })).id;
  memberId = (await prisma.user.create({ data: { email: "admin-team-dates-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } })).id;
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date("2026-01-01"), startDate: new Date("2026-04-01") } });
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("GET /api/admin/team — entryDate ist der wirksame Wert", () => {
  it("liefert startDate statt des abweichenden, rein technischen entryDate", async () => {
    setSession(adminId, ORG, "admin");
    const res = await adminTeamGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    const m = body.members.find((x: any) => x.userId === memberId);
    expect(new Date(m.entryDate).toISOString().slice(0, 10)).toBe("2026-04-01"); // NICHT 2026-01-01
  });
});

describe("PUT /api/admin/team — entryDate und startDate bleiben synchron", () => {
  it("setzt startDate mit, wenn nur entryDate übergeben wird", async () => {
    setSession(adminId, ORG, "admin");
    const res = await adminTeamPut(jsonReq("/api/admin/team", { userId: memberId, entryDate: "2026-05-01" }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: memberId } } });
    expect(m?.entryDate.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(m?.startDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("setzt entryDate mit, wenn nur startDate übergeben wird", async () => {
    setSession(adminId, ORG, "admin");
    const res = await adminTeamPut(jsonReq("/api/admin/team", { userId: memberId, startDate: "2026-06-01" }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: memberId } } });
    expect(m?.entryDate.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(m?.startDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("werden beide explizit im selben Aufruf übergeben, gilt jeweils der eigene Wert", async () => {
    setSession(adminId, ORG, "admin");
    const res = await adminTeamPut(jsonReq("/api/admin/team", { userId: memberId, entryDate: "2026-01-10", startDate: "2026-04-15" }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: memberId } } });
    expect(m?.entryDate.toISOString().slice(0, 10)).toBe("2026-01-10");
    expect(m?.startDate?.toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("startDate löschen (null) setzt entryDate NICHT zurück — entryDate ist Pflichtfeld", async () => {
    setSession(adminId, ORG, "admin");
    const res = await adminTeamPut(jsonReq("/api/admin/team", { userId: memberId, startDate: null }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: memberId } } });
    expect(m?.startDate).toBeNull();
    expect(m?.entryDate.toISOString().slice(0, 10)).toBe("2026-01-10"); // unverändert vom vorigen Test
  });
});
