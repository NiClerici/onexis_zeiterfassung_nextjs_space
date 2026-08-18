// Test für Betrieb.md Punkt 3: der Einladungslink wird direkt von der
// POST-Route zurückgegeben (statt ausschliesslich per Mail verschickt zu
// werden), und "erneut einladen" entwertet den vorherigen Link. Ruft die
// Route-Handler direkt auf, gleiches Muster wie lib/invitations-limit.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/token";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(() => Promise.resolve()) }));

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as invitationsPost } from "@/app/api/invitations/route";
import { GET as acceptGet, POST as acceptPost } from "@/app/api/invitations/accept/route";

const ORG = "test_invite_link_org";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

function tokenFromInviteUrl(url: string): string {
  return new URL(url).searchParams.get("token") ?? "";
}

let ownerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Invite Link Test Org", slug: "invite-link-test-org", plan: "pro" } });
  const owner = await prisma.user.create({ data: { email: "invite-link-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date() } });
});

afterAll(async () => {
  await prisma.invitation.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { email: { in: ["invite-link-owner@example.test", "invite-link-member@example.test"] } } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/invitations — Link im Response (Betrieb.md Punkt 3)", () => {
  it("gibt inviteUrl mit gültigem Token zurück, der zum gespeicherten Hash passt", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "invite-link-member@example.test", role: "member" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inviteUrl).toMatch(/\/invite\?token=[a-f0-9]{64}$/);

    const token = tokenFromInviteUrl(body.inviteUrl);
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(invitation).not.toBeNull();
    expect(invitation?.email).toBe("invite-link-member@example.test");
    expect(invitation?.usedAt).toBeNull();
  });

  it("entwertet beim erneuten Einladen derselben Adresse den vorherigen Link", async () => {
    setSession(ownerId, ORG, "owner");

    const first = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "invite-link-regenerate@example.test", role: "member" }));
    const firstBody = await first.json();
    const firstToken = tokenFromInviteUrl(firstBody.inviteUrl);

    const second = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "invite-link-regenerate@example.test", role: "member" }));
    const secondBody = await second.json();
    const secondToken = tokenFromInviteUrl(secondBody.inviteUrl);

    expect(secondToken).not.toBe(firstToken);

    // Alter Link: von der Vorschau-Route (GET) als ungültig erkannt.
    const previewOld = await acceptGet(new Request(`http://localhost/api/invitations/accept?token=${firstToken}`));
    expect(previewOld.status).toBe(400);

    // Neuer Link: funktioniert.
    const previewNew = await acceptGet(new Request(`http://localhost/api/invitations/accept?token=${secondToken}`));
    expect(previewNew.status).toBe(200);

    await prisma.invitation.deleteMany({ where: { orgId: ORG, email: "invite-link-regenerate@example.test" } });
  });

  it("ein angenommener Link kann kein zweites Mal verwendet werden", async () => {
    setSession(ownerId, ORG, "owner");
    const created = await invitationsPost(jsonReq("/api/invitations", "POST", { email: "invite-link-oneshot@example.test", role: "member" }));
    const { inviteUrl } = await created.json();
    const token = tokenFromInviteUrl(inviteUrl);

    const firstAccept = await acceptPost(jsonReq("/api/invitations/accept", "POST", {
      token, firstName: "Ein", lastName: "Mal", password: "ein-sehr-langes-testpasswort-1",
    }));
    expect(firstAccept.status).toBe(200);

    const secondAccept = await acceptPost(jsonReq("/api/invitations/accept", "POST", {
      token, firstName: "Zwei", lastName: "Mal", password: "ein-sehr-langes-testpasswort-2",
    }));
    expect(secondAccept.status).toBe(400);

    await prisma.membership.deleteMany({ where: { orgId: ORG, user: { email: "invite-link-oneshot@example.test" } } });
    await prisma.user.deleteMany({ where: { email: "invite-link-oneshot@example.test" } });
  });
});
