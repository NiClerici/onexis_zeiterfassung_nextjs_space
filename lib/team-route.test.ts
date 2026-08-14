// Tests für /api/team (MIGRATION.md Punkt 8) — Berechtigungs-Scoping
// (member verboten, manager sieht nur sein Team, admin/owner sehen alle)
// und ein Sanity-Check der Kunden-/Projektaggregation. Die zugrunde-
// liegende Berechnung (teamKennzahlen, wochenUebersicht) ist bereits
// vollständig in lib/calc.test.ts getestet — hier geht es nur um die
// Route-Ebene: wer sieht was.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as teamGet } from "@/app/api/team/route";

const ORG = "test_team_route_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}

let ownerId: string, adminId: string, managerId: string, reportId: string, otherMemberId: string;
let managerMembershipId: string;
let customerId: string, projectId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Team Route Test Org", slug: "team-route-test-org" } });
  const mkUser = async (email: string, firstName: string) => {
    const u = await prisma.user.create({ data: { email, password: "irrelevant", firstName, lastName: "Test" } });
    return u.id;
  };
  ownerId = await mkUser("team-route-owner@example.test", "Owner");
  adminId = await mkUser("team-route-admin@example.test", "Admin");
  managerId = await mkUser("team-route-manager@example.test", "Manager");
  reportId = await mkUser("team-route-report@example.test", "Report");
  otherMemberId = await mkUser("team-route-other@example.test", "Other");

  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  const managerMembership = await prisma.membership.create({ data: { orgId: ORG, userId: managerId, role: "manager", entryDate: new Date("2026-01-01") } });
  managerMembershipId = managerMembership.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: reportId, role: "member", managerId: managerMembershipId, entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: otherMemberId, role: "member", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Team-Route-Kunde", hourlyRate: 150 } });
  customerId = customer.id;
  const project = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Team-Route-Projekt", hourlyRate: 200, budgetHours: 5 } });
  projectId = project.id;

  // report arbeitet 6h an diesem Projekt — über dem Budget von 5h, für den
  // "ueberzogen"-Sanity-Check.
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-03"), type: "arbeit", von: "08:00", bis: "14:00", pauseMin: 0, customerId, projectId, billable: true },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, managerId, reportId, otherMemberId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

const MONTH_QS = "type=month&year=2026&month=8";

describe("GET /api/team — Berechtigungs-Scoping", () => {
  it("member erhält 403", async () => {
    setSession(otherMemberId, ORG, "member");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(403);
  });

  it("manager sieht nur sich selbst + direkt unterstellte Mitglieder", async () => {
    setSession(managerId, ORG, "manager");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const userIds = body.members.map((m: any) => m.userId);
    expect(userIds).toContain(managerId);
    expect(userIds).toContain(reportId);
    expect(userIds).not.toContain(otherMemberId);
    expect(userIds).not.toContain(ownerId);
  });

  it("admin sieht alle Mitglieder der Organisation", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const userIds = body.members.map((m: any) => m.userId);
    expect(userIds).toEqual(expect.arrayContaining([ownerId, adminId, managerId, reportId, otherMemberId]));
  });
});

describe("GET /api/team — Kunden-/Projektsicht, Heatmap, Prognose, Feriensaldo", () => {
  it("liefert Projektstunden, erkennt Budgetüberschreitung, und rechnet den Umsatz aus dem Stundensatz", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const project = body.projects.find((p: any) => p.id === projectId);
    expect(project).toBeTruthy();
    expect(project.stunden).toBe(6);
    expect(project.ueberzogen).toBe(true); // 6h > budgetHours (5h)
    expect(project.umsatz).toBe(1200); // 6h * 200 CHF/h

    const customer = body.customers.find((c: any) => c.id === customerId);
    expect(customer.stunden).toBe(6); // die Projektstunden fliessen in die Kundensicht ein
  });

  it("jedes Mitglied hat einen Feriensaldo, eine Heatmap- und eine Prognose-Wochenliste", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.feriensaldo).toBeTruthy();
    expect(typeof reportMember.feriensaldo.anspruch).toBe("number");

    const reportHeatmap = body.heatmap.find((h: any) => h.userId === reportId);
    expect(Array.isArray(reportHeatmap.weeks)).toBe(true);
    expect(reportHeatmap.weeks.length).toBeGreaterThan(0);

    const reportForecast = body.forecast.find((f: any) => f.userId === reportId);
    expect(Array.isArray(reportForecast.weeks)).toBe(true);
  });

  it("totals sind über alle sichtbaren Mitglieder aggregiert", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    expect(body.totals.ist).toBeGreaterThanOrEqual(6); // mindestens reports 6h
  });
});
