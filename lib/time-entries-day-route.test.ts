// Tests für PUT /api/time-entries/day — den Tages-Speichern-Endpunkt, der
// components/day-entry-dialog.tsx erlaubt, alle Zeilen eines Tages mit
// einem einzigen Button auf einmal zu speichern (statt einem
// Speichern-Button pro Zeile). Gleiches Muster wie
// lib/time-entries-conflict-route.test.ts: ruft den Route-Handler direkt
// auf, mit echter Test-DB.

import { describe, expect, it, beforeAll, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { PUT as dayPut } from "@/app/api/time-entries/day/route";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/time-entries/day", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const ORG = "test_day_save_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Day Save Test Org", slug: "day-save-test-org" } });
  const user = await prisma.user.create({ data: { email: "daysave@example.test", password: "irrelevant", firstName: "D", lastName: "Aysave" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01") } });
  setSession(userId, ORG, "member");
});

afterEach(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("PUT /api/time-entries/day", () => {
  it("legt mehrere neue Zeilen eines Tages in einem Aufruf an", async () => {
    const res = await dayPut(
      jsonReq({
        date: "2026-06-01",
        rows: [
          { type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
          { type: "arbeit", von: "10:00", bis: "13:00", pauseMin: 0 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toHaveLength(2);
    const stored = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, date: new Date("2026-06-01") } });
    expect(stored).toHaveLength(2);
  });

  it("aktualisiert eine bestehende Zeile per id und legt gleichzeitig eine neue an", async () => {
    const created = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-02"), type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
    });
    const res = await dayPut(
      jsonReq({
        date: "2026-06-02",
        rows: [
          { id: created.id, type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0 },
          { type: "arbeit", von: "11:00", bis: "14:00", pauseMin: 0 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const updated = await prisma.timeEntry.findUnique({ where: { id: created.id } });
    expect(updated?.bis).toBe("11:00");
    const all = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, date: new Date("2026-06-02"), deletedAt: null } });
    expect(all).toHaveLength(2);
  });

  it("soft-löscht eine bestehende Zeile, die im Payload fehlt (Aufbewahrungspflicht: kein Hard-Delete)", async () => {
    const created = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-03"), type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
    });
    const res = await dayPut(jsonReq({ date: "2026-06-03", rows: [] }));
    expect(res.status).toBe(200);
    const row = await prisma.timeEntry.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
    const audit = await prisma.timeEntryAudit.findMany({ where: { entryId: created.id, field: "deletedAt" } });
    expect(audit).toHaveLength(1);
  });

  it("schreibt einen Feld-Diff-Audit-Eintrag für eine geänderte Zeile", async () => {
    const created = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-04"), type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
    });
    await dayPut(jsonReq({ date: "2026-06-04", rows: [{ id: created.id, type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0 }] }));
    const audit = await prisma.timeEntryAudit.findMany({ where: { entryId: created.id, field: "bis" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].oldValue).toBe("10:00");
    expect(audit[0].newValue).toBe("11:00");
  });

  it("lehnt eine blockierende Überschneidung (exaktes Duplikat) im selben Payload ab, ohne etwas zu speichern", async () => {
    const res = await dayPut(
      jsonReq({
        date: "2026-06-05",
        rows: [
          { type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
          { type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
        ],
      })
    );
    expect(res.status).toBe(409);
    const stored = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, date: new Date("2026-06-05") } });
    expect(stored).toHaveLength(0);
  });

  // Der eigentliche Gewinn gegenüber sequenziellem Einzelspeichern: zwei
  // Zeilen, die im ALTEN Zustand kollidiert hätten (Zeile 1 endet dort, wo
  // Zeile 2 im alten Stand begann), aber im neuen Payload lückenlos
  // aneinander anschliessen, dürfen NICHT als Konflikt gemeldet werden.
  it("prüft Konflikte gegen den neuen Payload-Zustand, nicht gegen den alten DB-Stand", async () => {
    const a = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-06"), type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 },
    });
    const b = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-06"), type: "arbeit", von: "10:00", bis: "13:00", pauseMin: 0 },
    });
    // Zeile a wird auf 08:00–11:00 verlängert (wie es lib/day-shift.ts im
    // Dialog automatisch vorschlägt), Zeile b entsprechend auf 11:00–14:00
    // nachgerückt — beide zusammen im selben PUT.
    const res = await dayPut(
      jsonReq({
        date: "2026-06-06",
        rows: [
          { id: a.id, type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0 },
          { id: b.id, type: "arbeit", von: "11:00", bis: "14:00", pauseMin: 0 },
        ],
      })
    );
    expect(res.status).toBe(200);
  });

  it("lehnt Speichern in einem für 'member' abgeschlossenen Monat ab", async () => {
    await prisma.monthLock.create({ data: { orgId: ORG, userId, year: 2026, month: 5, lockedBy: userId } });
    try {
      const res = await dayPut(jsonReq({ date: "2026-05-15", rows: [{ type: "arbeit", von: "08:00", bis: "10:00", pauseMin: 0 }] }));
      expect(res.status).toBe(403);
    } finally {
      await prisma.monthLock.deleteMany({ where: { orgId: ORG, userId, year: 2026, month: 5 } });
    }
  });

  it("graduiert nur eine tatsächlich geänderte Import-Zeile, unangetastete Zeilen behalten countsAsWorktime=false", async () => {
    const migriert = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-07"), type: "arbeit", hours: 4, countsAsWorktime: false },
    });
    const neu = await prisma.timeEntry.create({
      data: { orgId: ORG, userId, date: new Date("2026-06-07"), type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0 },
    });
    // migriert bleibt unverändert im Payload, neu wird geändert.
    const res = await dayPut(
      jsonReq({
        date: "2026-06-07",
        rows: [
          { id: migriert.id, type: "arbeit", hours: 4 },
          { id: neu.id, type: "arbeit", von: "08:00", bis: "13:00", pauseMin: 0 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const migriertNachher = await prisma.timeEntry.findUnique({ where: { id: migriert.id } });
    expect(migriertNachher?.countsAsWorktime).toBe(false);
    const neuNachher = await prisma.timeEntry.findUnique({ where: { id: neu.id } });
    expect(neuNachher?.countsAsWorktime).toBe(true);
  });

  it("400 bei ungültigem Datum", async () => {
    const res = await dayPut(jsonReq({ date: "nicht-valide", rows: [] }));
    expect(res.status).toBe(400);
  });

  it("400 bei mehr als 50 Zeilen", async () => {
    const rows = Array.from({ length: 51 }, () => ({ type: "arbeit", von: "08:00", bis: "09:00", pauseMin: 0 }));
    const res = await dayPut(jsonReq({ date: "2026-06-08", rows }));
    expect(res.status).toBe(400);
  });
});
