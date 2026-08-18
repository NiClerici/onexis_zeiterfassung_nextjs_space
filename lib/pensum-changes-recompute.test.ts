// Test für den Ferien/Pensum-Bugfix: POST/DELETE /api/pensum-changes
// (app/api/pensum-changes/route.ts) rufen jetzt recomputeAbsenceHours
// (lib/absence-entries.ts) auf, damit bestehende Absenz-Einträge nicht auf
// Dauer die zum Anlegezeitpunkt gültige (und danach veraltete) Stundenzahl
// tragen. Ruft die Route-Handler direkt auf, gleiches Muster wie
// lib/invitations-limit.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { feriensaldo } from "@/lib/calc";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as pensumChangesPost, DELETE as pensumChangesDelete } from "@/app/api/pensum-changes/route";

const ORG = "test_pensum_recompute_org";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

async function timeEntry(userId: string, date: string) {
  return prisma.timeEntry.findFirst({ where: { orgId: ORG, userId, date: new Date(`${date}T00:00:00Z`) } });
}

let ownerId: string;
let memberAId: string; // Haupt-Szenario: automatisch berechneter Ferientag
let memberBId: string; // Handeintrag, darf nicht angefasst werden
let memberCId: string; // POST und DELETE hintereinander (Rundreise)

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Pensum Recompute Test Org", slug: "pensum-recompute-test-org", plan: "pro" } });

  const owner = await prisma.user.create({ data: { email: "recompute-owner@example.test", password: "irrelevant", firstName: "O", lastName: "Wner" } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 100 } });

  const a = await prisma.user.create({ data: { email: "recompute-a@example.test", password: "irrelevant", firstName: "A", lastName: "A" } });
  memberAId = a.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberAId, role: "member", entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 60 } });
  // 05.10.2026 ist ein Montag. Tagessoll bei 40h/60% = 4.8h — der Wert, den
  // die App beim Anlegen des Ferientags automatisch eingesetzt hätte.
  await prisma.timeEntry.create({ data: { orgId: ORG, userId: memberAId, date: new Date("2026-10-05T00:00:00Z"), type: "ferien", hours: 4.8 } });

  const b = await prisma.user.create({ data: { email: "recompute-b@example.test", password: "irrelevant", firstName: "B", lastName: "B" } });
  memberBId = b.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberBId, role: "member", entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 60 } });
  // Bewusster Halbtag: 2.4h statt der automatischen 4.8h.
  await prisma.timeEntry.create({ data: { orgId: ORG, userId: memberBId, date: new Date("2026-10-05T00:00:00Z"), type: "ferien", hours: 2.4 } });

  const c = await prisma.user.create({ data: { email: "recompute-c@example.test", password: "irrelevant", firstName: "C", lastName: "C" } });
  memberCId = c.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberCId, role: "member", entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 100 } });
  // 02.03.2026 ist ein Montag. Tagessoll bei 40h/100% = 8h.
  await prisma.timeEntry.create({ data: { orgId: ORG, userId: memberCId, date: new Date("2026-03-02T00:00:00Z"), type: "ferien", hours: 8 } });
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberAId, memberBId, memberCId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/pensum-changes — Absenz-Einträge werden nachgezogen", () => {
  it("aktualisiert einen automatisch berechneten Ferientag auf das neue Tagessoll", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await pensumChangesPost(jsonReq("/api/pensum-changes", "POST", {
      userId: memberAId, pensum: 80, weeklyHours: 40, effectiveFrom: "2026-09-01",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recompute.updated).toBe(1);
    expect(body.recompute.skipped).toBe(0);

    const entry = await timeEntry(memberAId, "2026-10-05");
    // 40h * 80% / 5 = 6.4h
    expect(entry?.hours).toBe(6.4);

    const audit = await prisma.timeEntryAudit.findFirst({ where: { orgId: ORG, entryId: entry!.id, field: "hours" } });
    expect(audit).not.toBeNull();
    expect(audit?.oldValue).toBe("4.8");
    expect(audit?.newValue).toBe("6.4");

    // Bezug zum ursprünglich gemeldeten Bug: feriensaldo() muss jetzt
    // wieder genau 1.0 Tag zählen, nicht mehr 0.75.
    const saldo = feriensaldo({
      jahr: 2026,
      heute: "2026-12-31",
      profil: { wochenstunden: 40, pensum: 80, ferientage: 25, startDate: "2026-01-01", exitDate: null, maxWeeklyHours: 45 },
      changes: [{ effectiveFrom: "2026-09-01", pensum: 80, wochenstunden: 40 }],
      holidays: [],
      eintraege: [{ date: "2026-10-05", typ: "ferien", hours: entry!.hours! }],
    });
    expect(saldo.bezogen).toBe(1);
  });

  it("lässt einen von Hand abweichend gesetzten Ferientag unangetastet", async () => {
    setSession(ownerId, ORG, "owner");
    const res = await pensumChangesPost(jsonReq("/api/pensum-changes", "POST", {
      userId: memberBId, pensum: 80, weeklyHours: 40, effectiveFrom: "2026-09-01",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recompute.updated).toBe(0);
    expect(body.recompute.skipped).toBe(1);

    const entry = await timeEntry(memberBId, "2026-10-05");
    expect(entry?.hours).toBe(2.4); // unverändert

    const audit = await prisma.timeEntryAudit.findFirst({ where: { orgId: ORG, entryId: entry!.id } });
    expect(audit).toBeNull();
  });
});

describe("DELETE /api/pensum-changes — spiegelbildliches Nachziehen", () => {
  it("POST gefolgt von DELETE bringt den automatischen Ferientag zurück auf den Ausgangswert", async () => {
    setSession(ownerId, ORG, "owner");

    const postRes = await pensumChangesPost(jsonReq("/api/pensum-changes", "POST", {
      userId: memberCId, pensum: 60, weeklyHours: 40, effectiveFrom: "2026-01-01",
    }));
    expect(postRes.status).toBe(200);
    const { change } = await postRes.json();

    const afterPost = await timeEntry(memberCId, "2026-03-02");
    // 40h * 60% / 5 = 4.8h
    expect(afterPost?.hours).toBe(4.8);

    const delRes = await pensumChangesDelete(jsonReq("/api/pensum-changes", "DELETE", { id: change.id }));
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.recompute.updated).toBe(1);

    const afterDelete = await timeEntry(memberCId, "2026-03-02");
    expect(afterDelete?.hours).toBe(8); // zurück auf den Ausgangswert bei 100%
  });
});
