// Tests für lib/billing.ts (MIGRATION.md Punkt 12). isTrialExpired() ist
// eine reine Funktion (direkt getestet, ohne DB — sie muss auch in der
// Edge-Runtime von middleware.ts ohne Prisma funktionieren). billing
// (ManualBillingProvider) ist Prisma-abhängig und wird gegen die echte
// Dev-DB getestet, gleiches Muster wie lib/access.test.ts.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { isTrialExpired, billing, PLAN_LIMITS } from "@/lib/billing";

describe("isTrialExpired (reine Funktion)", () => {
  it("liefert false für nicht-trial-Pläne, unabhängig von trialEndsAt", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24);
    expect(isTrialExpired("starter", past)).toBe(false);
    expect(isTrialExpired("pro", past)).toBe(false);
  });

  it("liefert false für trial ohne gesetztes trialEndsAt", () => {
    expect(isTrialExpired("trial", null)).toBe(false);
    expect(isTrialExpired("trial", undefined)).toBe(false);
  });

  it("liefert false für trial mit trialEndsAt in der Zukunft", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    expect(isTrialExpired("trial", future)).toBe(false);
  });

  it("liefert true für trial mit trialEndsAt in der Vergangenheit", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24);
    expect(isTrialExpired("trial", past)).toBe(true);
  });

  it("funktioniert auch mit trialEndsAt als ISO-String (JWT-Serialisierung)", () => {
    const pastIso = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const futureIso = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    expect(isTrialExpired("trial", pastIso)).toBe(true);
    expect(isTrialExpired("trial", futureIso)).toBe(false);
  });

  it("liefert false für null/undefined plan", () => {
    expect(isTrialExpired(null, new Date(Date.now() - 1000))).toBe(false);
    expect(isTrialExpired(undefined, new Date(Date.now() - 1000))).toBe(false);
  });
});

describe("ManualBillingProvider (gegen echte Dev-DB)", () => {
  const orgId = "test_billing_org";
  let userIds: string[] = [];

  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("isReadOnly() spiegelt isTrialExpired() für einen echten Org-Datensatz", async () => {
    await prisma.organization.create({
      data: { id: orgId, name: "Billing Test Org", slug: "billing-test-org", plan: "trial", trialEndsAt: new Date(Date.now() - 1000 * 60 * 60) },
    });
    const info = await billing.getOrgBillingInfo(orgId);
    expect(info.plan).toBe("trial");
    expect(billing.isReadOnly(info)).toBe(true);

    await prisma.organization.update({ where: { id: orgId }, data: { plan: "pro" } });
    const infoAfterUpgrade = await billing.getOrgBillingInfo(orgId);
    expect(billing.isReadOnly(infoAfterUpgrade)).toBe(false);
  });

  it("checkUserLimit() zählt nur aktive Mitgliedschaften und respektiert PLAN_LIMITS", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { plan: "trial" } });
    const mkUser = async (email: string) => {
      const u = await prisma.user.create({ data: { email, password: "irrelevant", firstName: "T", lastName: "U" } });
      userIds.push(u.id);
      return u.id;
    };
    const maxUsers = PLAN_LIMITS.trial.maxUsers!;
    // Genau maxUsers aktive Mitgliedschaften anlegen — Limit gerade erreicht.
    for (let i = 0; i < maxUsers; i++) {
      const uid = await mkUser(`billing-test-${i}@example.test`);
      await prisma.membership.create({ data: { orgId, userId: uid, role: "member", entryDate: new Date(), status: "aktiv" } });
    }
    // Eine zusätzliche INAKTIVE Mitgliedschaft — darf das Limit nicht mitzählen.
    const inactiveUid = await mkUser("billing-test-inactive@example.test");
    await prisma.membership.create({ data: { orgId, userId: inactiveUid, role: "member", entryDate: new Date(), status: "inaktiv" } });

    const check = await billing.checkUserLimit(orgId);
    expect(check.currentCount).toBe(maxUsers);
    expect(check.maxUsers).toBe(maxUsers);
    expect(check.withinLimit).toBe(false); // currentCount (maxUsers) ist nicht < maxUsers
  });
});
