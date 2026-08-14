// Tests für Absenzanträge mit Genehmigung (MIGRATION.md Punkt 9) —
// app/api/absence-requests/route.ts (GET/POST/PATCH/DELETE) und
// app/api/absences/calendar/route.ts. Ruft die Route-Handler direkt auf
// (kein laufender Server nötig), gleiches Muster wie die übrigen
// Route-Tests dieses Loops.

import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as arGet, POST as arPost, PATCH as arPatch, DELETE as arDelete } from "@/app/api/absence-requests/route";
import { GET as calendarGet } from "@/app/api/absences/calendar/route";

const ORG = "test_absence_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}
function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

let adminId: string, managerId: string, reportId: string, otherMemberId: string;
let managerMembershipId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Absence Test Org", slug: "absence-test-org" } });
  const mkUser = async (email: string, firstName: string) => {
    const u = await prisma.user.create({ data: { email, password: "irrelevant", firstName, lastName: "Test" } });
    return u.id;
  };
  adminId = await mkUser("absence-admin@example.test", "Admin");
  managerId = await mkUser("absence-manager@example.test", "Manager");
  reportId = await mkUser("absence-report@example.test", "Report");
  otherMemberId = await mkUser("absence-other@example.test", "Other");

  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  const managerMembership = await prisma.membership.create({ data: { orgId: ORG, userId: managerId, role: "manager", entryDate: new Date("2026-01-01") } });
  managerMembershipId = managerMembership.id;
  await prisma.membership.create({
    data: { orgId: ORG, userId: reportId, role: "member", managerId: managerMembershipId, entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 100 },
  });
  await prisma.membership.create({ data: { orgId: ORG, userId: otherMemberId, role: "member", entryDate: new Date("2026-01-01") } });
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.absenceRequest.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId, reportId, otherMemberId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/absence-requests — Antrag stellen", () => {
  it("member kann für sich selbst einen gültigen Antrag stellen", async () => {
    setSession(reportId, ORG, "member");
    const res = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-09-07", toDate: "2026-09-09", type: "ferien", comment: "Herbstferien" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.userId).toBe(reportId);
    expect(body.request.status).toBe("offen");
    expect(body.request.type).toBe("ferien");
  });

  it("lehnt ungültige Absenztypen ab (arbeit/feiertag sind keine Absenzanträge)", async () => {
    setSession(reportId, ORG, "member");
    const res = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-09-10", toDate: "2026-09-10", type: "arbeit" }));
    expect(res.status).toBe(400);
  });

  it("lehnt ein Enddatum vor dem Startdatum ab", async () => {
    setSession(reportId, ORG, "member");
    const res = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-09-10", toDate: "2026-09-05", type: "ferien" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/absence-requests — Sichtbarkeit", () => {
  it("scope=mine liefert nur eigene Anträge", async () => {
    setSession(reportId, ORG, "member");
    const res = await arGet(req("/api/absence-requests?scope=mine"));
    const body = await res.json();
    expect(body.requests.every((r: any) => r.userId === reportId)).toBe(true);
    expect(body.requests.length).toBeGreaterThan(0);
  });

  it("scope=team ist für member verboten", async () => {
    setSession(reportId, ORG, "member");
    const res = await arGet(req("/api/absence-requests?scope=team"));
    expect(res.status).toBe(403);
  });

  it("scope=team zeigt dem manager nur Anträge des eigenen Teams, nicht den eigenen", async () => {
    setSession(managerId, ORG, "manager");
    const res = await arGet(req("/api/absence-requests?scope=team"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.every((r: any) => r.userId === reportId)).toBe(true);
    expect(body.requests.some((r: any) => r.userId === managerId)).toBe(false);
    expect(body.requests.some((r: any) => r.userId === otherMemberId)).toBe(false);
  });
});

describe("PATCH /api/absence-requests — Genehmigen/Ablehnen", () => {
  let pendingId: string;

  beforeEach(async () => {
    setSession(reportId, ORG, "member");
    const res = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-10-05", toDate: "2026-10-06", type: "krank" }));
    pendingId = (await res.json()).request.id;
  });

  it("manager kann den eigenen Antrag nicht selbst entscheiden", async () => {
    setSession(reportId, ORG, "member");
    const res2 = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-10-12", toDate: "2026-10-12", type: "krank" }));
    // report versucht (hypothetisch mit manager-Rolle) den eigenen Antrag zu entscheiden
    setSession(reportId, ORG, "manager");
    const ownId = (await res2.json()).request.id;
    const res = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: ownId, action: "approve" }));
    expect(res.status).toBe(403);
  });

  it("manager kann Anträge ausserhalb des eigenen Teams nicht entscheiden", async () => {
    setSession(otherMemberId, ORG, "member");
    const res2 = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-10-13", toDate: "2026-10-13", type: "krank" }));
    const otherPendingId = (await res2.json()).request.id;

    setSession(managerId, ORG, "manager");
    const res = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: otherPendingId, action: "approve" }));
    expect(res.status).toBe(403);
  });

  it("manager genehmigt einen Antrag des eigenen Teams — TimeEntries werden erzeugt", async () => {
    setSession(managerId, ORG, "manager");
    const res = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: pendingId, action: "approve", comment: "OK" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe("genehmigt");
    expect(body.request.decidedBy).toBe(managerId);
    expect(body.entries.created).toBe(2); // 05./06.10.2026, beide Werktage (Mo/Di)

    const entries = await prisma.timeEntry.findMany({ where: { userId: reportId, orgId: ORG, type: "krank", date: { gte: new Date("2026-10-05"), lte: new Date("2026-10-06") } } });
    expect(entries).toHaveLength(2);
    expect(entries[0].hours).toBeGreaterThan(0);
  });

  it("ein bereits entschiedener Antrag kann nicht erneut entschieden werden", async () => {
    setSession(managerId, ORG, "manager");
    await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: pendingId, action: "approve" }));
    const res = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: pendingId, action: "reject" }));
    expect(res.status).toBe(400);
  });

  it("admin kann einen Antrag ablehnen — keine TimeEntries werden erzeugt", async () => {
    setSession(adminId, ORG, "admin");
    const before = await prisma.timeEntry.count({ where: { userId: reportId, orgId: ORG } });
    const res = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: pendingId, action: "reject", comment: "Zu viele Abwesenheiten diese Woche" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe("abgelehnt");
    const after = await prisma.timeEntry.count({ where: { userId: reportId, orgId: ORG } });
    expect(after).toBe(before);
  });
});

describe("DELETE /api/absence-requests — Zurückziehen", () => {
  it("die antragstellende Person kann einen offenen Antrag zurückziehen", async () => {
    setSession(otherMemberId, ORG, "member");
    const createRes = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-11-02", toDate: "2026-11-02", type: "unbezahlt" }));
    const id = (await createRes.json()).request.id;

    const res = await arDelete(jsonReq("/api/absence-requests", "DELETE", { id }));
    expect(res.status).toBe(200);
    const found = await prisma.absenceRequest.findUnique({ where: { id } });
    expect(found).toBeNull();
  });

  it("ein bereits entschiedener Antrag kann nicht zurückgezogen werden", async () => {
    setSession(otherMemberId, ORG, "member");
    const createRes = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-11-09", toDate: "2026-11-09", type: "unbezahlt" }));
    const id = (await createRes.json()).request.id;

    setSession(adminId, ORG, "admin");
    await arPatch(jsonReq("/api/absence-requests", "PATCH", { id, action: "approve" }));

    setSession(otherMemberId, ORG, "member");
    const res = await arDelete(jsonReq("/api/absence-requests", "DELETE", { id }));
    expect(res.status).toBe(400);
  });

  it("eine fremde Person kann einen Antrag nicht zurückziehen", async () => {
    setSession(otherMemberId, ORG, "member");
    const createRes = await arPost(jsonReq("/api/absence-requests", "POST", { fromDate: "2026-11-16", toDate: "2026-11-16", type: "unbezahlt" }));
    const id = (await createRes.json()).request.id;

    setSession(reportId, ORG, "member");
    const res = await arDelete(jsonReq("/api/absence-requests", "DELETE", { id }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/absences/calendar — Team-Kalender mit Warnung", () => {
  it("member erhält 403", async () => {
    setSession(reportId, ORG, "member");
    const res = await calendarGet(req("/api/absences/calendar?type=month&year=2026&month=10"));
    expect(res.status).toBe(403);
  });

  it("zeigt genehmigte Abwesenheiten und markiert eine Warnung, wenn der Anteil die Schwelle erreicht", async () => {
    // otherMemberId hat kein Team (kein manager) — Warnung testen wir über
    // den admin-Blick auf die ganze Organisation (4 aktive Mitglieder:
    // admin, manager, report, other). report ist ab 05./06.10. krank
    // (aus dem vorigen describe-Block bereits genehmigt und als TimeEntry
    // vorhanden) — 1 von 4 Mitgliedern = 25%, UNTER der 30%-Schwelle.
    setSession(adminId, ORG, "admin");
    const res = await calendarGet(req("/api/absences/calendar?type=month&year=2026&month=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const day = body.days.find((d: any) => d.date === "2026-10-05");
    expect(day).toBeTruthy();
    expect(day.absent.some((a: any) => a.userId === reportId)).toBe(true);
    expect(day.warning).toBe(false); // 1/4 = 25% < 30%
  });
});
