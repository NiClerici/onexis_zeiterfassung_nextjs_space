// Tests für /api/customer-months (Plan "Kundenstunden monatlich statt
// täglich", Teil 2 — Erfassung). Ruft die Route-Handler direkt auf, gleiches
// Muster wie lib/month-locks.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as cmGet, PUT as cmPut } from "@/app/api/customer-months/route";
import { POST as mlPost } from "@/app/api/month-locks/route";

const ORG = "test_customer_months_org";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}
function getReq(url: string): Request {
  return new Request(`http://localhost${url}`);
}

let adminId: string, memberId: string, otherOrgUserId: string;
let customerId: string, projectId: string, otherCustomerId: string;
const OTHER_ORG = "test_customer_months_other_org";

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "CustomerMonth Test Org", slug: "customer-months-test-org" } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: "CustomerMonth Fremde Org", slug: "customer-months-fremde-org" } });

  const admin = await prisma.user.create({ data: { email: "cm-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } });
  const member = await prisma.user.create({ data: { email: "cm-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
  adminId = admin.id;
  memberId = member.id;
  const otherOrgUser = await prisma.user.create({ data: { email: "cm-otherorg@example.test", password: "irrelevant", firstName: "O", lastName: "Ther" } });
  otherOrgUserId = otherOrgUser.id;

  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: OTHER_ORG, userId: otherOrgUserId, role: "member", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "CM-Kunde", hourlyRate: 100 } });
  customerId = customer.id;
  const project = await prisma.project.create({ data: { orgId: ORG, customerId, name: "CM-Projekt", hourlyRate: 120 } });
  projectId = project.id;
  const otherCustomer = await prisma.customer.create({ data: { orgId: OTHER_ORG, name: "Fremder Kunde" } });
  otherCustomerId = otherCustomer.id;
});

afterAll(async () => {
  await prisma.customerMonth.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
  await prisma.monthLock.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
  await prisma.customer.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: [ORG, OTHER_ORG] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId, otherOrgUserId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, OTHER_ORG] } } });
});

describe("PUT/GET /api/customer-months — Grundfunktion", () => {
  it("member speichert seinen eigenen Monat: Direktstunden + Projektstunden gleichzeitig", async () => {
    setSession(memberId, ORG, "member");
    const putRes = await cmPut(
      jsonReq("/api/customer-months", "PUT", {
        year: 2026,
        month: 6,
        rows: [
          { customerId, hours: 3 },
          { customerId, projectId, hours: 5 },
        ],
      })
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.rows).toHaveLength(2);

    const getRes = await cmGet(getReq("/api/customer-months?year=2026&month=6"));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.rows).toHaveLength(2);
    const direct = body.rows.find((r: any) => r.projectId === null);
    const perProject = body.rows.find((r: any) => r.projectId === projectId);
    expect(direct.hours).toBe(3);
    expect(perProject.hours).toBe(5);
  });

  it("erneutes PUT ersetzt den Monat vollständig, statt Zeilen anzuhäufen", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 6, rows: [{ customerId, hours: 1 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].hours).toBe(1);
  });

  it("Nullzeilen werden nicht gespeichert", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 7, rows: [{ customerId, hours: 0 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(0);
  });

  it("GET liefert arbeitsstunden aus TimeEntry desselben Monats", async () => {
    const entry = await prisma.timeEntry.create({
      data: { userId: memberId, orgId: ORG, date: new Date("2026-08-10"), type: "arbeit", von: "08:00", bis: "16:00", pauseMin: 30 },
    });
    setSession(memberId, ORG, "member");
    const res = await cmGet(getReq("/api/customer-months?year=2026&month=8"));
    const body = await res.json();
    expect(body.arbeitsstunden).toBe(7.5);
    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });
});

describe("PUT /api/customer-months — Validierung", () => {
  it("fremde customerId (andere Organisation) wird abgelehnt", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 9, rows: [{ customerId: otherCustomerId, hours: 2 }] }));
    expect(res.status).toBe(400);
  });

  it("Projekt, das nicht zum angegebenen Kunden gehört, wird abgelehnt", async () => {
    const wrongCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "CM-Kunde-2" } });
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 9, rows: [{ customerId: wrongCustomer.id, projectId, hours: 2 }] }));
    expect(res.status).toBe(400);
    await prisma.customer.delete({ where: { id: wrongCustomer.id } });
  });

  it("negative oder unrealistisch hohe Stundenzahl wird abgelehnt", async () => {
    setSession(memberId, ORG, "member");
    const negRes = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 9, rows: [{ customerId, hours: -1 }] }));
    expect(negRes.status).toBe(400);
    const hugeRes = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 9, rows: [{ customerId, hours: 9000 }] }));
    expect(hugeRes.status).toBe(400);
  });

  it("dieselbe Kunde/Projekt-Kombination doppelt in einer Anfrage wird abgelehnt", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(
      jsonReq("/api/customer-months", "PUT", {
        year: 2026,
        month: 9,
        rows: [
          { customerId, hours: 1 },
          { customerId, hours: 2 },
        ],
      })
    );
    expect(res.status).toBe(400);
  });

  it("year/month ausserhalb des gültigen Bereichs liefert 400", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 13, rows: [] }));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/customer-months — Berechtigungen & Monatssperre", () => {
  it("member kann keinen fremden Monat schreiben", async () => {
    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 10, userId: adminId, rows: [] }));
    expect(res.status).toBe(403);
  });

  it("admin kann für ein anderes Mitglied schreiben", async () => {
    setSession(adminId, ORG, "admin");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 10, userId: memberId, rows: [{ customerId, hours: 2 }] }));
    expect(res.status).toBe(200);
    setSession(memberId, ORG, "member");
    const getRes = await cmGet(getReq("/api/customer-months?year=2026&month=10"));
    const body = await getRes.json();
    expect(body.rows).toHaveLength(1);
  });

  it("member kann in einem gesperrten Monat nicht mehr speichern (403)", async () => {
    setSession(adminId, ORG, "admin");
    await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 11 }));

    setSession(memberId, ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 11, rows: [{ customerId, hours: 1 }] }));
    expect(res.status).toBe(403);
  });

  it("admin kann trotz Sperre für member weiterhin den eigenen Monat schreiben", async () => {
    setSession(adminId, ORG, "admin");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 11, rows: [{ customerId, hours: 1 }] }));
    expect(res.status).toBe(200);
  });

  it("Nutzer aus einer fremden Organisation sieht 404 auf userId eines anderen Mitglieds", async () => {
    setSession(otherOrgUserId, OTHER_ORG, "member");
    const res = await cmPut(jsonReq("/api/customer-months", "PUT", { year: 2026, month: 6, userId: memberId, rows: [] }));
    expect(res.status).toBe(403); // fremde Rolle (member) darf schon resolveTargetUserId nicht erreichen
  });
});
