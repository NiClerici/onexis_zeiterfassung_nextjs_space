// Regressionstest für den Feiertags-Bug in bulk-apply (Analytics-Nachtrag,
// 25.08.2026): "Standardwoche anwenden" lud die Holiday-Tabelle bisher gar
// nicht und legte auf einem noch leeren Feiertag einen normalen
// arbeit-Eintrag über die volle Standardwoche-Stundenzahl an. sollStundenTag()
// (lib/calc.ts) liefert für denselben Tag aber 0 (bzw. bei halfDay das halbe
// Tagessoll) — die Prognose lief dadurch pro Feiertag um ein Tagessoll zu
// hoch. Ruft den Route-Handler direkt auf, gleiches Muster wie
// lib/bulk-apply-multi-entry.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { kennzahlen, stundenAusEintrag } from "@/lib/calc";
import { buildProfil, mapChanges, mapEintraege } from "@/lib/export-helpers";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as bulkApplyPost } from "@/app/api/time-entries/bulk-apply/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_bulk_apply_holiday_org";
let userId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Bulk Apply Holiday Test Org", slug: "bulk-apply-holiday-test-org" } });
  const user = await prisma.user.create({ data: { email: "bulk-apply-holiday@example.test", password: "irrelevant", firstName: "H", lastName: "Oliday" } });
  userId = user.id;
  // weeklyHours 40 / pensum 100 → Tagessoll 8h, deckungsgleich mit der
  // Standardwoche unten (Mon-Fri 8h) — sonst würde die Prognose-Invariante
  // unten schon durch eine reine Wochenstunden/Template-Differenz verfälscht.
  await prisma.membership.create({
    data: {
      orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), startDate: new Date("2026-01-01"),
      weeklyHours: 40, pensum: 100,
      stdHoursMon: 8, stdHoursTue: 8, stdHoursWed: 8, stdHoursThu: 8, stdHoursFri: 8,
    },
  });
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.holiday.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("bulk-apply berücksichtigt Feiertage", () => {
  it("legt auf einem ganzen Feiertag keinen Eintrag an", async () => {
    setSession(userId, ORG, "member");
    const day = "2026-08-05"; // Mi, voller Feiertag
    await prisma.holiday.create({ data: { orgId: ORG, date: new Date(`${day}T00:00:00.000Z`), name: "Test-Feiertag" } });

    const res = await bulkApplyPost(jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: day, toDate: day, overwriteExisting: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.skippedHoliday).toBe(1);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, date: new Date(`${day}T00:00:00.000Z`), deletedAt: null } });
    expect(rows).toHaveLength(0);
  });

  it("legt auf einem Halbtags-Feiertag einen Eintrag mit halben Stunden an", async () => {
    setSession(userId, ORG, "member");
    const day = "2026-08-06"; // Do, halber Feiertag
    await prisma.holiday.create({ data: { orgId: ORG, date: new Date(`${day}T00:00:00.000Z`), name: "Test-Halbtag", halfDay: true } });

    const res = await bulkApplyPost(jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: day, toDate: day, overwriteExisting: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skippedHoliday).toBe(0);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, date: new Date(`${day}T00:00:00.000Z`), deletedAt: null } });
    expect(rows).toHaveLength(1);
    const hours = stundenAusEintrag({ typ: "arbeit", von: rows[0].von ?? undefined, bis: rows[0].bis ?? undefined, pauseMin: rows[0].pauseMin, hours: rows[0].hours ?? undefined }, 0);
    expect(hours).toBe(4); // halbe Standardwoche-Stundenzahl (8h/2)
  });

  it("Invariante: Standardwoche über einen Monat mit Feiertag angewendet ergibt Prognose-Saldo 0 (Regressionsschutz)", async () => {
    setSession(userId, ORG, "member");
    const from = "2026-09-01";
    const to = "2026-09-30";
    await prisma.holiday.create({ data: { orgId: ORG, date: new Date("2026-09-09T00:00:00.000Z"), name: "Test-Septemberfeiertag" } }); // Mi

    const applyRes = await bulkApplyPost(jsonReq("/api/time-entries/bulk-apply", "POST", { fromDate: from, toDate: to, overwriteExisting: false }));
    expect(applyRes.status).toBe(200);

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ORG, userId } } });
    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId: ORG } });
    const entriesRaw = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null, date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } } });

    const result = kennzahlen({
      from: `${from}T00:00:00.000Z`,
      to: `${to}T00:00:00.000Z`,
      // heute NACH Periodenende: alle Einträge zählen als "ist", nicht als
      // geplante Zukunft — damit prognoseSaldo hier zu ueberstunden wird und
      // der Vergleich mit dem alten Verhalten (+1 Tagessoll ohne den Fix)
      // eindeutig ist.
      heute: "2026-10-15T00:00:00.000Z",
      eintraege: mapEintraege(entriesRaw),
      profil: buildProfil(membership),
      changes: mapChanges([]),
      holidays: holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay })),
      payouts: [],
      kundenstunden: 0,
    });

    expect(result.prognoseSaldo).toBe(0);
  });
});
