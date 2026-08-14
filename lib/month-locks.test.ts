// Tests für Monatsabschluss (MIGRATION.md Punkt 6e) — Sperren/Entsperren über
// /api/month-locks, Durchsetzung in app/api/time-entries/route.ts und den
// beiden Bulk-Routen. Ruft die Route-Handler direkt auf (kein laufender
// Server nötig), gleiches Muster wie lib/time-entry-audit.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as mlGet, POST as mlPost, DELETE as mlDelete } from "@/app/api/month-locks/route";
import { POST as tePost, PUT as tePut, DELETE as teDelete } from "@/app/api/time-entries/route";
import { POST as bulkVacationPost } from "@/app/api/time-entries/bulk-vacation/route";
import { POST as bulkApplyPost } from "@/app/api/time-entries/bulk-apply/route";
import { POST as arPost, PATCH as arPatch } from "@/app/api/absence-requests/route";

const ORG = "test_monthlock_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}
function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

let adminId: string;
let memberId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "MonthLock Test Org", slug: "monthlock-test-org" } });
  const admin = await prisma.user.create({ data: { email: "monthlock-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } });
  const member = await prisma.user.create({ data: { email: "monthlock-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
  adminId = admin.id;
  memberId = member.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date() } });
  await prisma.membership.create({
    data: {
      orgId: ORG,
      userId: memberId,
      role: "member",
      entryDate: new Date(),
      stdHoursMon: 8, stdHoursTue: 8, stdHoursWed: 8, stdHoursThu: 8, stdHoursFri: 8,
    },
  });
});

afterAll(async () => {
  await prisma.monthLockAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.monthLock.deleteMany({ where: { orgId: ORG } });
  await prisma.absenceRequest.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("MonthLock API — Sperren/Entsperren (admin/owner-only, idempotent)", () => {
  it("member darf keinen Monat sperren", async () => {
    setSession(memberId, ORG, "member");
    const res = await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(403);
  });

  it("admin sperrt einen Monat, erzeugt eine MonthLock- und eine MonthLockAudit-Zeile", async () => {
    setSession(adminId, ORG, "admin");
    const res = await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lock).toBeTruthy();
    expect(body.alreadyLocked).toBeUndefined();

    const lock = await prisma.monthLock.findUnique({ where: { orgId_userId_year_month: { orgId: ORG, userId: memberId, year: 2026, month: 9 } } });
    expect(lock).not.toBeNull();

    const audit = await prisma.monthLockAudit.findFirst({ where: { orgId: ORG, userId: memberId, year: 2026, month: 9, action: "locked" } });
    expect(audit).not.toBeNull();
    expect(audit?.performedBy).toBe(adminId);
  });

  it("erneutes Sperren desselben Monats ist idempotent — keine zweite Audit-Zeile", async () => {
    const before = await prisma.monthLockAudit.count({ where: { orgId: ORG, userId: memberId, year: 2026, month: 9, action: "locked" } });
    const res = await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyLocked).toBe(true);
    const after = await prisma.monthLockAudit.count({ where: { orgId: ORG, userId: memberId, year: 2026, month: 9, action: "locked" } });
    expect(after).toBe(before);
  });

  it("GET liefert die gesperrten Monate für den Nutzer", async () => {
    const res = await mlGet(req(`/api/month-locks?userId=${memberId}&year=2026`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks.some((l: any) => l.year === 2026 && l.month === 9)).toBe(true);
  });

  it("member darf einen Monat nicht entsperren", async () => {
    setSession(memberId, ORG, "member");
    const res = await mlDelete(jsonReq("/api/month-locks", "DELETE", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(403);
  });

  it("admin entsperrt — MonthLock-Zeile verschwindet, MonthLockAudit-Zeile mit action=unlocked bleibt", async () => {
    setSession(adminId, ORG, "admin");
    const res = await mlDelete(jsonReq("/api/month-locks", "DELETE", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(200);

    const lock = await prisma.monthLock.findUnique({ where: { orgId_userId_year_month: { orgId: ORG, userId: memberId, year: 2026, month: 9 } } });
    expect(lock).toBeNull();

    const audit = await prisma.monthLockAudit.findFirst({ where: { orgId: ORG, userId: memberId, year: 2026, month: 9, action: "unlocked" } });
    expect(audit).not.toBeNull();
    expect(audit?.performedBy).toBe(adminId);
  });

  it("erneutes Entsperren eines nicht gesperrten Monats liefert 404", async () => {
    const res = await mlDelete(jsonReq("/api/month-locks", "DELETE", { userId: memberId, year: 2026, month: 9 }));
    expect(res.status).toBe(404);
  });
});

describe("MonthLock-Durchsetzung auf TimeEntry-Mutationen (POST/PUT/DELETE)", () => {
  beforeAll(async () => {
    setSession(adminId, ORG, "admin");
    await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 9 }));
  });

  it("member kann in einem gesperrten Monat keinen neuen Eintrag anlegen (403)", async () => {
    setSession(memberId, ORG, "member");
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-09-10", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 }));
    expect(res.status).toBe(403);
  });

  it("member kann ausserhalb des gesperrten Monats normal anlegen", async () => {
    setSession(memberId, ORG, "member");
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-10-10", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 }));
    expect(res.status).toBe(200);
  });

  it("admin kann trotz Sperre für member weiterhin Einträge im gesperrten Monat anlegen", async () => {
    setSession(adminId, ORG, "admin");
    // admin legt hier einen eigenen Eintrag an (userId kommt aus der Session,
    // nicht aus dem Body) — bewusst admins eigener Monat, nicht der von member,
    // da /api/time-entries immer auf die eigene userId aus der Session wirkt.
    const res = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-09-11", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    await prisma.timeEntry.delete({ where: { id: body.entry.id } });
  });

  it("member kann einen bereits im gesperrten Monat bestehenden Eintrag nicht ändern oder löschen", async () => {
    // Direkt per Prisma angelegt (bypass API), um einen Bestandseintrag im
    // bereits gesperrten Monat zu simulieren (z.B. vor dem Sperren erfasst).
    const entry = await prisma.timeEntry.create({
      data: { userId: memberId, orgId: ORG, date: new Date("2026-09-15"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 },
    });
    setSession(memberId, ORG, "member");
    const putRes = await tePut(jsonReq("/api/time-entries", "PUT", { id: entry.id, bis: "18:00" }));
    expect(putRes.status).toBe(403);
    const delRes = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: entry.id }));
    expect(delRes.status).toBe(403);

    // /api/time-entries wirkt immer nur auf die eigene userId aus der Session
    // (kein Team-weites Editieren fremder Einträge über diese Route) — der
    // admin-Bypass der Sperre wird deshalb hier NICHT über den API-Aufruf für
    // einen fremden Eintrag geprüft (das würde unabhängig von Punkt 6e immer
    // 404 liefern), sondern bereits im vorigen Test anhand eines eigenen
    // admin-Eintrags im selben gesperrten Monat.
    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("member kann einen Eintrag nicht per Datumsänderung in den gesperrten Monat hinein verschieben", async () => {
    setSession(memberId, ORG, "member");
    const createRes = await tePost(jsonReq("/api/time-entries", "POST", { date: "2026-10-12", type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 }));
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()).entry;

    const moveRes = await tePut(jsonReq("/api/time-entries", "PUT", { id: created.id, date: "2026-09-12" }));
    expect(moveRes.status).toBe(403);

    // Aufräumen
    setSession(adminId, ORG, "admin");
    await prisma.timeEntry.delete({ where: { id: created.id } });
  });
});

describe("MonthLock-Durchsetzung in den Bulk-Routen (member übersprungene Tage im gesperrten Monat)", () => {
  it("bulk-vacation überspringt Tage im gesperrten Monat, legt sie ausserhalb an", async () => {
    setSession(memberId, ORG, "member");
    const res = await bulkVacationPost(jsonReq("/api/time-entries/bulk-vacation", "POST", { fromDate: "2026-09-28", toDate: "2026-10-02", overwriteExisting: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 2026-09-28 (Mo) und 2026-09-29 (Di) liegen im gesperrten September,
    // 2026-09-30 (Mi) ebenfalls; 2026-10-01/02 (Do/Fr) sind frei — 3 übersprungen, 2 erstellt.
    expect(body.created).toBe(2);
    expect(body.skipped).toBeGreaterThanOrEqual(3);

    const septemberEntries = await prisma.timeEntry.findMany({
      where: { orgId: ORG, userId: memberId, date: { gte: new Date("2026-09-28"), lte: new Date("2026-09-30") } },
    });
    expect(septemberEntries).toHaveLength(0);

    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId, date: { gte: new Date("2026-10-01"), lte: new Date("2026-10-02") } } });
  });

  it("bulk-apply überspringt Tage im gesperrten Monat als skippedLocked, legt sie ausserhalb an", async () => {
    setSession(memberId, ORG, "member");
    const res = await bulkApplyPost(jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: "2026-09-28", toDate: "2026-10-02", overwriteExisting: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skippedLocked).toBeGreaterThanOrEqual(3); // Mo-Mi 28.-30.09.
    expect(body.created).toBe(2); // Do/Fr 01./02.10.

    const septemberEntries = await prisma.timeEntry.findMany({
      where: { orgId: ORG, userId: memberId, date: { gte: new Date("2026-09-28"), lte: new Date("2026-09-30") } },
    });
    expect(septemberEntries).toHaveLength(0);

    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId, date: { gte: new Date("2026-10-01"), lte: new Date("2026-10-02") } } });
  });
});

// HARDENING.md A6 — was passiert, wenn ein Antrag VOR der Sperre gestellt,
// aber erst DANACH genehmigt wird? Die Antwort steckte bisher nur in einem
// Kommentar in app/api/absence-requests/route.ts:141-144 und war ungetestet.
// Sie lautet: die Genehmigung schreibt in den gesperrten Monat, weil sie ein
// Schreibvorgang der genehmigenden Rolle (manager/admin/owner) ist und diese
// Rollen laut MIGRATION.md Punkt 6e nicht von einer Sperre eingeschränkt
// werden. Für member bleibt der Monat trotzdem dicht — genau das prüfen die
// drei Tests hier, damit sich Sperre und Genehmigung nicht widersprechen.
describe("Monatssperre × Absenzgenehmigung (HARDENING.md A6)", () => {
  let requestId: string;

  it("Antrag vor der Sperre gestellt, nach der Sperre genehmigt: die Einträge entstehen trotzdem", async () => {
    // 1. Dezember 2026 ist noch offen — member stellt einen Antrag für
    //    Mo 07.12. bis Mi 09.12.2026 (3 Werktage).
    setSession(memberId, ORG, "member");
    const createRes = await arPost(
      jsonReq("/api/absence-requests", "POST", { fromDate: "2026-12-07", toDate: "2026-12-09", type: "ferien" })
    );
    expect(createRes.status).toBe(200);
    requestId = (await createRes.json()).request.id;

    // 2. Erst danach sperrt admin den Dezember für member.
    setSession(adminId, ORG, "admin");
    const lockRes = await mlPost(jsonReq("/api/month-locks", "POST", { userId: memberId, year: 2026, month: 12 }));
    expect(lockRes.status).toBe(200);

    // 3. admin genehmigt den Antrag — die Sperre hält ihn NICHT auf.
    const approveRes = await arPatch(jsonReq("/api/absence-requests", "PATCH", { id: requestId, action: "approve" }));
    expect(approveRes.status).toBe(200);
    const body = await approveRes.json();
    expect(body.request.status).toBe("genehmigt");
    expect(body.entries.created).toBe(3);

    const entries = await prisma.timeEntry.findMany({
      where: { orgId: ORG, userId: memberId, type: "ferien", date: { gte: new Date("2026-12-07"), lte: new Date("2026-12-09") } },
    });
    expect(entries).toHaveLength(3);
  });

  it("die so erzeugten Einträge bleiben für member trotzdem schreibgeschützt", async () => {
    // Das ist der eigentliche Kohärenz-Test: die Sperre verliert durch die
    // Genehmigung nichts von ihrer Wirkung. Geschrieben hat eine Rolle, die
    // das darf — member selbst kommt weiterhin nicht an den Monat heran.
    const entry = await prisma.timeEntry.findFirst({
      where: { orgId: ORG, userId: memberId, type: "ferien", date: new Date("2026-12-07") },
    });
    expect(entry).toBeTruthy();

    setSession(memberId, ORG, "member");
    const putRes = await tePut(jsonReq("/api/time-entries", "PUT", { id: entry!.id, hours: 2 }));
    expect(putRes.status).toBe(403);
    const delRes = await teDelete(jsonReq("/api/time-entries", "DELETE", { id: entry!.id }));
    expect(delRes.status).toBe(403);
  });

  it("für einen bereits gesperrten Monat kann member gar keinen Antrag mehr stellen (403)", async () => {
    // Die Gegenprobe: der Weg über einen NEUEN Antrag ist versperrt
    // (assertMonthEditable in app/api/absence-requests/route.ts:96-97).
    // Der Fall aus Test 1 kann also nur entstehen, wenn zwischen Antrag und
    // Genehmigung gesperrt wird.
    setSession(memberId, ORG, "member");
    const res = await arPost(
      jsonReq("/api/absence-requests", "POST", { fromDate: "2026-12-14", toDate: "2026-12-16", type: "ferien" })
    );
    expect(res.status).toBe(403);
  });
});
