// Tests für lib/customer-months.ts — die Umstellung von monatlicher
// CustomerMonth-Erfassung auf tägliche TimeEntry-Projektzuordnung
// (Nachtrag "Projektstunden pro Tag"). Kernregel: pro (userId, Jahr, Monat)
// gilt die NEUE, aus TimeEntry berechnete Summe; nur wenn die für einen
// Monat 0 ergibt UND für ihn noch CustomerMonth-Zeilen existieren, gilt der
// Altwert für GENAU DIESEN Monat.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { sumCustomerHours, sumCustomerHoursByUser, billableHoursByUserAndMonth } from "@/lib/customer-months";

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

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Testkunde", billable: true } });
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
  it("zählt TimeEntry-Stunden mit Projekt eines verrechenbaren Kunden", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-07-01"), type: "arbeit", hours: 5, customerId, projectId, billable: true },
    });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-07-08"), type: "arbeit", hours: 3, customerId, projectId, billable: true },
    });

    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-07-01"), to: new Date("2026-07-31") });
    expect(total).toBe(8);
  });

  it("nicht-verrechenbare Einträge (billable=false) zählen nicht, auch wenn der Kunde selbst verrechenbar ist", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: userAId, date: { gte: new Date("2026-08-01"), lte: new Date("2026-08-31") } } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-08-03"), type: "arbeit", hours: 4, customerId, projectId, billable: false },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-08-01"), to: new Date("2026-08-31") });
    expect(total).toBe(0);
  });

  it("Fallback: ein Monat ohne TimeEntry-Summe, aber mit CustomerMonth-Zeilen, liefert den Altwert", async () => {
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 3, customerId, hours: 12.5 } });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-03-01"), to: new Date("2026-03-31") });
    expect(total).toBe(12.5);
  });

  it("Kein Fallback, sobald der Monat eine eigene TimeEntry-Summe > 0 hat — auch wenn zusätzlich CustomerMonth-Zeilen existieren", async () => {
    await prisma.customerMonth.create({ data: { orgId: ORG, userId: userAId, year: 2026, month: 9, customerId, hours: 999 } });
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userAId, date: new Date("2026-09-02"), type: "arbeit", hours: 2, customerId, projectId, billable: true },
    });
    const total = await sumCustomerHours({ orgId: ORG, userId: userAId, from: new Date("2026-09-01"), to: new Date("2026-09-30") });
    expect(total).toBe(2); // NICHT 999 — die neue Zahl gewinnt, sobald sie > 0 ist
  });

  it("Fallback und neue Zahl werden pro Monat einzeln entschieden, nicht über den ganzen Zeitraum", async () => {
    // Monat 3 (März) hat nur den CustomerMonth-Altwert (12.5, aus obigem Test).
    // Monat 9 hat nur die neue TimeEntry-Summe (2, aus obigem Test).
    const perMonth = await billableHoursByUserAndMonth({ orgId: ORG, userIds: [userAId], from: new Date("2026-03-01"), to: new Date("2026-09-30") });
    const map = perMonth.get(userAId)!;
    expect(map.get("2026-3")).toBe(12.5);
    expect(map.get("2026-9")).toBe(2);
  });

  it("sumCustomerHoursByUser: mehrere Personen in einem Aufruf, unabhängig voneinander", async () => {
    await prisma.timeEntry.create({
      data: { orgId: ORG, userId: userBId, date: new Date("2026-07-05"), type: "arbeit", hours: 6, customerId, projectId, billable: true },
    });
    const result = await sumCustomerHoursByUser({ orgId: ORG, userIds: [userAId, userBId], from: new Date("2026-07-01"), to: new Date("2026-07-31") });
    expect(result.get(userAId)).toBe(8); // aus dem ersten Test oben
    expect(result.get(userBId)).toBe(6);
  });
});
