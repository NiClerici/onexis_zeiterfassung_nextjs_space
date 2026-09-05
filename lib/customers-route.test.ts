// Test für GET/POST/DELETE /api/customers — deckt die beiden Audit-Funde ab
// (REVIEW_LOOP.md): KRITISCH ("Jedes Mitglied kann Kunden löschen") und HOCH
// ("Kundenerfassung ist für die Rolle member eine Sackgasse"). Gleiches
// Muster wie lib/projects-route.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as customersGet, POST as customersPost, DELETE as customersDelete } from "@/app/api/customers/route";

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

const ORG = "test_customers_route_org";
let memberId: string;
let otherMemberId: string;
let ownerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Customers Route Test Org", slug: "customers-route-test-org" } });

  const member = await prisma.user.create({ data: { email: "customers-route-member@example.test", password: "irrelevant", firstName: "M", lastName: "Route" } });
  memberId = member.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date("2026-01-01") } });

  const otherMember = await prisma.user.create({ data: { email: "customers-route-other@example.test", password: "irrelevant", firstName: "O", lastName: "Route" } });
  otherMemberId = otherMember.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: otherMemberId, role: "member", entryDate: new Date("2026-01-01") } });

  const owner = await prisma.user.create({ data: { email: "customers-route-owner@example.test", password: "irrelevant", firstName: "Ow", lastName: "Route" } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01") } });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.customerMonth.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [memberId, otherMemberId, ownerId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("GET/POST /api/customers — createdBy macht einen frisch angelegten Kunden sofort sichtbar", () => {
  it("ein member sieht einen selbst angelegten, noch nie bebuchten Kunden sofort in der eigenen Liste", async () => {
    setSession(memberId, ORG, "member");

    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Frisch-Angelegt AG" }));
    expect(created.status).toBe(200);
    const { customer } = await created.json();
    expect(customer.name).toBe("Frisch-Angelegt AG");

    // Vor dem Fix (kein Customer.createdBy) wäre die Liste hier leer
    // geblieben — der Kunde war eine Sackgasse (REVIEW_LOOP.md Batch 5).
    const listed = await customersGet();
    const { customers } = await listed.json();
    expect(customers.some((c: any) => c.id === customer.id)).toBe(true);
  });

  it("ein anderes member ohne eigene Buchung sieht den fremden, selbst angelegten Kunden nicht (Portfoliotrennung bleibt bestehen)", async () => {
    setSession(memberId, ORG, "member");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Nur-Fuer-Member AG" }));
    const { customer } = await created.json();

    setSession(otherMemberId, ORG, "member");
    const listed = await customersGet();
    const { customers } = await listed.json();
    expect(customers.some((c: any) => c.id === customer.id)).toBe(false);
  });

  it("owner/admin sehen weiterhin alle Kunden der Organisation", async () => {
    setSession(memberId, ORG, "member");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Fuer-Owner-Sichtbar AG" }));
    const { customer } = await created.json();

    setSession(ownerId, ORG, "owner");
    const listed = await customersGet();
    const { customers } = await listed.json();
    expect(customers.some((c: any) => c.id === customer.id)).toBe(true);
  });
});

describe("DELETE /api/customers — Rollenprüfung und Referenzsperre (Audit-Fund KRITISCH)", () => {
  it("ein member darf den selbst angelegten Kunden löschen", async () => {
    setSession(memberId, ORG, "member");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Eigener-Loeschbar AG" }));
    const { customer } = await created.json();

    const deleted = await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
    expect(deleted.status).toBe(200);
  });

  it("ein member darf einen fremden Kunden NICHT löschen (403)", async () => {
    setSession(ownerId, ORG, "owner");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Owner-Angelegt AG" }));
    const { customer } = await created.json();

    setSession(memberId, ORG, "member");
    const deleted = await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
    expect(deleted.status).toBe(403);

    // aufräumen
    setSession(ownerId, ORG, "owner");
    await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
  });

  it("ein bebuchter Kunde kann von KEINER Rolle gelöscht werden — 409 nennt die Zahl der Zeiteinträge", async () => {
    setSession(ownerId, ORG, "owner");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Bebuchte-Firma AG" }));
    const { customer } = await created.json();

    await prisma.timeEntry.create({
      data: { userId: memberId, orgId: ORG, date: new Date("2026-04-10"), type: "arbeit", customerId: customer.id, hours: 8 },
    });

    // member (auch wenn es sein eigener Kunde wäre) UND owner werden beide
    // abgewiesen — die Referenzsperre ist rollenunabhängig, das ist der
    // eigentliche Schutz vor dem Audit-Fund (ein versehentlicher Klick durch
    // owner/admin selbst hätte eine reine Rollenprüfung nicht verhindert).
    const deletedByOwner = await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
    expect(deletedByOwner.status).toBe(409);
    const dataOwner = await deletedByOwner.json();
    expect(dataOwner.error).toContain("1 Zeiteintrag");

    setSession(memberId, ORG, "member");
    const deletedByMember = await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
    expect(deletedByMember.status).toBe(403); // member ist ohnehin nicht createdBy, greift zuerst

    // aufräumen
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, customerId: customer.id } });
    setSession(ownerId, ORG, "owner");
    await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
  });

  it("ein bebuchter, SELBST angelegter Kunde eines member wird ebenfalls per 409 gesperrt (nicht per 403)", async () => {
    setSession(memberId, ORG, "member");
    const created = await customersPost(jsonReq("/api/customers", "POST", { name: "Eigene-Bebuchte AG" }));
    const { customer } = await created.json();

    await prisma.timeEntry.create({
      data: { userId: memberId, orgId: ORG, date: new Date("2026-05-05"), type: "arbeit", customerId: customer.id, hours: 4 },
    });

    const deleted = await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
    expect(deleted.status).toBe(409);

    // aufräumen
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, customerId: customer.id } });
    await customersDelete(jsonReq("/api/customers", "DELETE", { id: customer.id }));
  });
});
