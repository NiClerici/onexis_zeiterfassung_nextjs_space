import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { canSeeUser, scopeToOrg, requireRole, AccessError, type OrgContext } from "@/lib/access";
import bcrypt from "bcryptjs";

// canSeeUser trifft eine DB-Query (Membership-Lookup) — hier gegen die echte
// Dev-DB getestet (kein Mock-Prisma im Projekt), mit eigenem, eindeutig
// präfigiertem Testdatensatz, der am Ende vollständig wieder entfernt wird.
describe("scopeToOrg", () => {
  it("hängt orgId an ein bestehendes where", () => {
    expect(scopeToOrg("org1", { userId: "u1" })).toEqual({ userId: "u1", orgId: "org1" });
  });

  it("funktioniert auch ohne bestehendes where", () => {
    expect(scopeToOrg("org1")).toEqual({ orgId: "org1" });
  });
});

describe("requireRole", () => {
  it("wirft AccessError, wenn die Rolle nicht erlaubt ist", () => {
    expect(() => requireRole("member", ["admin", "owner"])).toThrow(AccessError);
  });

  it("wirft nicht, wenn die Rolle erlaubt ist", () => {
    expect(() => requireRole("admin", ["admin", "owner"])).not.toThrow();
  });

  it("AccessError trägt den erwarteten Status", () => {
    try {
      requireRole("member", ["admin"]);
      expect.fail("sollte werfen");
    } catch (e: any) {
      expect(e).toBeInstanceOf(AccessError);
      expect(e.status).toBe(403);
    }
  });
});

describe("canSeeUser", () => {
  const orgId = "test_access_org";
  let ownerId: string, adminId: string, managerId: string, reportId: string, otherMemberId: string;
  let managerMembershipId: string;

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: "Access Test Org", slug: "access-test-org" } });

    const mkUser = async (email: string) => {
      const u = await prisma.user.create({
        data: { email, password: await bcrypt.hash("irrelevant1234", 10), firstName: "T", lastName: "U" },
      });
      return u.id;
    };
    ownerId = await mkUser("access-test-owner@example.test");
    adminId = await mkUser("access-test-admin@example.test");
    managerId = await mkUser("access-test-manager@example.test");
    reportId = await mkUser("access-test-report@example.test");
    otherMemberId = await mkUser("access-test-other@example.test");

    await prisma.membership.create({ data: { orgId, userId: ownerId, role: "owner", entryDate: new Date() } });
    await prisma.membership.create({ data: { orgId, userId: adminId, role: "admin", entryDate: new Date() } });
    const managerMembership = await prisma.membership.create({ data: { orgId, userId: managerId, role: "manager", entryDate: new Date() } });
    managerMembershipId = managerMembership.id;
    await prisma.membership.create({ data: { orgId, userId: reportId, role: "member", managerId: managerMembershipId, entryDate: new Date() } });
    // otherMemberId: Mitglied derselben Organisation, aber NICHT dem Manager unterstellt
    await prisma.membership.create({ data: { orgId, userId: otherMemberId, role: "member", entryDate: new Date() } });
  });

  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, managerId, reportId, otherMemberId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("jede Rolle sieht sich selbst", async () => {
    const ctx: OrgContext = { userId: reportId, orgId, role: "member" };
    expect(await canSeeUser(ctx, reportId)).toBe(true);
  });

  it("member sieht niemanden ausser sich selbst", async () => {
    const ctx: OrgContext = { userId: reportId, orgId, role: "member" };
    expect(await canSeeUser(ctx, otherMemberId)).toBe(false);
    expect(await canSeeUser(ctx, managerId)).toBe(false);
  });

  it("manager sieht direkt unterstellte Mitglieder", async () => {
    const ctx: OrgContext = { userId: managerId, orgId, role: "manager" };
    expect(await canSeeUser(ctx, reportId)).toBe(true);
  });

  it("manager sieht NICHT nicht-unterstellte Mitglieder", async () => {
    const ctx: OrgContext = { userId: managerId, orgId, role: "manager" };
    expect(await canSeeUser(ctx, otherMemberId)).toBe(false);
  });

  it("admin sieht alle Mitglieder der Organisation", async () => {
    const ctx: OrgContext = { userId: adminId, orgId, role: "admin" };
    expect(await canSeeUser(ctx, reportId)).toBe(true);
    expect(await canSeeUser(ctx, otherMemberId)).toBe(true);
    expect(await canSeeUser(ctx, managerId)).toBe(true);
  });

  it("owner sieht alle Mitglieder der Organisation", async () => {
    const ctx: OrgContext = { userId: ownerId, orgId, role: "owner" };
    expect(await canSeeUser(ctx, reportId)).toBe(true);
    expect(await canSeeUser(ctx, otherMemberId)).toBe(true);
  });
});
