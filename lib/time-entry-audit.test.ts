// Tests für Audit-Trail und Soft-Delete auf TimeEntry (MIGRATION.md Punkt
// 6b). Ruft die Route-Handler direkt auf (kein laufender Server nötig),
// gleiches Muster wie lib/api-isolation.test.ts — echte Dev-DB, kein Mock von
// Prisma, nur getServerSession wird gemockt.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as teGet, POST as tePost, PUT as tePut, DELETE as teDelete } from "@/app/api/time-entries/route";

const ORG = "test_audit_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}
function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

let userId: string;
let entryId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Audit Test Org", slug: "audit-test-org" } });
  const u = await prisma.user.create({ data: { email: "audit-test@example.test", password: "irrelevant", firstName: "A", lastName: "T" } });
  userId = u.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "owner", entryDate: new Date() } });
  setSession(userId, ORG, "owner");
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("TimeEntry Audit-Trail (PUT)", () => {
  it("legt bei einer echten Änderung Audit-Zeilen für genau die geänderten Felder an", async () => {
    const created = await prisma.timeEntry.create({
      data: { userId, orgId: ORG, date: new Date("2026-09-01"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 },
    });
    entryId = created.id;

    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryId, bis: "18:00" }));
    expect(res.status).toBe(200);

    const audits = await prisma.timeEntryAudit.findMany({ where: { entryId } });
    expect(audits).toHaveLength(1);
    expect(audits[0].field).toBe("bis");
    expect(audits[0].oldValue).toBe("17:00");
    expect(audits[0].newValue).toBe("18:00");
    expect(audits[0].changedBy).toBe(userId);
    expect(audits[0].orgId).toBe(ORG);
  });

  it("legt KEINE Audit-Zeile an, wenn sich effektiv nichts ändert", async () => {
    const before = await prisma.timeEntryAudit.count({ where: { entryId } });
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryId, bis: "18:00" })); // gleicher Wert wie zuvor
    expect(res.status).toBe(200);
    const after = await prisma.timeEntryAudit.count({ where: { entryId } });
    expect(after).toBe(before);
  });

  it("protokolliert mehrere gleichzeitig geänderte Felder als mehrere Zeilen", async () => {
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryId, von: "09:00", notiz: "Verspätung" }));
    expect(res.status).toBe(200);
    const audits = await prisma.timeEntryAudit.findMany({ where: { entryId, field: { in: ["von", "notiz"] } } });
    expect(audits).toHaveLength(2);
  });
});

describe("TimeEntry Soft-Delete (DELETE)", () => {
  it("setzt deletedAt statt den Datensatz zu löschen, und protokolliert es", async () => {
    const res = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: entryId }));
    expect(res.status).toBe(200);

    const row = await prisma.timeEntry.findUnique({ where: { id: entryId } });
    expect(row).not.toBeNull(); // weiterhin in der DB — kein Hard-Delete
    expect(row?.deletedAt).not.toBeNull();

    const deleteAudit = await prisma.timeEntryAudit.findFirst({ where: { entryId, field: "deletedAt" } });
    expect(deleteAudit).not.toBeNull();
    expect(deleteAudit?.oldValue).toBeNull();
    expect(deleteAudit?.newValue).not.toBeNull();
  });

  it("ein soft-gelöschter Eintrag erscheint nicht mehr in GET", async () => {
    const res = await teGet(req("/api/time-entries?year=2026&month=9"));
    const body = await res.json();
    const ids = body.entries.map((e: any) => e.id);
    expect(ids).not.toContain(entryId);
  });

  it("ein bereits soft-gelöschter Eintrag liefert bei erneutem DELETE 404 (kein Doppel-Audit)", async () => {
    const before = await prisma.timeEntryAudit.count({ where: { entryId, field: "deletedAt" } });
    const res = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: entryId }));
    expect(res.status).toBe(404);
    const after = await prisma.timeEntryAudit.count({ where: { entryId, field: "deletedAt" } });
    expect(after).toBe(before);
  });

  it("ein soft-gelöschter Eintrag liefert bei PUT ebenfalls 404, nicht 200", async () => {
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: entryId, hours: 5 }));
    expect(res.status).toBe(404);
  });
});

// HARDENING.md B2 — Fehlerpfade von /api/time-entries. Der Coverage-Bericht
// aus B1 zeigte 83.83% Statements bei 54.46% Branches: die Validierungs- und
// Not-Found-Zweige liefen nie. Fremde Org-IDs deckt lib/api-isolation.test.ts
// bereits ab, hier geht es um ungültige Eingaben und unbekannte IDs.
describe("/api/time-entries — Fehlerpfade (HARDENING.md B2)", () => {
  it("POST ohne Datum liefert 400", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { type: "arbeit", von: "08:00", bis: "17:00" }));
    expect(res.status).toBe(400);
  });

  it("POST mit unparsbarem Datum liefert 400", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "kein-datum", type: "arbeit" }));
    expect(res.status).toBe(400);
  });

  it("POST mit unbekanntem Typ liefert 400", async () => {
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-09-01", type: "urlaub" }));
    expect(res.status).toBe(400);
  });

  it("POST mit leerem Body liefert 400 statt eines Absturzes", async () => {
    const res = await tePost(new Request("http://localhost/api/time-entries", { method: "POST" }));
    expect(res.status).toBe(400);
  });

  it("PUT auf eine unbekannte ID liefert 404", async () => {
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { id: "gibtesnicht", hours: 3 }));
    expect(res.status).toBe(404);
  });

  it("DELETE auf eine unbekannte ID liefert 404", async () => {
    const res = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: "gibtesnicht" }));
    expect(res.status).toBe(404);
  });

  it("PUT ohne ID liefert 400 oder 404, aber nie 200", async () => {
    const res = await tePut(jsonReq("/api/time-entries", "PUT", { hours: 3 }));
    expect([400, 404]).toContain(res.status);
  });
});
