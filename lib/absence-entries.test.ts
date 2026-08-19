// Tests für lib/absence-entries.ts — die gemeinsame Kernlogik, mit der sowohl
// bulk-vacation als auch die Genehmigung eines AbsenceRequest ihre TimeEntries
// erzeugt (MIGRATION.md Punkt 9).
//
// Schwerpunkt (HARDENING.md A2): createAbsenceEntries löst das gültige Pensum
// in einer EIGENEN Schleife auf (getDailyRateForDate), nicht über pensumAt aus
// lib/calc.ts. Zwei Implementierungen derselben Regel driften erfahrungsgemäss
// auseinander — diese Tests binden sie aneinander, indem die erzeugten
// Stundenwerte gegen sollStundenTag geprüft werden.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createAbsenceEntries } from "@/lib/absence-entries";
import { sollStundenTag, type Profil } from "@/lib/calc";

const ORG = "test_absence_entries_org";

let userId: string;

// Dasselbe Profil, das die Routen aus der Membership bauen
// (lib/export-helpers.ts:18: basePensum ?? pensum ?? 100).
const profil: Profil = {
  wochenstunden: 40,
  pensum: 100,
  ferientage: 25,
  startDate: "2026-01-01",
  exitDate: null,
  maxWeeklyHours: 45,
};

// 100% (bis 30.04.) → 80% (ab 01.05.) → 60% (ab 01.06.)
const changes = [
  { effectiveFrom: "2026-05-01", pensum: 80, wochenstunden: 40 },
  { effectiveFrom: "2026-06-01", pensum: 60, wochenstunden: 40 },
];

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Absence Entries Test Org", slug: "absence-entries-test-org" } });
  const user = await prisma.user.create({
    data: { email: "absence-entries@example.test", password: "irrelevant", firstName: "Pensum", lastName: "Test" },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), weeklyHours: 40, pensum: 100 },
  });
  for (const c of changes) {
    await prisma.pensumChange.create({
      data: { orgId: ORG, userId, effectiveFrom: new Date(c.effectiveFrom), pensum: c.pensum, weeklyHours: c.wochenstunden },
    });
  }
});

afterAll(async () => {
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

describe("createAbsenceEntries mit mehrfachen Pensumsänderungen (HARDENING.md A2)", () => {
  it("erzeugt für jeden Tag die zum jeweiligen Zeitpunkt gültigen Stunden, nicht den letzten Satz", async () => {
    // 29.04.2026 (Mi) bis 02.06.2026 (Di) — spannt beide Wechsel.
    const result = await createAbsenceEntries({
      orgId: ORG,
      userId,
      changedBy: userId,
      fromDate: new Date("2026-04-29"),
      toDate: new Date("2026-06-02"),
      type: "ferien",
    });
    expect(result.created).toBeGreaterThan(0);

    const entries = await prisma.timeEntry.findMany({
      where: { orgId: ORG, userId, deletedAt: null },
      orderBy: { date: "asc" },
    });
    const byDate = new Map(entries.map((e) => [dateKey(new Date(e.date)), e.hours]));

    // Stichproben an den Wechselgrenzen
    expect(byDate.get("2026-04-30")).toBeCloseTo(8, 5);   // noch 100%
    expect(byDate.get("2026-05-01")).toBeCloseTo(6.4, 5); // ab hier 80%
    expect(byDate.get("2026-05-29")).toBeCloseTo(6.4, 5); // noch 80%
    expect(byDate.get("2026-06-01")).toBeCloseTo(4.8, 5); // ab hier 60%

    // Und der eigentliche Punkt: JEDER erzeugte Eintrag stimmt mit
    // sollStundenTag überein — die zweite Pensum-Auflösung in
    // getDailyRateForDate darf nicht von lib/calc.ts abweichen.
    for (const e of entries) {
      const key = dateKey(new Date(e.date));
      const erwartet = sollStundenTag(key, profil, changes, []);
      expect(e.hours, `Stunden am ${key}`).toBeCloseTo(erwartet, 2);
    }
  });

  it("legt keine Einträge an Wochenenden an", async () => {
    const entries = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null } });
    for (const e of entries) {
      const tag = new Date(e.date).getUTCDay();
      expect(tag, `Wochentag am ${dateKey(new Date(e.date))}`).not.toBe(0);
      expect(tag, `Wochentag am ${dateKey(new Date(e.date))}`).not.toBe(6);
    }
  });

  it("ist idempotent: ein zweiter Lauf über denselben Zeitraum erzeugt nichts Neues", async () => {
    const vorher = await prisma.timeEntry.count({ where: { orgId: ORG, userId, deletedAt: null } });
    const result = await createAbsenceEntries({
      orgId: ORG,
      userId,
      changedBy: userId,
      fromDate: new Date("2026-04-29"),
      toDate: new Date("2026-06-02"),
      type: "ferien",
    });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(vorher);
    const nachher = await prisma.timeEntry.count({ where: { orgId: ORG, userId, deletedAt: null } });
    expect(nachher).toBe(vorher);
  });

  it("skipDates überspringt genau die übergebenen Tage", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId } });
    const result = await createAbsenceEntries({
      orgId: ORG,
      userId,
      changedBy: userId,
      fromDate: new Date("2026-07-06"), // Mo
      toDate: new Date("2026-07-10"),   // Fr
      type: "ferien",
      skipDates: new Set(["2026-07-07", "2026-07-08"]),
    });
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(2);
    const keys = (await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null } }))
      .map((e) => dateKey(new Date(e.date)))
      .sort();
    expect(keys).toEqual(["2026-07-06", "2026-07-09", "2026-07-10"]);
  });
});

// HARDENING.md A2-Nachtrag (Projektaufteilung): ein Tag kann mehrere
// TimeEntry-Zeilen haben (z.B. Arbeitszeit auf zwei Projekte verteilt).
// createAbsenceEntries darf beim Überschreiben nicht nur eine der Zeilen
// umbauen und die andere als Karteileiche liegen lassen.
describe("createAbsenceEntries an einem Tag mit mehreren Zeilen (Projektaufteilung)", () => {
  it("ohne overwriteExisting: Tag mit mehreren Arbeitszeilen wird komplett übersprungen", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId } });
    const day = new Date("2026-07-13"); // Mo
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt A" } });
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt B" } });

    const result = await createAbsenceEntries({
      orgId: ORG, userId, changedBy: userId,
      fromDate: day, toDate: day, type: "ferien",
    });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.type === "arbeit")).toBe(true);
  });

  it("mit overwriteExisting: eine Zeile wird zur Absenz, die übrigen Zeilen desselben Tages werden weich gelöscht statt liegen zu bleiben", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId } });
    const day = new Date("2026-07-13"); // Mo
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt A" } });
    await prisma.timeEntry.create({ data: { orgId: ORG, userId, date: day, type: "arbeit", hours: 4, notiz: "Projekt B" } });

    const result = await createAbsenceEntries({
      orgId: ORG, userId, changedBy: userId,
      fromDate: day, toDate: day, type: "ferien",
      overwriteExisting: true,
    });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);

    const activeRows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId, deletedAt: null } });
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].type).toBe("ferien");

    const allRows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId } });
    expect(allRows).toHaveLength(2); // die zweite Zeile existiert noch, aber soft-deleted
    const deletedRow = allRows.find((r) => r.id !== activeRows[0].id)!;
    expect(deletedRow.deletedAt).not.toBeNull();
    expect(deletedRow.type).toBe("arbeit"); // Typ der gelöschten Zeile bleibt unverändert, nur deletedAt gesetzt

    const auditRows = await prisma.timeEntryAudit.findMany({ where: { orgId: ORG, entryId: deletedRow.id } });
    expect(auditRows.some((a) => a.field === "deletedAt")).toBe(true);
  });
});
