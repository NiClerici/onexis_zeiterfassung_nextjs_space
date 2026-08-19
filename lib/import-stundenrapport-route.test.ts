// Test für POST /api/import/stundenrapport — analoges Muster zu
// lib/import-timesheet-route.test.ts (echte Test-DB, Route-Handler direkt
// aufgerufen). Prüft: preview schreibt nichts; commit legt Kunde+Projekte an
// und schreibt TimeEntry-Zeilen; ein zweiter Import derselben Datei legt
// nichts doppelt an; zwei Projektzeilen am selben Datum werden BEIDE
// importiert; gesperrte Monate werden für "member" respektiert, für "admin"
// nicht; sowohl .xlsx als auch .csv funktionieren; ein echter Lauf mit
// Nicos Referenzdatei ergibt 91.00h auf 18 Zeilen.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as importPost } from "@/app/api/import/stundenrapport/route";

const ORG = "test_import_stundenrapport_org";

const HEADER = [
  ["Stundenrapport:", "", "Nico Clerici, ONEXIS GmbH"],
  ["Monat:", "", "Juli 2026"],
  ["Kunde:", "", "Swissgrid"],
  [],
  ["STD", "Projekt", "", "Betrag ohne MwSt"],
  ["", "Salesforce <> IAM", "", 0],
  ["Total (o. MwSt)", "", 0],
  [],
];

async function buildXlsx(detailRows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Swissgrid");
  for (const r of HEADER) ws.addRow(r);
  ws.addRow(["Datum", "Kürzel", "Projekt", "Tasks", "Std"]);
  for (const r of detailRows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildCsv(detailRows: string[][]): string {
  const lines = [
    "Stundenrapport:;;Nico Clerici, ONEXIS GmbH",
    "Monat:;;Juli 2026",
    "Kunde:;;Swissgrid",
    "",
    "Datum;Kürzel;Projekt;Tasks;Std",
    ...detailRows.map((r) => r.join(";")),
  ];
  return lines.join("\n");
}

function uploadXlsxReq(buffer: Buffer, mode: "preview" | "commit", customerName?: string): Request {
  const fd = new FormData();
  fd.set("file", new File([buffer], "rapport.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  fd.set("mode", mode);
  if (customerName !== undefined) fd.set("customerName", customerName);
  return new Request("http://localhost/api/import/stundenrapport", { method: "POST", body: fd });
}

function uploadCsvReq(text: string, mode: "preview" | "commit"): Request {
  const fd = new FormData();
  const bytes = Buffer.from(text, "latin1");
  fd.set("file", new File([bytes], "rapport.csv", { type: "text/csv" }));
  fd.set("mode", mode);
  return new Request("http://localhost/api/import/stundenrapport", { method: "POST", body: fd });
}

let memberId: string;
let adminId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Import Stundenrapport Test Org", slug: "import-stundenrapport-test-org", plan: "pro" } });
  const member = await prisma.user.create({ data: { email: "import-sr-member@example.test", password: "irrelevant", firstName: "M", lastName: "Ember" } });
  memberId = member.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: memberId, role: "member", entryDate: new Date("2026-01-01") } });

  const admin = await prisma.user.create({ data: { email: "import-sr-admin@example.test", password: "irrelevant", firstName: "A", lastName: "Dmin" } });
  adminId = admin.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.monthLock.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [memberId, adminId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("POST /api/import/stundenrapport", () => {
  it("preview legt weder Kunde/Projekt noch TimeEntry an, meldet aber was entstehen würde", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["01.07.2026", "CLN", "Salesforce <> IAM", "SPI und SF anbindung", 6]]);
    const res = await importPost(uploadXlsxReq(buf, "preview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("preview");
    expect(body.customerName).toBe("Swissgrid");
    expect(body.customerIsNew).toBe(true);
    expect(body.newProjects).toEqual(["Salesforce <> IAM"]);
    expect(body.imported).toBe(1);
    expect(body.errors).toEqual([]);

    expect(await prisma.customer.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.timeEntry.count({ where: { orgId: ORG, userId: memberId } })).toBe(0);
  });

  it("commit legt Kunde und Projekt an und schreibt die Zeile; ein zweiter Import legt nichts doppelt an", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([
      ["01.07.2026", "CLN", "Salesforce <> IAM", "SPI und SF anbindung", 6],
      ["06.07.2026", "CLN", "Salesforce <> IAM", "SPI bestellung", 7],
    ]);

    const first = await importPost(uploadXlsxReq(buf, "commit"));
    const firstBody = await first.json();
    expect(firstBody.imported).toBe(2);
    expect(firstBody.customerIsNew).toBe(true);

    const customer = await prisma.customer.findFirst({ where: { orgId: ORG, name: "Swissgrid" } });
    expect(customer).not.toBeNull();
    const project = await prisma.project.findFirst({ where: { orgId: ORG, customerId: customer!.id, name: "Salesforce <> IAM" } });
    expect(project).not.toBeNull();

    const stored = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId: memberId }, orderBy: { date: "asc" } });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ type: "arbeit", hours: 6, notiz: "SPI und SF anbindung", projectId: project!.id, customerId: customer!.id });

    // Zweiter Import derselben Datei: Kunde/Projekt existieren schon,
    // Zeilen werden als Duplikate erkannt.
    const second = await importPost(uploadXlsxReq(buf, "commit"));
    const secondBody = await second.json();
    expect(secondBody.imported).toBe(0);
    expect(secondBody.skippedExisting).toBe(2);
    expect(secondBody.customerIsNew).toBe(false);
    expect(secondBody.newProjects).toEqual([]);

    expect(await prisma.timeEntry.count({ where: { orgId: ORG, userId: memberId } })).toBe(2);
    expect(await prisma.customer.count({ where: { orgId: ORG } })).toBe(1);
  });

  it("zwei Projektzeilen am selben Datum werden beide importiert", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId } });
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([
      ["14.07.2026", "CLN", "Salesforce <> IAM", "Script", 6],
      ["14.07.2026", "CLN", "Phy. Schutz UW", "Meetings UMS", 2],
    ]);
    const res = await importPost(uploadXlsxReq(buf, "commit"));
    const body = await res.json();
    expect(body.imported).toBe(2);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId: memberId, date: new Date("2026-07-14T00:00:00Z") } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.hours))).toEqual(new Set([6, 2]));
  });

  it("Whitespace-Variante des Projektnamens erzeugt kein zweites Projekt", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId } });
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["15.07.2026", "CLN", "Salesforce <> IAM ", "Testing", 4]]); // Leerzeichen am Ende
    const res = await importPost(uploadXlsxReq(buf, "commit"));
    const body = await res.json();
    expect(body.newProjects).toEqual([]); // Projekt existiert schon aus vorherigem Test

    const customer = await prisma.customer.findFirst({ where: { orgId: ORG, name: "Swissgrid" } });
    const projects = await prisma.project.findMany({ where: { orgId: ORG, customerId: customer!.id, name: "Salesforce <> IAM" } });
    expect(projects).toHaveLength(1);
  });

  it("lehnt Zeilen in einem gesperrten Monat für 'member' ab, aber nicht für 'admin'", async () => {
    await prisma.monthLock.create({ data: { orgId: ORG, userId: memberId, year: 2026, month: 6, lockedBy: adminId } });
    await prisma.monthLock.create({ data: { orgId: ORG, userId: adminId, year: 2026, month: 6, lockedBy: adminId } });

    const buf = await buildXlsx([["15.06.2026", "CLN", "Salesforce <> IAM", "Meeting", 3]]);

    setSession(memberId, ORG, "member");
    const memberRes = await importPost(uploadXlsxReq(buf, "commit"));
    const memberBody = await memberRes.json();
    expect(memberBody.imported).toBe(0);
    expect(memberBody.skippedLocked).toBe(1);

    setSession(adminId, ORG, "admin");
    const adminRes = await importPost(uploadXlsxReq(buf, "commit"));
    const adminBody = await adminRes.json();
    expect(adminBody.imported).toBe(1);
    expect(adminBody.skippedLocked).toBe(0);
  });

  it("customerName im Formular überschreibt den aus der Datei gelesenen Vorschlag", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["20.07.2026", "CLN", "Anderes Projekt", "Task", 2]]);
    const res = await importPost(uploadXlsxReq(buf, "preview", "Anderer Kunde AG"));
    const body = await res.json();
    expect(body.customerName).toBe("Anderer Kunde AG");
    expect(body.customerIsNew).toBe(true);
  });

  it("akzeptiert eine .csv-Datei (ISO-8859-1, Semikolon) genauso wie .xlsx", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId } });
    setSession(memberId, ORG, "member");
    const csv = buildCsv([["21.07.2026", "CLN", "Salesforce <> IAM", "CSV-Test", "3,00"]]);
    const res = await importPost(uploadCsvReq(csv, "commit"));
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.errors).toEqual([]);

    const row = await prisma.timeEntry.findFirst({ where: { orgId: ORG, userId: memberId, date: new Date("2026-07-21T00:00:00Z") } });
    expect(row).toMatchObject({ hours: 3, notiz: "CSV-Test" });
  });
});

describe("POST /api/import/stundenrapport — echte Referenzdatei (Swissgrid, Juli 2026)", () => {
  it("importiert 91.00h auf 18 Zeilen, verteilt auf genau 2 Projekte", async () => {
    const orgId = "test_import_sr_reference_org";
    await prisma.organization.create({ data: { id: orgId, name: "Reference Org", slug: "import-sr-reference-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "import-sr-ref@example.test", password: "irrelevant", firstName: "R", lastName: "Ef" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01") } });

    try {
      setSession(user.id, orgId, "member");
      const buf = readFileSync("/Users/nicoclerici/Documents/Arbeit/Zeiterfassung/ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv");
      const fd = new FormData();
      fd.set("file", new File([buf], "ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv", { type: "text/csv" }));
      fd.set("mode", "commit");
      const res = await importPost(new Request("http://localhost/api/import/stundenrapport", { method: "POST", body: fd }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.errors).toEqual([]);
      expect(body.imported).toBe(18);
      expect(body.customerName).toBe("Swissgrid");

      const rows = await prisma.timeEntry.findMany({ where: { orgId, userId: user.id } });
      expect(rows).toHaveLength(18);
      const totalHours = rows.reduce((s, r) => s + (r.hours ?? 0), 0);
      expect(totalHours).toBeCloseTo(91, 5);

      const distinctProjectIds = new Set(rows.map((r) => r.projectId));
      expect(distinctProjectIds.size).toBe(2);
    } finally {
      await prisma.timeEntry.deleteMany({ where: { orgId } });
      await prisma.project.deleteMany({ where: { orgId } });
      await prisma.customer.deleteMany({ where: { orgId } });
      await prisma.membership.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });
});
