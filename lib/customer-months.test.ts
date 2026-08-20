// Tests für lib/customer-months.ts — die Umstellung von monatlicher
// CustomerMonth-Erfassung auf tägliche TimeEntry-Projektzuordnung
// (Nachtrag "Projektstunden pro Tag"). Kernregel (Betrieb.md-Nachtrag
// 20.08.2026, geklärt mit Nico): pro (userId, Jahr, Monat) wird die
// TimeEntry-Summe ADDITIV mit dem CustomerMonth-Altwert kombiniert — bei
// einer unterjährigen Migration deckt CustomerMonth nur die Tage vor dem
// Umstieg ab, TimeEntry nur die Tage danach.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { sumCustomerHours, sumCustomerHoursByUser, billableHoursByUserAndMonth, combineCustomerHours } from "@/lib/customer-months";

const ORG = "test_customer_months_org";
let userAId: string;
let userBId: string;
let customerId: string;
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

  it("CustomerMonth und TimeEntry desselben Monats werden addiert, nicht ersetzt (unterjährige Migration)", async () => {
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 9, customerId, hours: 63 } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-09-18"), type: "arbeit", hours: 2, customerId, projectId },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    expect(total).toBe(65); // 63 (Migration, Tage vor dem Umstieg) + 2 (Tageseintrag danach)
  });

  it("Kombination läuft pro Monat einzeln, nicht über den ganzen Zeitraum", async () => {
    // Monat 3 (März) hat nur den CustomerMonth-Altwert (12.5, aus obigem Test).
    // Monat 9 hat beide Quellen (63 + 2 = 65, aus obigem Test).
    const perMonth = await billableHoursByUserAndMonth({ orgId: ORG, userIds: [userAId], from: new Date("2026-03-01"), to: new Date("2026-09-30") });
    const map = perMonth.get(userAId)!;
    expect(combineCustomerHours(map.get("2026-3")!)).toBe(12.5);
    expect(combineCustomerHours(map.get("2026-9")!)).toBe(65);
  });

  it("billableHoursByUserAndMonth liefert beide Rohquellen unkombiniert (für Anzeigen, die den Migrationsanteil separat zeigen wollen)", async () => {
    // Reuse der Fixtur aus dem vorigen Test: Monat 9 hat fromEntries=2 und fromCustomerMonth=63.
    const perMonth = await billableHoursByUserAndMonth({ orgId: ORG, userIds: [userAId], from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    const v = perMonth.get(userAId)!.get("2026-9")!;
    expect(v.fromEntries).toBe(2);
    expect(v.fromCustomerMonth).toBe(63);
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
