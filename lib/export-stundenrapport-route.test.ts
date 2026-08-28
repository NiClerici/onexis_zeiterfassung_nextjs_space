// Test für GET /api/export/stundenrapport — baut TimeEntry-Zeilen direkt in
// der Test-DB auf (Muster wie lib/export-routes.test.ts), liest den
// zurückgegebenen Buffer wieder mit ExcelJS ein und prüft Kopf,
// Projektkatalog (inkl. SAP-Nummer/Betragsformel) und Detailzeilen —
// zellgenau nach ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx.

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

import { GET as exportGet } from "@/app/api/export/stundenrapport/route";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}

async function readWorkbook(res: Response): Promise<ExcelJS.Workbook> {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const ORG = "test_export_stundenrapport_org";
let userId: string;
let kollegeId: string;
let customerId: string;
let projectAId: string;
let projectBId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "ONEXIS GmbH", slug: "export-stundenrapport-test-org", plan: "pro" } });
  const user = await prisma.user.create({ data: { email: "export-sr@example.test", password: "irrelevant", firstName: "Nico", lastName: "Clerici" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "CLN" } });

  // Kollege in derselben Org/demselben Kunden — deckt den Bug ab, dass der
  // Katalog früher ALLE aktiven Projekte des Kunden zeigte statt nur die
  // eigenen (siehe lib/project-visibility.ts).
  const kollege = await prisma.user.create({ data: { email: "export-sr-kollege@example.test", password: "irrelevant", firstName: "Kollege", lastName: "Muster" } });
  kollegeId = kollege.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: kollegeId, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "MUS" } });

  // Kunde mit Fallback-Stundensatz (200) — greift für Projekte ohne eigenen Satz.
  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Swissgrid", hourlyRate: 200 } });
  customerId = customer.id;
  // Eigener Stundensatz + SAP-Nummer.
  const projectA = await prisma.project.create({
    data: { orgId: ORG, customerId, name: "Salesforce <> IAM", hourlyRate: 230, externalRef: "00000000000000120657TTO" },
  });
  projectAId = projectA.id;
  // Kein eigener Satz, keine SAP-Nummer — fällt auf den Kundensatz zurück.
  const projectB = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Phy. Schutz UW" } });
  projectBId = projectB.id;
  // Aktives Projekt OHNE Buchung in diesem Monat, aber von userId selbst
  // angelegt — muss trotzdem mit 0h im Katalog stehen (createdBy-Zweig von
  // ownProjectsWhere).
  await prisma.project.create({ data: { orgId: ORG, customerId, name: "Zukunftsprojekt", active: true, createdBy: userId } });
  // Aktives Projekt des Kollegen, das NICHTS mit userId zu tun hat (weder
  // Buchung noch createdBy) — darf im Export von userId nicht auftauchen.
  await prisma.project.create({ data: { orgId: ORG, customerId, name: "Kollegenprojekt", active: true, createdBy: kollegeId } });

  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-01"), type: "arbeit", hours: 6, notiz: "SPI und SF anbindung", customerId, projectId: projectAId },
  });
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-08"), type: "arbeit", hours: 3, notiz: "Export Fehler", customerId, projectId: projectBId },
  });
  // Entry ohne Projekt (nur Kunde) — soll trotzdem exportiert werden, mit
  // Platzhalter-Projektnamen, und im Katalog eine eigene Zeile bekommen.
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-09"), type: "arbeit", hours: 2, notiz: null, customerId, projectId: null },
  });
  // Entry in einem anderen Monat — darf im Juli-Export nicht auftauchen.
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-08-01"), type: "arbeit", hours: 8, notiz: "August", customerId, projectId: projectAId },
  });
  // Buchung des Kollegen auf "Kollegenprojekt" im selben Monat — die
  // Detailzeilen von userId dürfen sie nicht enthalten, und sie darf auch
  // keine Katalogzeile für userId erzeugen.
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId: kollegeId, date: new Date("2026-07-10"), type: "arbeit", hours: 5, notiz: "Kollege bucht", customerId },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, kollegeId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("GET /api/export/stundenrapport", () => {
  it("liefert Kopf, Projektkatalog und Detailzeilen im ONEXIS-Vorlagenlayout", async () => {
    setSession(userId, ORG, "member");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customerId}`));
    expect(res.status).toBe(200);
    // Vorlagenstil + Kundenname, damit zwei Kunden im selben Monat nicht
    // denselben Dateinamen ergeben.
    expect(res.headers.get("Content-Disposition")).toContain("ONEXIS_Stundenabbrechnung_Juli-26_Swissgrid_NClerici.xlsx");

    const wb = await readWorkbook(res);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Swissgrid Juli");

    expect(ws.getCell("A1").value).toBe("Stundenrapport:");
    expect(ws.getCell("C1").value).toBe("Nico Clerici, ONEXIS GmbH");
    expect(ws.getCell("A2").value).toBe("Monat:");
    expect(ws.getCell("C2").value).toBe("Juli 2026");
    expect(ws.getCell("A3").value).toBe("Kunde:");
    expect(ws.getCell("C3").value).toBe("Swissgrid");

    // Katalogblock ab Zeile 5: Kopfzeile mit Betragsspalte...
    expect(ws.getCell("A5").value).toBe("STD");
    expect(ws.getCell("B5").value).toBe("Projekt");
    expect(ws.getCell("D5").value).toBe("Betrag ohne MwSt");

    // ...dann alphabetisch je eine Zeile pro aktivem Projekt des Kunden
    // (auch mit 0h), plus "(ohne Projekt)" am Ende — Zeilen 6-9.
    expect(ws.getCell("B6").value).toBe("Phy. Schutz UW"); // kein externalRef → nur Name
    expect(ws.getCell("A6").value).toBe(3);
    expect((ws.getCell("D6").value as any).formula).toBe("A6*200"); // Fallback auf Kundensatz

    expect(ws.getCell("B7").value).toBe("00000000000000120657TTO | Salesforce <> IAM");
    expect(ws.getCell("A7").value).toBe(6);
    expect((ws.getCell("D7").value as any).formula).toBe("A7*230"); // eigener Projektsatz

    expect(ws.getCell("B8").value).toBe("Zukunftsprojekt");
    expect(ws.getCell("A8").value).toBe(0); // aktiv, aber keine Buchung diesen Monat

    expect(ws.getCell("B9").value).toBe("(ohne Projekt)");
    expect(ws.getCell("A9").value).toBe(2);

    // Kopf-Total über den ganzen Katalogblock.
    expect(ws.getCell("A10").value).toBe("Total (o. MwSt)");
    expect((ws.getCell("C10").value as any).formula).toBe("SUM(D6:D9)");

    // Katalogstunden-Summe muss der Detailsumme entsprechen (3+6+0+2 = 11).
    const catalogHoursSum = [6, 7, 8, 9].reduce((s, r) => s + (ws.getCell(`A${r}`).value as number), 0);
    expect(catalogHoursSum).toBe(11);

    // "Kollegenprojekt" gehört dem Kollegen (weder Buchung noch createdBy
    // von userId) — darf im Katalog von userId nicht auftauchen (Bug: sah
    // vorher ALLE aktiven Projekte des Kunden, nicht nur die eigenen).
    // Kein Zeilenversatz, weil ausgeschlossene Projekte gar nicht erst
    // geladen werden statt nachträglich herausgefiltert zu werden.
    for (let row = 6; row <= 10; row++) {
      expect(ws.getCell(`B${row}`).value).not.toBe("Kollegenprojekt");
      expect(ws.getCell(`C${row}`).value).not.toBe("Kollegenprojekt");
    }

    // Detail-Header ab Zeile 13 (zwei Leerzeilen nach dem Kopf-Total).
    expect(ws.getCell("A13").value).toBe("Datum");
    expect(ws.getCell("B13").value).toBe("Kürzel");
    expect(ws.getCell("C13").value).toBe("Projekt");
    expect(ws.getCell("D13").value).toBe("Tasks");
    expect(ws.getCell("E13").value).toBe("Std");

    // 3 Detailzeilen (August-Eintrag fehlt), sortiert nach Datum, echte
    // Datumszellen (kein String) — Kalendertag muss serverzeitzonen-
    // unabhängig stimmen (@db.Date liefert UTC-Mitternacht).
    const d14 = ws.getCell("A14").value as Date;
    expect(d14 instanceof Date).toBe(true);
    expect(d14.getUTCFullYear()).toBe(2026);
    expect(d14.getUTCMonth()).toBe(6); // Juli, 0-indiziert
    expect(d14.getUTCDate()).toBe(1);
    expect(ws.getCell("A14").numFmt).toBe("dd.mm.yyyy;@");
    expect(ws.getCell("B14").value).toBe("CLN");
    expect(ws.getCell("E14").value).toBe(6);

    const d16 = ws.getCell("A16").value as Date;
    expect(d16.getUTCDate()).toBe(9);
    expect(ws.getCell("C16").value).toBe("(ohne Projekt)");

    // TOTAL-Zeile: Formel schliesst die Leerzeile danach mit ein (wie im
    // Original SUM(E13:E30) die Leerzeile 30 einschliesst).
    expect(ws.getCell("A18").value).toBe("TOTAL");
    const totalCell = ws.getCell("E18").value as any;
    expect(totalCell?.formula).toBe("SUM(E14:E17)");

    // Detailblock enthält nur Zeilen von userId — die Buchung des Kollegen
    // auf "Kollegenprojekt" darf hier nicht auftauchen. 3 Detailzeilen
    // (14-16) wie oben geprüft, Zeile 17 ist die Leerzeile vor TOTAL.
    for (let row = 14; row <= 17; row++) {
      expect(ws.getCell(`C${row}`).value).not.toBe("Kollegenprojekt");
    }
  });

  it("schliesst Projekte von Kolleg:innen aus dem Katalog aus — unabhängig von der Rolle", async () => {
    // Gleicher Export wie oben, aber als "owner" statt "member" — der
    // Rapport ist ein persönliches Dokument, der Eigen-Projekt-Filter gilt
    // deshalb für JEDE Rolle, nicht nur für member (anders als GET
    // /api/projects, wo manager/admin/owner die ganze Organisation sehen).
    setSession(userId, ORG, "owner");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customerId}`));
    expect(res.status).toBe(200);
    const wb = await readWorkbook(res);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A10").value).toBe("Total (o. MwSt)");
    for (let row = 6; row <= 10; row++) {
      expect(ws.getCell(`B${row}`).value).not.toBe("Kollegenprojekt");
    }
  });

  it("lässt die Betragszelle leer, wenn weder Projekt noch Kunde einen Stundensatz haben", async () => {
    const org2 = "test_export_sr_no_rate_org";
    await prisma.organization.create({ data: { id: org2, name: "Rateless GmbH", slug: "export-sr-no-rate-org" } });
    const user2 = await prisma.user.create({ data: { email: "export-sr-no-rate@example.test", password: "irrelevant", firstName: "A", lastName: "B" } });
    await prisma.membership.create({ data: { orgId: org2, userId: user2.id, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "AB" } });
    const customer2 = await prisma.customer.create({ data: { orgId: org2, name: "Kein Satz AG" } }); // kein hourlyRate
    const project2 = await prisma.project.create({ data: { orgId: org2, customerId: customer2.id, name: "Projekt ohne Satz" } });
    await prisma.timeEntry.create({
      data: { orgId: org2, userId: user2.id, date: new Date("2026-07-02"), type: "arbeit", hours: 4, customerId: customer2.id, projectId: project2.id },
    });

    try {
      setSession(user2.id, org2, "member");
      const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customer2.id}`));
      expect(res.status).toBe(200);
      const wb = await readWorkbook(res);
      const ws = wb.worksheets[0];
      expect(ws.getCell("A6").value).toBe(4);
      expect(ws.getCell("D6").value).toBeNull();
    } finally {
      await prisma.timeEntry.deleteMany({ where: { orgId: org2 } });
      await prisma.project.deleteMany({ where: { orgId: org2 } });
      await prisma.customer.deleteMany({ where: { orgId: org2 } });
      await prisma.membership.deleteMany({ where: { orgId: org2 } });
      await prisma.user.deleteMany({ where: { id: user2.id } });
      await prisma.organization.deleteMany({ where: { id: org2 } });
    }
  });

  it("liefert 404 für einen Kunden aus einer anderen Organisation", async () => {
    const otherOrg = await prisma.organization.create({ data: { id: "test_export_sr_other_org", name: "Other", slug: "export-sr-other-org" } });
    const otherCustomer = await prisma.customer.create({ data: { orgId: otherOrg.id, name: "Fremd AG" } });
    try {
      setSession(userId, ORG, "member");
      const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${otherCustomer.id}`));
      expect(res.status).toBe(404);
    } finally {
      await prisma.customer.deleteMany({ where: { orgId: otherOrg.id } });
      await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
    }
  });

  it("400 ohne customerId", async () => {
    setSession(userId, ORG, "member");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7`));
    expect(res.status).toBe(400);
  });
});
