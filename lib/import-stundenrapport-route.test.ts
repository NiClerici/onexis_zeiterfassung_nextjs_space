// Test für POST /api/import/stundenrapport — analoges Muster zu
// lib/import-timesheet-route.test.ts (echte Test-DB, Route-Handler direkt
// aufgerufen). Antwortformat ist blockweise (ein Block pro Blatt/Datei),
// siehe app/api/import/stundenrapport/route.ts. Prüft: preview schreibt
// nichts; commit legt Kunde+Projekte an und schreibt TimeEntry-Zeilen; ein
// zweiter Import derselben Datei legt nichts doppelt an; zwei Projektzeilen
// am selben Datum werden BEIDE importiert; gesperrte Monate werden für
// "member" respektiert, für "admin" nicht; sowohl .xlsx als auch .csv
// funktionieren; mehrere Dateien/Blätter in einem Aufruf werden zu
// mehreren Blöcken, Kunde/Projekte aber nur einmal angelegt; ein echter
// Lauf mit Nicos 5-Blatt-Referenzdatei ergibt 73 Zeilen / 369.5h.

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

async function buildXlsx(detailRows: (string | number)[][], sheetName = "Swissgrid"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of HEADER) ws.addRow(r);
  ws.addRow(["Datum", "Kürzel", "Projekt", "Tasks", "Std"]);
  for (const r of detailRows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildXlsxMultiSheet(sheets: { name: string; monthLabel: string; rows: (string | number)[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(["Stundenrapport:", "", "Nico Clerici, ONEXIS GmbH"]);
    ws.addRow(["Monat:", "", s.monthLabel]);
    ws.addRow(["Kunde:", "", "Swissgrid"]);
    ws.addRow([]);
    ws.addRow(["STD", "Projekt", "", "Betrag ohne MwSt"]);
    ws.addRow(["Total (o. MwSt)", "", 0]);
    ws.addRow([]);
    ws.addRow(["Datum", "Kürzel", "Projekt", "Tasks", "Std"]);
    for (const r of s.rows) ws.addRow(r);
  }
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

interface UploadFile {
  buffer: Buffer;
  name: string;
  type: string;
}

function uploadReq(files: UploadFile[], mode: "preview" | "commit", customerName?: string): Request {
  const fd = new FormData();
  for (const f of files) fd.append("file", new File([f.buffer], f.name, { type: f.type }));
  fd.set("mode", mode);
  if (customerName !== undefined) fd.set("customerName", customerName);
  return new Request("http://localhost/api/import/stundenrapport", { method: "POST", body: fd });
}

function uploadXlsxReq(buffer: Buffer, mode: "preview" | "commit", customerName?: string): Request {
  return uploadReq([{ buffer, name: "rapport.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }], mode, customerName);
}

function uploadCsvReq(text: string, mode: "preview" | "commit"): Request {
  return uploadReq([{ buffer: Buffer.from(text, "latin1"), name: "rapport.csv", type: "text/csv" }], mode);
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

describe("POST /api/import/stundenrapport — Einzeldatei (ein Block)", () => {
  it("preview legt weder Kunde/Projekt noch TimeEntry an, meldet aber was entstehen würde", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["01.07.2026", "CLN", "Salesforce <> IAM", "SPI und SF anbindung", 6]]);
    const res = await importPost(uploadXlsxReq(buf, "preview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("preview");
    expect(body.blocks).toHaveLength(1);
    const block = body.blocks[0];
    expect(block.customerName).toBe("Swissgrid");
    expect(block.customerIsNew).toBe(true);
    expect(block.newProjects).toEqual(["Salesforce <> IAM"]);
    expect(block.imported).toBe(1);
    expect(block.errors).toEqual([]);
    expect(body.totalImported).toBe(1);

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
    expect(firstBody.totalImported).toBe(2);
    expect(firstBody.blocks[0].customerIsNew).toBe(true);

    const customer = await prisma.customer.findFirst({ where: { orgId: ORG, name: "Swissgrid" } });
    expect(customer).not.toBeNull();
    const project = await prisma.project.findFirst({ where: { orgId: ORG, customerId: customer!.id, name: "Salesforce <> IAM" } });
    expect(project).not.toBeNull();

    const stored = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId: memberId }, orderBy: { date: "asc" } });
    expect(stored).toHaveLength(2);
    // countsAsWorktime:false — Import-Zeilen sind Projekt-/Kundenzuordnung,
    // keine neue Arbeitszeit (sonst würde ein Tag mit schon vorhandener
    // Arbeitszeit beim Import verdoppelt gezählt).
    expect(stored[0]).toMatchObject({ type: "arbeit", hours: 6, notiz: "SPI und SF anbindung", projectId: project!.id, customerId: customer!.id, countsAsWorktime: false });

    // Zweiter Import derselben Datei: Kunde/Projekt existieren schon,
    // Zeilen werden als Duplikate erkannt.
    const second = await importPost(uploadXlsxReq(buf, "commit"));
    const secondBody = await second.json();
    expect(secondBody.totalImported).toBe(0);
    expect(secondBody.totalSkippedExisting).toBe(2);
    expect(secondBody.blocks[0].customerIsNew).toBe(false);
    expect(secondBody.blocks[0].newProjects).toEqual([]);

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
    expect(body.totalImported).toBe(2);

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
    expect(body.blocks[0].newProjects).toEqual([]); // Projekt existiert schon aus vorherigem Test

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
    expect(memberBody.totalImported).toBe(0);
    expect(memberBody.totalSkippedLocked).toBe(1);

    setSession(adminId, ORG, "admin");
    const adminRes = await importPost(uploadXlsxReq(buf, "commit"));
    const adminBody = await adminRes.json();
    expect(adminBody.totalImported).toBe(1);
    expect(adminBody.totalSkippedLocked).toBe(0);
  });

  it("customerName im Formular überschreibt den aus der Datei gelesenen Vorschlag", async () => {
    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["20.07.2026", "CLN", "Anderes Projekt", "Task", 2]]);
    const res = await importPost(uploadXlsxReq(buf, "preview", "Anderer Kunde AG"));
    const body = await res.json();
    expect(body.blocks[0].customerName).toBe("Anderer Kunde AG");
    expect(body.blocks[0].customerIsNew).toBe(true);
  });

  it("akzeptiert eine .csv-Datei (ISO-8859-1, Semikolon) genauso wie .xlsx", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId } });
    setSession(memberId, ORG, "member");
    const csv = buildCsv([["21.07.2026", "CLN", "Salesforce <> IAM", "CSV-Test", "3,00"]]);
    const res = await importPost(uploadCsvReq(csv, "commit"));
    const body = await res.json();
    expect(body.totalImported).toBe(1);
    expect(body.blocks[0].errors).toEqual([]);

    const row = await prisma.timeEntry.findFirst({ where: { orgId: ORG, userId: memberId, date: new Date("2026-07-21T00:00:00Z") } });
    expect(row).toMatchObject({ hours: 3, notiz: "CSV-Test", countsAsWorktime: false });
  });

  it("verdoppelt die Arbeitszeit nicht: eine bereits vorhandene Arbeitszeit-Zeile am selben Tag bleibt unangetastet, die Import-Zeile zählt separat", async () => {
    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, userId: memberId } });
    // Simuliert eine schon vorhandene, manuell erfasste Arbeitszeit ohne
    // Projekt (Von/Bis, wie im Tagesdialog) — genau das gemeldete Szenario.
    const existing = await prisma.timeEntry.create({
      data: { orgId: ORG, userId: memberId, date: new Date("2026-07-22T00:00:00Z"), type: "arbeit", von: "08:00", bis: "16:30", pauseMin: 30 },
    });
    expect(existing.countsAsWorktime).toBe(true);

    setSession(memberId, ORG, "member");
    const buf = await buildXlsx([["22.07.2026", "CLN", "Salesforce <> IAM", "Doppelte-Zeit-Test", 9]]);
    const res = await importPost(uploadXlsxReq(buf, "commit"));
    const body = await res.json();
    expect(body.totalImported).toBe(1);

    const rows = await prisma.timeEntry.findMany({ where: { orgId: ORG, userId: memberId, date: new Date("2026-07-22T00:00:00Z") } });
    expect(rows).toHaveLength(2);
    // Die alte Zeile bleibt exakt wie sie war (zählt weiter zur Arbeitszeit).
    const oldRow = rows.find((r) => r.id === existing.id)!;
    expect(oldRow).toMatchObject({ von: "08:00", bis: "16:30", countsAsWorktime: true });
    // Die neue Import-Zeile zählt bewusst NICHT zusätzlich zur Arbeitszeit.
    const importedRow = rows.find((r) => r.id !== existing.id)!;
    expect(importedRow).toMatchObject({ hours: 9, countsAsWorktime: false });
  });
});

describe("POST /api/import/stundenrapport — mehrere Blätter/Dateien in einem Aufruf", () => {
  it("ein Workbook mit mehreren Monatsblättern wird zu mehreren Blöcken, Kunde/Projekt aber nur einmal angelegt", async () => {
    const orgId = "test_import_sr_multisheet_org";
    await prisma.organization.create({ data: { id: orgId, name: "Multisheet Org", slug: "import-sr-multisheet-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "import-sr-multisheet@example.test", password: "irrelevant", firstName: "M", lastName: "S" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01") } });

    try {
      setSession(user.id, orgId, "member");
      const buf = await buildXlsxMultiSheet([
        { name: "April", monthLabel: "April 2026", rows: [["01.04.2026", "CLN", "Admin", "Setup", 6]] },
        { name: "Mai", monthLabel: "Mai 2026", rows: [["05.05.2026", "CLN", "Admin", "Setup", 4], ["06.05.2026", "CLN", "Support", "Ticket", 3]] },
      ]);
      const res = await importPost(uploadXlsxReq(buf, "commit"));
      const body = await res.json();

      expect(body.blocks).toHaveLength(2);
      expect(body.blocks.map((b: any) => b.sheetName)).toEqual(["April", "Mai"]);
      expect(body.totalImported).toBe(3);
      // "Admin" kommt in beiden Blättern vor — nur einmal als neu gemeldet
      // (im zweiten Block existiert es dank des ersten Blocks schon).
      expect(body.blocks[0].newProjects).toEqual(["Admin"]);
      expect(body.blocks[1].newProjects).toEqual(["Support"]);

      expect(await prisma.customer.count({ where: { orgId, name: "Swissgrid" } })).toBe(1);
      const projects = await prisma.project.findMany({ where: { orgId } });
      expect(projects.map((p) => p.name).sort()).toEqual(["Admin", "Support"]);

      const rows = await prisma.timeEntry.findMany({ where: { orgId, userId: user.id } });
      expect(rows).toHaveLength(3);
    } finally {
      await prisma.timeEntry.deleteMany({ where: { orgId } });
      await prisma.project.deleteMany({ where: { orgId } });
      await prisma.customer.deleteMany({ where: { orgId } });
      await prisma.membership.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });

  it("mehrere separat hochgeladene Dateien werden gemeinsam verarbeitet, Duplikate über Dateigrenzen hinweg erkannt", async () => {
    const orgId = "test_import_sr_multifile_org";
    await prisma.organization.create({ data: { id: orgId, name: "Multifile Org", slug: "import-sr-multifile-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "import-sr-multifile@example.test", password: "irrelevant", firstName: "M", lastName: "F" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01") } });

    try {
      setSession(user.id, orgId, "member");
      const fileA = await buildXlsx([["01.08.2026", "CLN", "Admin", "Setup", 5]], "August");
      const fileB = await buildXlsx([["02.08.2026", "CLN", "Admin", "Setup 2", 4]], "August-Fortsetzung");

      const res = await importPost(uploadReq(
        [
          { buffer: fileA, name: "august-teil1.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          { buffer: fileB, name: "august-teil2.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        ],
        "commit"
      ));
      const body = await res.json();
      expect(body.blocks).toHaveLength(2);
      expect(body.blocks.map((b: any) => b.fileName)).toEqual(["august-teil1.xlsx", "august-teil2.xlsx"]);
      expect(body.totalImported).toBe(2);
      // Kunde "Swissgrid" nur einmal angelegt, obwohl beide Dateien ihn im Kopf tragen.
      expect(await prisma.customer.count({ where: { orgId, name: "Swissgrid" } })).toBe(1);

      // Erneuter Import derselben zwei Dateien: beide Zeilen sind jetzt Duplikate.
      const secondRes = await importPost(uploadReq(
        [
          { buffer: fileA, name: "august-teil1.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          { buffer: fileB, name: "august-teil2.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        ],
        "commit"
      ));
      const secondBody = await secondRes.json();
      expect(secondBody.totalImported).toBe(0);
      expect(secondBody.totalSkippedExisting).toBe(2);
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

describe("POST /api/import/stundenrapport — echte Referenzdateien", () => {
  it("Einzeldatei Juli-CSV: importiert 91.00h auf 18 Zeilen, verteilt auf genau 2 Projekte", async () => {
    const orgId = "test_import_sr_reference_org";
    await prisma.organization.create({ data: { id: orgId, name: "Reference Org", slug: "import-sr-reference-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "import-sr-ref@example.test", password: "irrelevant", firstName: "R", lastName: "Ef" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01") } });

    try {
      setSession(user.id, orgId, "member");
      const buf = readFileSync("/Users/nicoclerici/Documents/Arbeit/Zeiterfassung/ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv");
      const res = await importPost(uploadReq([{ buffer: buf, name: "ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv", type: "text/csv" }], "commit"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.blocks[0].errors).toEqual([]);
      expect(body.totalImported).toBe(18);
      expect(body.blocks[0].customerName).toBe("Swissgrid");

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

  it("5-Blatt-Workbook (April–August): 73 Zeilen / 369.5h, genau ein Kunde, Projekte über alle Blätter dedupliziert", async () => {
    const orgId = "test_import_sr_reference5_org";
    await prisma.organization.create({ data: { id: orgId, name: "Reference5 Org", slug: "import-sr-reference5-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "import-sr-ref5@example.test", password: "irrelevant", firstName: "R", lastName: "F5" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01") } });

    try {
      setSession(user.id, orgId, "member");
      const buf = readFileSync("/Users/nicoclerici/Documents/Arbeit/Zeiterfassung/ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx");
      const res = await importPost(uploadReq([{ buffer: buf, name: "ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }], "commit"));
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.blocks).toHaveLength(5);
      expect(body.blocks.map((b: any) => b.sheetName)).toEqual([
        "Swissgrid April", "Swissgrid Mai", "Swissgrid Juni", "Swissgrid Juli", "Swissgrid August",
      ]);
      // Reale Datenqualitäts-Lücken (siehe lib/import-stundenrapport.test.ts):
      // Juni hat eine kaputte Zeile, August ist der noch laufende Monat mit
      // vorbereiteten, aber leeren Resttagen — beides als Zeilenfehler
      // gemeldet, blockiert aber nicht die gültigen Zeilen der übrigen Blätter.
      const totalErrors = body.blocks.reduce((s: number, b: any) => s + b.errors.length, 0);
      expect(totalErrors).toBe(11); // 1 (Juni) + 10 (August)

      expect(body.totalRows).toBe(73);
      expect(body.totalImported).toBe(73);
      expect(body.totalSkippedExisting).toBe(0);
      expect(body.totalSkippedLocked).toBe(0);

      // Nur EIN Kunde "Swissgrid" angelegt, nicht fünf.
      expect(await prisma.customer.count({ where: { orgId } })).toBe(1);

      const rows = await prisma.timeEntry.findMany({ where: { orgId, userId: user.id } });
      expect(rows).toHaveLength(73);
      const totalHours = rows.reduce((s, r) => s + (r.hours ?? 0), 0);
      expect(totalHours).toBeCloseTo(369.5, 5);

      // Zweiter Import derselben Datei: alles Duplikat, nichts Neues.
      const secondRes = await importPost(uploadReq([{ buffer: buf, name: "ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }], "commit"));
      const secondBody = await secondRes.json();
      expect(secondBody.totalImported).toBe(0);
      expect(secondBody.totalSkippedExisting).toBe(73);
      expect(await prisma.timeEntry.count({ where: { orgId, userId: user.id } })).toBe(73);
      expect(await prisma.customer.count({ where: { orgId } })).toBe(1);
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
