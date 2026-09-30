// Tests für PUT /api/team/member-dates — Eintrittsdatum ändern, neu auch für
// manager (bisher nur owner/admin über die volle Mitgliederverwaltung PUT
// /api/admin/team). Berechtigung folgt derselben Regel wie der
// Monatsabschluss: owner/admin für alle, manager nur für sich selbst und
// direkt Unterstellte (assertCanManageMember, lib/access.ts). Bewusst kein
// separates Startdatum mehr — buildProfil() (lib/export-helpers.test.ts)
// fällt dafür auf entryDate zurück.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { PUT as memberDatesPut } from "@/app/api/team/member-dates/route";

const ORG = "test_member_dates_org";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/team/member-dates", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

let adminId: string, managerId: string, reportId: string, strangerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Member Dates Test Org", slug: "member-dates-test-org" } });
  const mk = async (email: string) => (await prisma.user.create({ data: { email, password: "irrelevant", firstName: "T", lastName: "Est" } })).id;
  adminId = await mk("member-dates-admin@example.test");
  managerId = await mk("member-dates-manager@example.test");
  reportId = await mk("member-dates-report@example.test");
  strangerId = await mk("member-dates-stranger@example.test");

  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  const managerMembership = await prisma.membership.create({ data: { orgId: ORG, userId: managerId, role: "manager", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: reportId, role: "member", managerId: managerMembership.id, entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: strangerId, role: "member", entryDate: new Date("2026-01-01") } });
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId, reportId, strangerId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("PUT /api/team/member-dates — Berechtigung", () => {
  it("member erhält 403", async () => {
    setSession(strangerId, ORG, "member");
    const res = await memberDatesPut(jsonReq({ userId: strangerId, entryDate: "2026-03-01" }));
    expect(res.status).toBe(403);
  });

  it("manager darf das Eintrittsdatum der eigenen, direkt unterstellten Person setzen", async () => {
    setSession(managerId, ORG, "manager");
    const res = await memberDatesPut(jsonReq({ userId: reportId, entryDate: "2026-03-15" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryDate?.slice(0, 10)).toBe("2026-03-15");
  });

  it("manager darf sein eigenes Eintrittsdatum setzen", async () => {
    setSession(managerId, ORG, "manager");
    const res = await memberDatesPut(jsonReq({ userId: managerId, entryDate: "2026-02-01" }));
    expect(res.status).toBe(200);
  });

  it("manager darf ein fremdes, nicht unterstelltes Mitglied nicht ändern (403)", async () => {
    setSession(managerId, ORG, "manager");
    const before = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: strangerId } } });
    const res = await memberDatesPut(jsonReq({ userId: strangerId, entryDate: "2026-03-01" }));
    expect(res.status).toBe(403);
    const after = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: strangerId } } });
    expect(after?.entryDate).toEqual(before?.entryDate);
  });

  it("admin darf jedes Mitglied ändern, auch ausserhalb seines Teams", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: strangerId, entryDate: "2026-01-15" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryDate.slice(0, 10)).toBe("2026-01-15");
  });
});

describe("PUT /api/team/member-dates — Validierung", () => {
  it("ungültiges Eintrittsdatum liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: reportId, entryDate: "keinDatum" }));
    expect(res.status).toBe(400);
  });

  it("leerer String liefert 400 (Eintrittsdatum ist Pflichtfeld, kann nicht gelöscht werden)", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: reportId, entryDate: "" }));
    expect(res.status).toBe(400);
  });

  it("fehlendes entryDate im Body liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: reportId }));
    expect(res.status).toBe(400);
  });

  it("Austrittsdatum im Body wird ignoriert — die Route kennt nur entryDate/startDate", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: reportId, entryDate: "2026-04-01", exitDate: "2026-05-01" }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: reportId } } });
    expect(m?.exitDate).toBeNull();
  });

  it("unbekannte userId liefert 404", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ userId: "does-not-exist", entryDate: "2026-01-01" }));
    expect(res.status).toBe(404);
  });

  it("fehlende userId liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await memberDatesPut(jsonReq({ entryDate: "2026-01-01" }));
    expect(res.status).toBe(400);
  });
});

// Audit-Fund: entryDate und startDate liefen bei bereits laufenden Firmen,
// die die App erst später einführen, um Monate auseinander (entryDate =
// rein technisches Anlage-Datum der Mitgliedschaft, startDate = echter,
// separat gepflegter Arbeitsbeginn) — sichtbar u.a. in lib/team-route.test.ts
// "Soll zählt erst ab dem Eintrittsdatum...". Diese Route synct startDate
// deshalb NUR, wenn dort noch kein eigener Wert steht, damit ein bereits
// korrekt gesetztes (historisches) startDate nie überschrieben wird.
describe("PUT /api/team/member-dates — startDate-Synchronisierung", () => {
  let freshId: string;

  beforeAll(async () => {
    freshId = (await prisma.user.create({ data: { email: "member-dates-sync@example.test", password: "irrelevant", firstName: "Sync", lastName: "Fresh" } })).id;
    await prisma.membership.create({ data: { orgId: ORG, userId: freshId, role: "member", entryDate: new Date("2026-01-01") } });
  });

  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { orgId: ORG, userId: freshId } });
    await prisma.user.delete({ where: { id: freshId } });
  });

  it("startDate war null: wird beim ersten Setzen von entryDate mitgezogen", async () => {
    setSession(adminId, ORG, "admin");
    const before = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: freshId } } });
    expect(before?.startDate).toBeNull();

    const res = await memberDatesPut(jsonReq({ userId: freshId, entryDate: "2026-05-01" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.startDate?.slice(0, 10)).toBe("2026-05-01");
    const after = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId: freshId } } });
    expect(after?.startDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("startDate ist bereits gesetzt: eine spätere entryDate-Korrektur lässt es unangetastet", async () => {
    setSession(adminId, ORG, "admin");
    // freshId hat aus dem vorigen Test bereits startDate=2026-05-01.
    const res = await memberDatesPut(jsonReq({ userId: freshId, entryDate: "2026-09-01" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryDate.slice(0, 10)).toBe("2026-09-01");
    expect(body.startDate?.slice(0, 10)).toBe("2026-05-01"); // unverändert
  });
});
