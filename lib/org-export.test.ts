// Tests für den vollständigen Organisationsexport und die Löschung
// (MIGRATION.md Punkt 12) — app/api/admin/organization/export/route.ts
// und app/api/admin/organization/route.ts. Ruft die Route-Handler direkt
// auf, gleiches Muster wie die übrigen Route-Tests dieses Loops.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as orgExportGet } from "@/app/api/admin/organization/export/route";
import { GET as orgGet, DELETE as orgDelete } from "@/app/api/admin/organization/route";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}
function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

describe("GET /api/admin/organization/export", () => {
  const ORG = "test_org_export_org";
  let ownerId: string, memberId: string, customerId: string;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG, name: "Org Export Test Org", slug: "org-export-test-org" } });
    const owner = await prisma.user.create({ data: { email: "org-export-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
    const member = await prisma.user.create({ data: { email: "org-export-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
    ownerId = owner.id;
    memberId = member.id;
    await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date() } });
    await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date() } });

    // Ein soft-gelöschter Eintrag — muss trotzdem im Export erscheinen.
    await prisma.timeEntry.create({
      data: { userId: memberId, orgId: ORG, date: new Date("2026-05-01"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30, deletedAt: new Date() },
    });

    const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Export-Kunde" } });
    customerId = customer.id;
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: memberId, year: 2026, month: 5, customerId, hours: 12.5 } });
  });

  afterAll(async () => {
    await prisma.customerMonth.deleteMany({ where: { orgId: ORG } });
    await prisma.customer.deleteMany({ where: { orgId: ORG } });
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
    await prisma.membership.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
  });

  it("member erhält 403", async () => {
    setSession(memberId, ORG, "member");
    const res = await orgExportGet(req("/api/admin/organization/export"));
    expect(res.status).toBe(403);
  });

  it("owner erhält ein vollständiges JSON inkl. soft-gelöschter Einträge", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await orgExportGet(req("/api/admin/organization/export?format=json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body.organization.id).toBe(ORG);
    expect(body.memberships).toHaveLength(2);
    expect(body.timeEntries).toHaveLength(1);
    expect(body.timeEntries[0].deletedAt).not.toBeNull(); // soft-gelöscht, trotzdem enthalten
    expect(body.customerMonths).toHaveLength(1);
    expect(body.customerMonths[0]).toMatchObject({ year: 2026, month: 5, customerId, hours: 12.5 });
  });

  it("liefert ein gültiges xlsx bei format=excel", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await orgExportGet(req("/api/admin/organization/export?format=excel"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });
});

describe("GET /api/admin/organization", () => {
  const ORG = "test_org_get_org";
  let ownerId: string, memberId: string;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG, name: "Org Get Test Org", slug: "org-get-test-org", plan: "starter" } });
    const owner = await prisma.user.create({ data: { email: "org-get-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
    const member = await prisma.user.create({ data: { email: "org-get-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
    ownerId = owner.id;
    memberId = member.id;
    await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date() } });
    await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date() } });
  });

  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
  });

  it("member erhält 403", async () => {
    setSession(memberId, ORG, "member");
    const res = await orgGet();
    expect(res.status).toBe(403);
  });

  it("owner erhält Name/Plan der eigenen Organisation", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await orgGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Org Get Test Org");
    expect(body.plan).toBe("starter");
  });
});

describe("DELETE /api/admin/organization", () => {
  const ORG = "test_org_delete_org";
  let ownerId: string, adminId: string;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG, name: "Org Delete Test Org", slug: "org-delete-test-org" } });
    const owner = await prisma.user.create({ data: { email: "org-delete-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
    const admin = await prisma.user.create({ data: { email: "org-delete-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } });
    ownerId = owner.id;
    adminId = admin.id;
    await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date() } });
    await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date() } });

    const entry = await prisma.timeEntry.create({
      data: { userId: ownerId, orgId: ORG, date: new Date("2026-05-01"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 },
    });
    await prisma.timeEntryAudit.create({ data: { entryId: entry.id, orgId: ORG, changedBy: ownerId, field: "bis", oldValue: "16:00", newValue: "17:00" } });
    await prisma.monthLock.create({ data: { orgId: ORG, userId: ownerId, year: 2026, month: 5, lockedBy: ownerId } });
    await prisma.monthLockAudit.create({ data: { orgId: ORG, userId: ownerId, year: 2026, month: 5, action: "locked", performedBy: ownerId } });
    const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Delete-Test-Kunde" } });
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: ownerId, year: 2026, month: 5, customerId: customer.id, hours: 3 } });
  });

  it("admin darf die Organisation nicht löschen (nur owner)", async () => {
    setSession(adminId, ORG, "admin");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    const res = await orgDelete(jsonReq("/api/admin/organization", "DELETE", { confirmName: org.name }));
    expect(res.status).toBe(403);
  });

  it("owner braucht den exakten Organisationsnamen zur Bestätigung", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await orgDelete(jsonReq("/api/admin/organization", "DELETE", { confirmName: "Falscher Name" }));
    expect(res.status).toBe(400);
    // Organisation existiert danach noch.
    const stillExists = await prisma.organization.findUnique({ where: { id: ORG } });
    expect(stillExists).not.toBeNull();
  });

  it("owner löscht die Organisation vollständig inkl. beider Audit-Trails", async () => {
    setSession(ownerId, ORG, "owner");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    const res = await orgDelete(jsonReq("/api/admin/organization", "DELETE", { confirmName: org.name }));
    expect(res.status).toBe(200);

    expect(await prisma.organization.findUnique({ where: { id: ORG } })).toBeNull();
    expect(await prisma.membership.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.timeEntry.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.timeEntryAudit.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.monthLock.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.monthLockAudit.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.customerMonth.count({ where: { orgId: ORG } })).toBe(0);

    // Die User-Konten selbst überleben — nur ihre Mitgliedschaft in DIESER
    // Organisation ist weg (ein Mensch kann in mehreren Organisationen sein).
    expect(await prisma.user.findUnique({ where: { id: ownerId } })).not.toBeNull();

    // Aufräumen der User-Konten (waren nicht Teil der Organisation selbst).
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });
});
