// Test für POST /api/import/timesheet (Betrieb.md Punkt 4) — echte
// Datenbank wie lib/invitations-limit.test.ts, ruft den Route-Handler
// direkt auf. Prüft: preview schreibt nichts, commit schreibt; vorhandene
// Einträge am selben Datum werden übersprungen statt überschrieben;
// gesperrte Monate werden für "member" abgelehnt, für "admin" nicht.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as importPost } from "@/app/api/import/timesheet/route";

const ORG = "test_import_timesheet_org";

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tageszeiten");
  ws.addRow(["Datum", "Wochentag", "Stunden", "Typ"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildXlsxWithCustomerMonths(cmRows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet("Tageszeiten");
  ws1.addRow(["Datum", "Wochentag", "Stunden", "Typ"]);
  const ws2 = wb.addWorksheet("Kundenstunden");
  ws2.addRow(["Jahr", "Monat", "Kunde", "Stunden"]);
  for (const r of cmRows) ws2.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function uploadReq(buffer: Buffer, mode: "preview" | "commit"): Request {
  const fd = new FormData();
  fd.set("file", new File([buffer], "import.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  fd.set("mode", mode);
  return new Request("http://localhost/api/import/timesheet", { method: "POST", body: fd });
}

let memberId: string;
let adminId: string;
let customerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Import Test Org", slug: "import-test-org", plan: "pro" } });
  const member = await prisma.user.create({ data: { email: "import-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
  memberId = member.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date("2026-01-01") } });

  const admin = await prisma.user.create({ data: { email: "import-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } });
  adminId = admin.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Swissgrid" } });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.customerMonth.deleteMany({ where: { orgId: ORG } });
  await prisma.monthLock.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [memberId, adminId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/import/timesheet", () => {
  it("preview schreibt nichts, meldet aber die korrekten Zahlen", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([
      ["01.05.2026", "Freitag", 8, "Arbeitszeit"],
      ["04.05.2026", "Montag", 8, "Arbeitszeit"],
    ]);
    const res = await importPost(uploadReq(buf, "preview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("preview");
    expect(body.imported).toBe(2);
    expect(body.skippedExisting).toBe(0);
    expect(body.errors).toEqual([]);

    const count = await prisma.timeEntry.count({ where: { orgId: ORG, userId: memberId } });
    expect(count).toBe(0);
  });

  it("commit schreibt tatsächlich, und ein zweiter Import überspringt die vorhandenen Daten statt sie zu überschreiben", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([
      ["01.05.2026", "Freitag", 8, "Arbeitszeit"],
      ["04.05.2026", "Montag", 4.8, "Feiertag"],
    ]);

    const first = await importPost(uploadReq(buf, "commit"));
    const firstBody = await first.json();
    expect(firstBody.imported).toBe(2);

    const stored = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId: memberId }, orderBy: { date: "asc" } });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ type: "arbeit", von: "08:00" });
    expect(stored[1]).toMatchObject({ type: "feiertag", hours: 4.8 });

    // Zweiter Import derselben Zeilen: übersprungen, keine Duplikate.
    const second = await importPost(uploadReq(buf, "commit"));
    const secondBody = await second.json();
    expect(secondBody.imported).toBe(0);
    expect(secondBody.skippedExisting).toBe(2);

    const countAfter = await prisma.timeEntry.count({ where: { orgId: ORG, userId: memberId } });
    expect(countAfter).toBe(2);
  });

  it("lehnt Zeilen in einem gesperrten Monat für 'member' ab, aber nicht für 'admin'", async () => {
    await prisma.monthLock.create({ data: { orgId: ORG, userId: memberId, year: 2026, month: 6, lockedBy: adminId } });
    await prisma.monthLock.create({ data: { orgId: ORG, userId: adminId, year: 2026, month: 6, lockedBy: adminId } });

    const buf = await buildXlsx([["15.06.2026", "Montag", 8, "Arbeitszeit"]]);

    setSession(memberId, ORG, "member");
    const memberRes = await importPost(uploadReq(buf, "commit"));
    const memberBody = await memberRes.json();
    expect(memberBody.imported).toBe(0);
    expect(memberBody.skippedLocked).toBe(1);

    setSession(adminId, ORG, "admin");
    const adminRes = await importPost(uploadReq(buf, "commit"));
    const adminBody = await adminRes.json();
    expect(adminBody.imported).toBe(1);
    expect(adminBody.skippedLocked).toBe(0);
  });

  it("liefert Zeilenfehler mit, importiert aber die gültigen Zeilen trotzdem", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([
      ["20.07.2026", "Montag", 8, "Arbeitszeit"],
      ["21.07.2026", "Dienstag", 8, "Urlaub"], // unbekannter Typ
    ]);
    const res = await importPost(uploadReq(buf, "commit"));
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toMatch(/Urlaub/);
  });
});

describe("POST /api/import/timesheet — Blatt 'Kundenstunden'", () => {
  it("commit schreibt CustomerMonth-Zeilen, ein zweiter Import überspringt dieselbe Kombination", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsxWithCustomerMonths([[2026, "April", "Swissgrid", 102.75]]);

    const first = await importPost(uploadReq(buf, "commit"));
    const firstBody = await first.json();
    expect(firstBody.importedCustomerMonths).toBe(1);
    expect(firstBody.totalCustomerMonthRows).toBe(1);

    const stored = await prisma.customerMonth.findMany({ where: { orgId: ORG, userId: memberId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ year: 2026, month: 4, customerId, hours: 102.75 });

    const second = await importPost(uploadReq(buf, "commit"));
    const secondBody = await second.json();
    expect(secondBody.importedCustomerMonths).toBe(0);
    expect(secondBody.skippedExistingCustomerMonths).toBe(1);

    const countAfter = await prisma.customerMonth.count({ where: { orgId: ORG, userId: memberId } });
    expect(countAfter).toBe(1);
  });

  it("preview für Kundenstunden schreibt nichts", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsxWithCustomerMonths([[2026, "Juli", "Swissgrid", 91]]);
    const res = await importPost(uploadReq(buf, "preview"));
    const body = await res.json();
    expect(body.importedCustomerMonths).toBe(1);
    const count = await prisma.customerMonth.count({ where: { orgId: ORG, userId: memberId, year: 2026, month: 7 } });
    expect(count).toBe(0);
  });

  it("unbekannter Kunde wird als Zeilenfehler mit Blatt-Kennzeichnung gemeldet", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsxWithCustomerMonths([[2026, "August", "Unbekannte AG", 5]]);
    const res = await importPost(uploadReq(buf, "commit"));
    const body = await res.json();
    expect(body.importedCustomerMonths).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].sheet).toBe("Kundenstunden");
    expect(body.errors[0].message).toMatch(/Unbekannte AG/);
  });

  it("gesperrter Monat wird für 'member' bei Kundenstunden ebenfalls respektiert", async () => {
    await prisma.monthLock.create({ data: { orgId: ORG, userId: memberId, year: 2026, month: 9, lockedBy: adminId } });
    setSession(memberId, ORG, "member");
    const buf = await buildXlsxWithCustomerMonths([[2026, "September", "Swissgrid", 20]]);
    const res = await importPost(uploadReq(buf, "commit"));
    const body = await res.json();
    expect(body.importedCustomerMonths).toBe(0);
    expect(body.skippedLockedCustomerMonths).toBe(1);
  });
});
