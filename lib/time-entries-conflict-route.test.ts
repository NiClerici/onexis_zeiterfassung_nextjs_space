// Tests für die in app/api/time-entries/route.ts nachgerüsteten Prüfungen:
// Duplikat-/Absenz-/Überlappungs-Konflikte (lib/entry-overlap.ts) und
// Zeit-Validierung (Pflicht-Von/Bis für "arbeit", Format, Pause > Zeitspanne).
// Ruft die Route-Handler direkt auf, gleiches Muster wie
// lib/time-entry-audit.test.ts und lib/month-locks.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as tePost, PUT as tePut } from "@/app/api/time-entries/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_conflict_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Conflict Test Org", slug: "conflict-test-org" } });
  const user = await prisma.user.create({ data: { email: "conflict@example.test", password: "irrelevant", firstName: "C", lastName: "Onflict" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01") } });
  setSession(userId, ORG, "member");
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/time-entries — Zeit-Validierung", () => {
  it("'arbeit' ohne von/bis und ohne hours wird abgelehnt (vorher: stiller 0h-Eintrag)", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-01", type: "arbeit" }));
    expect(res.status).toBe(400);
  });

  it("ein kaputtes Zeitformat wie '25:00' wird abgelehnt (vorher: NaN vergiftete die Monatssumme)", async () => {
    const res = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-02", type: "arbeit", von: "08:00", bis: "25:00" })
    );
    expect(res.status).toBe(400);
  });

  it("Pause länger als die Zeitspanne wird abgelehnt (08:00-12:00, Pause 300 => -1h)", async () => {
    const res = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-03", type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 300 })
    );
    expect(res.status).toBe(400);
  });

  it("eine reine hours-Zeile ohne von/bis bleibt erlaubt (Stundenrapport-Import-Format)", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-04", type: "arbeit", hours: 6 }));
    expect(res.status).toBe(200);
  });
});

// Audit-Fund HOCH (REVIEW_LOOP.md): Number(hours) auf einem nicht-numerischen
// Wert ergibt NaN, und Math.max(0, Math.min(24, NaN)) bleibt NaN — das
// vergiftete bisher Monatssummen und Exporte, ohne dass die Route es bemerkte.
// Gilt für JEDEN Eintragstyp, nicht nur "arbeit", da für andere Typen zuvor
// gar keine Prüfung von hours stattfand.
describe("POST/PUT /api/time-entries — ungültige Stundenzahl (NaN) wird abgelehnt", () => {
  it("POST 'arbeit' mit hours: 'acht' wird mit 400 abgelehnt statt NaN zu speichern", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-05", type: "arbeit", hours: "acht" }));
    expect(res.status).toBe(400);
  });

  it("POST 'ferien' mit hours: 'acht' wird ebenfalls mit 400 abgelehnt (vorher: keine Prüfung für Nicht-arbeit-Typen)", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-06", type: "ferien", hours: "acht" }));
    expect(res.status).toBe(400);
  });

  it("POST mit hours: 8 (eine gültige Zahl) bleibt erlaubt", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-07", type: "ferien", hours: 8 }));
    expect(res.status).toBe(200);
  });

  it("PUT mit hours: 'acht' auf eine bestehende Zeile wird mit 400 abgelehnt", async () => {
    const created = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-08", type: "ferien", hours: 8 }));
    const { entry } = await created.json();

    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entry.id, hours: "acht" }));
    expect(res.status).toBe(400);

    // die ursprüngliche Zeile darf durch den abgelehnten PUT nicht verändert
    // worden sein
    const stillThere = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(stillThere?.hours).toBe(8);
  });
});

describe("POST /api/time-entries — Duplikate & Absenz-Konflikte (409)", () => {
  it("ein exakt identischer zweiter Eintrag (gleiche Zeit) wird mit 409 abgelehnt", async () => {
    const first = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-10", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 })
    );
    expect(first.status).toBe(200);

    const second = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-10", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 })
    );
    expect(second.status).toBe(409);
  });

  it("ein zweiter 'ferien'-Eintrag am selben Tag wird mit 409 abgelehnt (sonst zählt feriensaldo() zwei Tage)", async () => {
    const first = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-11", type: "ferien", hours: 8 }));
    expect(first.status).toBe(200);

    const second = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-06-11", type: "ferien", hours: 8 }));
    expect(second.status).toBe(409);
  });

  it("eine teilweise überlappende Arbeitszeit wird gespeichert (200), aber mit warnings statt eines Blockers", async () => {
    const first = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-12", type: "arbeit", von: "08:00", bis: "12:00" })
    );
    expect(first.status).toBe(200);

    const second = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-12", type: "arbeit", von: "11:00", bis: "15:00" })
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.warnings?.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/time-entries — prüft nicht gegen sich selbst, aber gegen andere Zeilen", () => {
  it("eine Zeile unverändert speichern (PUT ohne Zeitänderung) löst KEIN Duplikat gegen sich selbst aus", async () => {
    const created = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-20", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 })
    );
    const { entry } = await created.json();

    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entry.id, notiz: "unveränderte Zeit" }));
    expect(res.status).toBe(200);
  });

  it("eine Zeile per PUT auf die Zeit einer anderen Zeile desselben Tages legen wird mit 409 abgelehnt", async () => {
    const a = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-21", type: "arbeit", von: "08:00", bis: "12:00" })
    );
    const { entry: entryA } = await a.json();
    const b = await tePost(
      jsonReq("/api/time-entries", "POST", { date: "2026-06-21", type: "arbeit", von: "13:00", bis: "17:00" })
    );
    const { entry: entryB } = await b.json();

    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryB.id, von: entryA.von, bis: entryA.bis }));
    expect(res.status).toBe(409);
  });
});
