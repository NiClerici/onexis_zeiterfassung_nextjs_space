// Test für das Nutzerlimit beim Einladen (MIGRATION.md Punkt 12,
// lib/billing.ts) — app/api/invitations/route.ts POST. Ruft den
// Route-Handler direkt auf, gleiches Muster wie die übrigen Route-Tests.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/billing";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(() => Promise.resolve()) }));

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as invitationsPost } from "@/app/api/invitations/route";

const ORG = "test_invite_limit_org";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

let ownerId: string;
const memberIds: string[] = [];

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Invite Limit Test Org", slug: "invite-limit-test-org", plan: "trial" } });
  const owner = await prisma.user.create({ data: { email: "invite-limit-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date() } });

  // Trial-Limit (PLAN_LIMITS.trial.maxUsers) minus die bereits vorhandene
  // owner-Mitgliedschaft mit weiteren aktiven Mitgliedschaften auffüllen,
  // bis das Limit exakt erreicht ist.
  const maxUsers = PLAN_LIMITS.trial.maxUsers!;
  for (let i = 0; i < maxUsers - 1; i++) {
    const u = await prisma.user.create({ data: { email: `invite-limit-member-${i}@example.test`, password: "irrelevant", firstName: "M", lastName: `${i}` } });
    memberIds.push(u.id);
    await prisma.membership.create({ data: { orgId: ORG, userId: u.id, role: "member", entryDate: new Date() } });
  }
});

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, ...memberIds] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/invitations — Nutzerlimit (MIGRATION.md Punkt 12)", () => {
  it("lehnt eine Einladung ab, sobald das Plan-Limit erreicht ist", async () => {
    setSession(ownerId, ORG, "owner");
    // Org hat jetzt genau PLAN_LIMITS.trial.maxUsers aktive Mitgliedschaften.
    const res = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "ueberzaehlig@example.test", role: "member" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Nutzerlimit/);
  });

  it("erlaubt eine Einladung, sobald wieder Platz ist (ein Mitglied deaktiviert)", async () => {
    setSession(ownerId, ORG, "owner");
    await prisma.membership.updateMany({ where: { orgId: ORG, userId: memberIds[0] }, data: { status: "inaktiv" } });

    const res = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "genug-platz@example.test", role: "member" }));
    expect(res.status).toBe(200);

    // Aufräumen: wieder aktivieren, damit spätere Testläufe denselben
    // Ausgangszustand vorfinden.
    await prisma.membership.updateMany({ where: { orgId: ORG, userId: memberIds[0] }, data: { status: "aktiv" } });
  });
});
