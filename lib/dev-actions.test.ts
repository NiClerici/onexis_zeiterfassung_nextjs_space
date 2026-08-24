// Tests für lib/dev-actions.ts — Fachlogik hinter den Admin-Aktionen der
// Developer-Übersicht (/dev), aufgerufen aus app/api/dev/**/route.ts.
// Läuft, wie lib/customer-months.test.ts, gegen die echte Dev-DB mit einer
// eigenen Test-Org.

import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { changeOrgPlan, extendOrgTrial, createDevPasswordResetLink, DevActionError } from "@/lib/dev-actions";

const ORG = "test_dev_actions_org";
const PERFORMER = "developer@example.test";
let userId: string;

beforeEach(async () => {
  await prisma.organization.upsert({
    where: { id: ORG },
    update: { plan: "trial", trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
    create: { id: ORG, name: "Dev Actions Test GmbH", slug: "dev-actions-test-gmbh", plan: "trial", trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
  });
});

afterAll(async () => {
  await prisma.devAction.deleteMany({ where: { targetId: { in: [ORG, userId].filter(Boolean) } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("changeOrgPlan", () => {
  it("wechselt den Plan und löscht trialEndsAt bei einem bezahlten Plan", async () => {
    const updated = await changeOrgPlan("dev-actions-test-gmbh", "pro", PERFORMER);
    expect(updated.plan).toBe("pro");
    expect(updated.trialEndsAt).toBeNull();

    const action = await prisma.devAction.findFirst({ where: { targetId: ORG, action: "plan.change" }, orderBy: { createdAt: "desc" } });
    expect(action).not.toBeNull();
    expect(action?.performedBy).toBe(PERFORMER);
    expect(action?.detail).toBe("trial -> pro");
  });

  it("lehnt einen ungültigen Plan mit 400 ab", async () => {
    await expect(changeOrgPlan("dev-actions-test-gmbh", "enterprise", PERFORMER)).rejects.toMatchObject({ status: 400 });
  });

  it("lehnt einen unbekannten Slug mit 404 ab", async () => {
    await expect(changeOrgPlan("gibt-es-nicht-" + Date.now(), "pro", PERFORMER)).rejects.toMatchObject({ status: 404 });
  });

  it("behält trialEndsAt, wenn wieder auf trial zurückgewechselt wird", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    const updated = await changeOrgPlan("dev-actions-test-gmbh", "trial", PERFORMER);
    expect(updated.trialEndsAt?.getTime()).toBe(org.trialEndsAt?.getTime());
  });
});

describe("extendOrgTrial", () => {
  it("verlängert ab dem bestehenden trialEndsAt, wenn dieses noch in der Zukunft liegt", async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    const updated = await extendOrgTrial("dev-actions-test-gmbh", 14, PERFORMER);
    const expected = before.trialEndsAt!.getTime() + 14 * 24 * 60 * 60 * 1000;
    expect(updated.trialEndsAt!.getTime()).toBe(expected);

    const action = await prisma.devAction.findFirst({ where: { targetId: ORG, action: "trial.extend" }, orderBy: { createdAt: "desc" } });
    expect(action?.detail).toContain("+14d");
  });

  it("verlängert ab jetzt, wenn der Trial bereits abgelaufen ist", async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { trialEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) } });
    const before = Date.now();
    const updated = await extendOrgTrial("dev-actions-test-gmbh", 14, PERFORMER);
    const after = Date.now();
    const expectedMin = before + 14 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 14 * 24 * 60 * 60 * 1000;
    expect(updated.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(updated.trialEndsAt!.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("lehnt eine nicht-positive Anzahl Tage mit 400 ab", async () => {
    await expect(extendOrgTrial("dev-actions-test-gmbh", 0, PERFORMER)).rejects.toMatchObject({ status: 400 });
    await expect(extendOrgTrial("dev-actions-test-gmbh", -5, PERFORMER)).rejects.toMatchObject({ status: 400 });
  });

  it("lehnt eine Organisation ab, die nicht im Trial ist", async () => {
    await prisma.organization.update({ where: { id: ORG }, data: { plan: "pro", trialEndsAt: null } });
    await expect(extendOrgTrial("dev-actions-test-gmbh", 14, PERFORMER)).rejects.toMatchObject({ status: 409 });
  });
});

describe("createDevPasswordResetLink", () => {
  it("erzeugt einen einmal gültigen Link und protokolliert die Aktion", async () => {
    const user = await prisma.user.create({
      data: { email: "dev-actions-user@example.test", password: "irrelevant", firstName: "Test", lastName: "User" },
    });
    userId = user.id;

    const url = await createDevPasswordResetLink(user.id, PERFORMER, "https://zeit-onexis.duckdns.org");
    expect(url).toMatch(/^https:\/\/zeit-onexis\.duckdns\.org\/reset-password\?token=[0-9a-f]{64}$/);

    const tokenRow = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.usedAt).toBeNull();
    expect(tokenRow!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const action = await prisma.devAction.findFirst({ where: { targetId: user.id, action: "password-reset-link" } });
    expect(action?.performedBy).toBe(PERFORMER);
    expect(action?.detail).toBe(user.email);
  });

  it("lehnt einen unbekannten Nutzer mit 404 ab", async () => {
    await expect(createDevPasswordResetLink("does-not-exist-" + Date.now(), PERFORMER, "https://x.test")).rejects.toMatchObject({ status: 404 });
  });
});

describe("DevActionError", () => {
  it("trägt status als eigene Eigenschaft (nicht nur in der message)", () => {
    const err = new DevActionError(409, "Konflikt");
    expect(err.status).toBe(409);
    expect(err.message).toBe("Konflikt");
  });
});
