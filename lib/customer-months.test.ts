// Tests für lib/customer-months.ts. Kernregel (Betrieb.md-Nachtrag
// 20.08.2026): pro (userId, Jahr, Monat, Kunde) wird die laufende
// Tageserfassung (TimeEntry, countsAsWorktime=true) ADDITIV mit der
// Migrationsquelle desselben Kunden/Monats kombiniert. Als Migrationsquelle
// gilt CustomerMonth, falls vorhanden — sonst Legacy-TimeEntry-Zeilen aus dem
// entfernten Stundenrapport-Import (countsAsWorktime=false). CustomerMonth
// gewinnt bewusst über Legacy, weil ein Abgleich mit den Original-Rapporten
// zeigte, dass Legacy-Zeilen unvollständig sein können — niemals werden
// beide Migrationsquellen addiert, sonst zählt ein migrierter Monat doppelt.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { sumCustomerHours, sumCustomerHoursByUser, billableHoursByUserAndMonth, combineCustomerHours } from "@/lib/customer-months";

// Eigene Org-ID, bewusst verschieden von lib/customer-months-route.test.ts
// ("test_customer_months_org") — dieselbe ID in zwei Testdateien führte bei
// paralleler Ausführung zu Fremdeinwirkung (die afterAll der einen Datei
// löschte Zeilen, die die andere noch brauchte, sichtbar als sporadische
// FK-Verletzungen nur im vollen Suite-Lauf, nicht isoliert).
const ORG = "test_customer_months_calc_org";
let userAId: string;
let userBId: string;
let customerId: string;
let customerId2: string;
let projectId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "CustomerMonths Calc Test Org", slug: "customer-months-calc-test-org" } });
  const userA = await prisma.user.create({ data: { email: "cm-calc-a@example.test", password: "irrelevant", firstName: "A", lastName: "User" } });
  const userB = await prisma.user.create({ data: { email: "cm-calc-b@example.test", password: "irrelevant", firstName: "B", lastName: "User" } });
  userAId = userA.id;
  userBId = userB.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: userAId, role: "member", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: userBId, role: "member", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Testkunde" } });
  customerId = customer.id;
  const customer2 = await prisma.customer.create({ data: { orgId: ORG, name: "Zweitkunde" } });
  customerId2 = customer2.id;
  const project = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Testprojekt" } });
  projectId = project.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.customerMonth.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("billableHoursByUserAndMonth / sumCustomerHours", () => {
  it("zählt TimeEntry-Stunden mit Kunden-/Projektzuordnung", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-07-01"), type: "arbeit", hours: 5, customerId, projectId },
    });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-07-08"), type: "arbeit", hours: 3, customerId, projectId },
    });

    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-07-01"), to: new Date("2026-07-31") });
    expect(total).toBe(8);
  });

  it("Einträge ohne Kunden-/Projektzuordnung zählen nicht", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: userAId, date: { gte: new Date("2026-08-01"), lte: new Date("2026-08-31") } } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-08-03"), type: "arbeit", hours: 4 },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-08-01"), to: new Date("2026-08-31") });
    expect(total).toBe(0);
  });

  it("Nur CustomerMonth für einen Monat ohne TimeEntry-Summe liefert den Altwert", async () => {
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 3, customerId, hours: 12.5 } });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-03-01"), to: new Date("2026-03-31") });
    expect(total).toBe(12.5);
  });

  it("CustomerMonth und laufende Tageserfassung desselben Monats werden addiert (unterjährige Migration)", async () => {
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 9, customerId, hours: 63 } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-09-18"), type: "arbeit", hours: 2, customerId, projectId },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    expect(total).toBe(65); // 63 (Migration, Tage vor dem Umstieg) + 2 (Tageseintrag danach)
  });

  it("Legacy-Zeilen (countsAsWorktime=false) UND CustomerMonth desselben Kunden/Monats: CustomerMonth gewinnt, keine Addition (Doppelzählungs-Bug)", async () => {
    // Reproduziert den Produktivfall April/Juli: der Alt-Import hat für
    // denselben Monat/Kunden bereits Legacy-Zeilen hinterlassen, UND es gibt
    // einen manuell nacherfassten CustomerMonth-Wert. Die beiden Werte
    // unterscheiden sich bewusst (wie bei April: 96.75h Legacy vs. 102.8h
    // CustomerMonth, weil die Legacy-Zeilen unvollständig waren) — das
    // Ergebnis muss der CustomerMonth-Wert sein, nicht die Summe.
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-04-05"), type: "arbeit", hours: 40, customerId, countsAsWorktime: false },
    });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-04-12"), type: "arbeit", hours: 56.75, customerId, countsAsWorktime: false },
    });
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 4, customerId, hours: 102.8 } });

    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-04-01"), to: new Date("2026-04-30") });
    expect(total).toBe(102.8); // NICHT 96.75 + 102.8 = 199.55
  });

  it("Nur Legacy-Zeilen, kein CustomerMonth: Legacy zählt als Migration (Fallback für nie nacherfasste Monate)", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-06-10"), type: "arbeit", hours: 45, customerId, countsAsWorktime: false },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-06-01"), to: new Date("2026-06-30") });
    expect(total).toBe(45);
  });

  it("Legacy + CustomerMonth + echte Tageserfassung: CustomerMonth gewinnt über Legacy, echte Erfassung kommt additiv dazu", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-05-03"), type: "arbeit", hours: 60, customerId, countsAsWorktime: false },
    });
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 5, customerId, hours: 63 } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-05-20"), type: "arbeit", hours: 7.5, customerId, projectId },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-05-01"), to: new Date("2026-05-31") });
    expect(total).toBe(70.5); // 63 (CustomerMonth, nicht 60 Legacy) + 7.5 (Tageseintrag)
  });

  it("Zwei Kunden im selben Monat werden unabhängig aufgelöst", async () => {
    // Kunde 1: Legacy + CustomerMonth (CustomerMonth gewinnt). Kunde 2: nur
    // echte Tageserfassung. Keiner der beiden darf den anderen verdecken.
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-10-03"), type: "arbeit", hours: 30, customerId, countsAsWorktime: false },
    });
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 10, customerId, hours: 33 } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-10-15"), type: "arbeit", hours: 4, customerId: customerId2 },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-10-01"), to: new Date("2026-10-31") });
    expect(total).toBe(37); // 33 (Kunde 1, CustomerMonth) + 4 (Kunde 2, echte Erfassung)
  });

  it("Kombination läuft pro Monat einzeln, nicht über den ganzen Zeitraum", async () => {
    // Monat 3 (März) hat nur den CustomerMonth-Altwert (12.5, aus obigem Test).
    // Monat 9 hat beide Quellen additiv (63 + 2 = 65, aus obigem Test).
    const perMonth = await billableHoursByUserAndMonth({ orgId: ORG, userIds: [userAId], from: new Date("2026-03-01"), to: new Date("2026-09-30") });
    const map = perMonth.get(userAId)!;
    expect(combineCustomerHours(map.get("2026-3")!)).toBe(12.5);
    expect(combineCustomerHours(map.get("2026-9")!)).toBe(65);
  });

  it("billableHoursByUserAndMonth liefert fromEntries/fromMigration getrennt (für Anzeigen, die den Migrationsanteil separat zeigen wollen)", async () => {
    // Reuse der Fixtur aus dem "additiv"-Test oben: Monat 9 hat fromEntries=2
    // (echte Tageserfassung) und fromMigration=63 (CustomerMonth).
    const perMonth = await billableHoursByUserAndMonth({ orgId: ORG, userIds: [userAId], from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    const v = perMonth.get(userAId)!.get("2026-9")!;
    expect(v.fromEntries).toBe(2);
    expect(v.fromMigration).toBe(63);
  });

  it("sumCustomerHoursByUser: mehrere Personen in einem Aufruf, unabhängig voneinander", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userBId, date: new Date("2026-07-05"), type: "arbeit", hours: 6, customerId, projectId },
    });
    const result = await sumCustomerHoursByUser({ orgId: ORG, userIds: [userAId, userBId], from: new Date("2026-07-01"), to: new Date("2026-07-31") });
    expect(result.get(userAId)).toBe(8); // aus dem ersten Test oben
    expect(result.get(userBId)).toBe(6);
  });
});
