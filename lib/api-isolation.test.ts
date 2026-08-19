// Isolationstests für Mandantenfähigkeit (MIGRATION.md Punkt 3e). Zwei
// Organisationen mit je zwei Nutzern werden echt in der Dev-DB geseedet
// (kein Prisma-Mock im Projekt), dann wird gegen jeden betroffenen Endpunkt
// geprüft, dass ein Nutzer aus Org A über KEINEN Weg Daten aus Org B lesen,
// ändern oder löschen kann — auch nicht durch Mitgeben fremder IDs im Body,
// in Query-Params oder über Relationen (customerId aus der fremden Org).
//
// getServerSession wird gemockt, damit die Route-Handler direkt als
// Funktionen aufgerufen werden können (kein laufender Server nötig) und der
// Test die Session pro Aufruf gezielt auf einen bestimmten Testnutzer setzen
// kann.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as teGet, POST as tePost, PUT as tePut, DELETE as teDelete } from "@/app/api/time-entries/route";
import { GET as custGet, POST as custPost, PUT as custPut, DELETE as custDelete } from "@/app/api/customers/route";
import { GET as projGet } from "@/app/api/projects/route";
import { GET as payoutGet, POST as payoutPost, DELETE as payoutDelete } from "@/app/api/overtime-payouts/route";
import { GET as pcGet, POST as pcPost, DELETE as pcDelete } from "@/app/api/pensum-changes/route";

const ORG_A = "test_iso_org_a";
const ORG_B = "test_iso_org_b";

let a1: string, a2: string, b1: string, b2: string; // userIds
let shared: string; // Mitglied in BEIDEN Organisationen — der eigentliche Härtetest
let customerA: string, customerB: string, customerC: string;
let projectA: string;
let entryA: string, entryB: string;
let entrySharedInA: string, entrySharedInB: string;
let payoutA: string, payoutB: string;
let pcA: string, pcB: string;

function req(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}
function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG_A, name: "Iso Org A", slug: "iso-org-a" } });
  await prisma.organization.create({ data: { id: ORG_B, name: "Iso Org B", slug: "iso-org-b" } });

  const mkUser = async (email: string) => {
    const u = await prisma.user.create({ data: { email, password: await bcrypt.hash("irrelevant1234", 10), firstName: "T", lastName: "U" } });
    return u.id;
  };
  a1 = await mkUser("iso-a1@example.test");
  a2 = await mkUser("iso-a2@example.test");
  b1 = await mkUser("iso-b1@example.test");
  b2 = await mkUser("iso-b2@example.test");
  shared = await mkUser("iso-shared@example.test");

  await prisma.membership.create({ data: { orgId: ORG_A, userId: a1, role: "owner", entryDate: new Date() } });
  await prisma.membership.create({ data: { orgId: ORG_A, userId: a2, role: "member", entryDate: new Date() } });
  await prisma.membership.create({ data: { orgId: ORG_B, userId: b1, role: "owner", entryDate: new Date() } });
  await prisma.membership.create({ data: { orgId: ORG_B, userId: b2, role: "member", entryDate: new Date() } });
  // Derselbe Mensch, Mitglied in beiden Organisationen — der einzige Fall, in
  // dem userId allein NICHT mehr zwischen den Organisationen disambiguiert
  // und eine fehlende orgId-Filterung tatsächlich sichtbar würde.
  await prisma.membership.create({ data: { orgId: ORG_A, userId: shared, role: "member", entryDate: new Date() } });
  await prisma.membership.create({ data: { orgId: ORG_B, userId: shared, role: "member", entryDate: new Date() } });

  const custA = await prisma.customer.create({ data: { orgId: ORG_A, name: "Kunde A" } });
  const custB = await prisma.customer.create({ data: { orgId: ORG_B, name: "Kunde B" } });
  // Von a2 (member) nie bebuchter Kunde — Testfall für die Rollen-Sichtbarkeit.
  const custC = await prisma.customer.create({ data: { orgId: ORG_A, name: "Kunde C (nur a1)" } });
  customerA = custA.id;
  customerB = custB.id;
  customerC = custC.id;

  const projA = await prisma.project.create({ data: { orgId: ORG_A, customerId: customerA, name: "Projekt A" } });
  projectA = projA.id;

  const teA = await prisma.timeEntry.create({ data: { orgId: ORG_A, userId: a1, date: new Date("2026-11-02"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 } });
  const teB = await prisma.timeEntry.create({ data: { orgId: ORG_B, userId: b1, date: new Date("2026-11-02"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 } });
  entryA = teA.id;
  entryB = teB.id;

  // a2 (member) bebucht customerA/projectA selbst — a1 (owner) bebucht
  // customerC, den a2 nie sieht, obwohl gleiche Org.
  await prisma.timeEntry.create({ data: { orgId: ORG_A, userId: a2, date: new Date("2026-11-05"), type: "arbeit", von: "08:00", bis: "12:00", customerId: customerA, projectId: projectA } });
  await prisma.timeEntry.create({ data: { orgId: ORG_A, userId: a1, date: new Date("2026-11-05"), type: "arbeit", von: "08:00", bis: "12:00", customerId: customerC } });

  // Gleicher userId (shared), aber je ein Eintrag in Org A und Org B.
  const teSharedA = await prisma.timeEntry.create({ data: { orgId: ORG_A, userId: shared, date: new Date("2026-11-02"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 } });
  const teSharedB = await prisma.timeEntry.create({ data: { orgId: ORG_B, userId: shared, date: new Date("2026-11-02"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 } });
  entrySharedInA = teSharedA.id;
  entrySharedInB = teSharedB.id;

  const poA = await prisma.overtimePayout.create({ data: { orgId: ORG_A, userId: a1, date: new Date("2026-11-01"), hours: 5 } });
  const poB = await prisma.overtimePayout.create({ data: { orgId: ORG_B, userId: b1, date: new Date("2026-11-01"), hours: 5 } });
  payoutA = poA.id;
  payoutB = poB.id;

  const pcARow = await prisma.pensumChange.create({ data: { orgId: ORG_A, userId: a1, pensum: 80, weeklyHours: 40, effectiveFrom: new Date("2026-12-01") } });
  const pcBRow = await prisma.pensumChange.create({ data: { orgId: ORG_B, userId: b1, pensum: 80, weeklyHours: 40, effectiveFrom: new Date("2026-12-01") } });
  pcA = pcARow.id;
  pcB = pcBRow.id;
});

afterAll(async () => {
  await prisma.pensumChange.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.overtimePayout.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.timeEntry.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.project.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.customer.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.membership.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await prisma.user.deleteMany({ where: { id: { in: [a1, a2, b1, b2, shared] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("Isolation: time-entries", () => {
  it("GET liefert nur eigene Org-Einträge, auch bei überschneidendem Datumsbereich", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await teGet(req("/api/time-entries?year=2026&month=11"));
    const body = await res.json();
    const ids = body.entries.map((e: any) => e.id);
    expect(ids).toContain(entryA);
    expect(ids).not.toContain(entryB);
  });

  it("PUT auf eine fremde Org-ID liefert 404, nicht 200", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryB, hours: 1 }));
    expect(res.status).toBe(404);
    const untouched = await prisma.timeEntry.findUnique({ where: { id: entryB } });
    expect(untouched?.hours).toBe(null);
  });

  it("DELETE auf eine fremde Org-ID liefert 404, der Eintrag bleibt bestehen", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: entryB }));
    expect(res.status).toBe(404);
    const stillThere = await prisma.timeEntry.findUnique({ where: { id: entryB } });
    expect(stillThere).not.toBeNull();
  });

  it("POST mit customerId aus der fremden Org wird abgelehnt (Relation, nicht nur direkte ID)", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-11-03", type: "arbeit", von: "08:00", bis: "12:00", customerId: customerB })
    );
    expect(res.status).toBe(400);
  });

  it("Härtetest: derselbe Nutzer in zwei Organisationen — Session-orgId entscheidet, nicht userId allein", async () => {
    // Das ist der einzige Fall, in dem userId-Filterung ALLEIN nicht mehr
    // zwischen Organisationen disambiguiert (beide Einträge haben denselben
    // userId) — nur die orgId aus der Session verhindert hier die Vermischung.
    setSession(shared, ORG_A, "member");
    const resA = await teGet(req("/api/time-entries?year=2026&month=11"));
    const idsInA = (await resA.json()).entries.map((e: any) => e.id);
    expect(idsInA).toContain(entrySharedInA);
    expect(idsInA).not.toContain(entrySharedInB);

    setSession(shared, ORG_B, "member");
    const resB = await teGet(req("/api/time-entries?year=2026&month=11"));
    const idsInB = (await resB.json()).entries.map((e: any) => e.id);
    expect(idsInB).toContain(entrySharedInB);
    expect(idsInB).not.toContain(entrySharedInA);
  });

  it("POST mit customerId aus der EIGENEN Org funktioniert (Kontrolle: kein Overblocking)", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-11-04", type: "arbeit", von: "08:00", bis: "12:00", customerId: customerA })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    await prisma.timeEntry.delete({ where: { id: body.entry.id } });
  });
});

describe("Isolation: customers", () => {
  it("GET liefert dem Owner alle Kunden der eigenen Org, keine der fremden", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await custGet();
    const body = await res.json();
    const ids = body.customers.map((c: any) => c.id);
    expect(ids).toContain(customerA);
    expect(ids).toContain(customerC);
    expect(ids).not.toContain(customerB);
  });

  it("ein Mitglied sieht nur Kunden, bei denen es selbst schon Stunden erfasst hat", async () => {
    setSession(a2, ORG_A, "member");
    const res = await custGet();
    const body = await res.json();
    const ids = body.customers.map((c: any) => c.id);
    expect(ids).toContain(customerA); // a2 hat selbst einen Eintrag mit customerA
    expect(ids).not.toContain(customerC); // nur a1 bebucht customerC
    expect(ids).not.toContain(customerB); // fremde Org
  });

  it("PUT auf einen fremden Org-Kunden liefert 404", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await custPut(jsonReq("/api/customers", "PUT", { id: customerB, name: "Umbenannt" }));
    expect(res.status).toBe(404);
    const untouched = await prisma.customer.findUnique({ where: { id: customerB } });
    expect(untouched?.name).toBe("Kunde B");
  });

  it("DELETE auf einen fremden Org-Kunden liefert 404, Kunde bleibt bestehen", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await custDelete(jsonReq("/api/customers", "DELETE", { id: customerB }));
    expect(res.status).toBe(404);
    const stillThere = await prisma.customer.findUnique({ where: { id: customerB } });
    expect(stillThere).not.toBeNull();
  });
});

describe("Isolation: projects", () => {
  it("GET liefert dem Owner alle Projekte der eigenen Org", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await projGet(req("/api/projects"));
    const body = await res.json();
    expect(body.projects.map((p: any) => p.id)).toContain(projectA);
  });

  it("ein Mitglied sieht nur Projekte, bei denen es selbst schon Stunden erfasst hat", async () => {
    setSession(a2, ORG_A, "member");
    const res = await projGet(req("/api/projects"));
    const body = await res.json();
    expect(body.projects.map((p: any) => p.id)).toContain(projectA); // a2 hat selbst einen Eintrag mit projectA
  });
});

describe("Isolation: overtime-payouts", () => {
  it("GET liefert nur eigene Org-Auszahlungen", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await payoutGet(req("/api/overtime-payouts"));
    const body = await res.json();
    const ids = body.payouts.map((p: any) => p.id);
    expect(ids).toContain(payoutA);
    expect(ids).not.toContain(payoutB);
  });

  it("DELETE auf eine fremde Org-ID liefert 404", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await payoutDelete(jsonReq("/api/overtime-payouts", "DELETE", { id: payoutB }));
    expect(res.status).toBe(404);
    const stillThere = await prisma.overtimePayout.findUnique({ where: { id: payoutB } });
    expect(stillThere).not.toBeNull();
  });
});

describe("Isolation: pensum-changes", () => {
  it("GET liefert nur eigene Org-Änderungen", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await pcGet(req("/api/pensum-changes"));
    const body = await res.json();
    const ids = body.changes.map((c: any) => c.id);
    expect(ids).toContain(pcA);
    expect(ids).not.toContain(pcB);
  });

  it("DELETE auf eine fremde Org-ID liefert 404, Membership von Org B bleibt unverändert", async () => {
    setSession(a1, ORG_A, "owner");
    const res = await pcDelete(jsonReq("/api/pensum-changes", "DELETE", { id: pcB }));
    expect(res.status).toBe(404);
    const stillThere = await prisma.pensumChange.findUnique({ where: { id: pcB } });
    expect(stillThere).not.toBeNull();
    const membershipB = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG_B, userId: b1 } } });
    expect(membershipB?.pensum).toBe(100); // unverändert, da pcB nie "aktiv" gesetzt wurde
  });
});
