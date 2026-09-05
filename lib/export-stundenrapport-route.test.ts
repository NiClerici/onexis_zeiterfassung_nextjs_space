// Test für GET /api/export/stundenrapport — baut TimeEntry-Zeilen direkt in
// der Test-DB auf (Muster wie lib/export-routes.test.ts), liest den
// zurückgegebenen PDF-Buffer wieder aus (extractPdfText, siehe unten) und
// prüft Kopf, Projektkatalog und Detailzeilen.
//
// Ersetzt die frühere ExcelJS-Version dieser Datei vollständig — der Export
// liefert seit REVIEW_LOOP.md ("Kundenrapport soll PDF sein") keine .xlsx
// mehr. lib/pdf-stundenrapport.ts erzeugt PDFs bewusst mit compress:false
// (siehe dortiger Kommentar), damit hier ohne zusätzliche PDF-Parsing-
// Bibliothek per Regex auf enthaltenen/fehlenden Text geprüft werden kann.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
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

// pdfkit rendert Text als Hex-Strings innerhalb von "[<hex> kerning <hex> …] TJ"
// -Arrays (ein Array pro gezeichneter Zeile) — die Zahlen dazwischen sind
// Kerning-Korrekturen, keine Zeichen. Konkatenieren aller Hex-Chunks EINES
// Arrays liefert den ursprünglichen Textlauf zurück.
function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const lines: string[] = [];
  for (const m of raw.matchAll(/\[((?:<[0-9A-Fa-f]+>|-?\d+(?:\.\d+)?|\s)+)\]\s*TJ/g)) {
    let line = "";
    for (const hm of m[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
      const hex = hm[1];
      for (let i = 0; i < hex.length; i += 2) {
        line += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
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
  // eigenen (siehe lib/visibility.ts).
  const kollege = await prisma.user.create({ data: { email: "export-sr-kollege@example.test", password: "irrelevant", firstName: "Kollege", lastName: "Muster" } });
  kollegeId = kollege.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: kollegeId, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "MUS" } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Swissgrid", hourlyRate: 200 } });
  customerId = customer.id;
  const projectA = await prisma.project.create({
    data: { orgId: ORG, customerId, name: "Salesforce <> IAM", externalRef: "00000000000000120657TTO" },
  });
  projectAId = projectA.id;
  const projectB = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Phy. Schutz UW" } });
  projectBId = projectB.id;
  // Aktives Projekt OHNE Buchung in diesem Monat, von userId selbst angelegt
  // (createdBy-Zweig von ownProjectsWhere) — muss trotzdem geladen werden,
  // darf aber wegen 0h NICHT im Katalog erscheinen (Bugfix "falsche Projekte").
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
  it("liefert ein PDF mit Kopf, gefiltertem Projektkatalog und Detailzeilen — ohne Betrag/MwSt", async () => {
    setSession(userId, ORG, "member");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customerId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Vorlagenstil + Kundenname, jetzt mit .pdf statt .xlsx.
    expect(res.headers.get("Content-Disposition")).toContain("ONEXIS_Stundenabbrechnung_Juli-26_Swissgrid_NClerici.pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const text = extractPdfText(buf);

    // Kopf.
    expect(text).toContain("Stundenrapport:");
    expect(text).toContain("Nico Clerici, ONEXIS GmbH");
    expect(text).toContain("Monat:");
    expect(text).toContain("Juli 2026");
    expect(text).toContain("Kunde:");
    expect(text).toContain("Swissgrid");

    // Projektkatalog: die drei tatsächlich bebuchten Positionen.
    expect(text).toContain("Phy. Schutz UW");
    expect(text).toContain("00000000000000120657TTO | Salesforce <> IAM");
    expect(text).toContain("(ohne Projekt)");

    // Bugfix "falsche Projekte": ein eigenes, aktives, aber in diesem Monat
    // NICHT bebuchtes Projekt (0.00h) gehört nicht mehr in den Katalog.
    expect(text).not.toContain("Zukunftsprojekt");

    // Bugfix "Betrag/MwSt raus" — keine Spur mehr davon im ganzen Dokument.
    expect(text).not.toContain("MwSt");
    expect(text).not.toContain("Betrag");
    expect(text).not.toContain("Total (o. MwSt)");

    // "Kollegenprojekt" gehört dem Kollegen (weder Buchung noch createdBy
    // von userId) — darf im Export von userId nirgends auftauchen (Bug: sah
    // vorher ALLE aktiven Projekte des Kunden, nicht nur die eigenen).
    expect(text).not.toContain("Kollegenprojekt");

    // Detailzeilen: Datum, Kürzel, Task-Text — nur die 3 Juli-Einträge von
    // userId (der August-Eintrag und die Kollegen-Buchung fehlen).
    expect(text).toContain("Datum");
    expect(text).toContain("Kürzel");
    expect(text).toContain("Tasks");
    expect(text).toContain("01.07.2026");
    expect(text).toContain("08.07.2026");
    expect(text).toContain("09.07.2026");
    expect(text).not.toContain("01.08.2026");
    expect(text).toContain("CLN");
    expect(text).not.toContain("Kollege bucht");
    expect(text).toContain("SPI und SF anbindung");

    // Stunden-TOTAL: 6 + 3 + 2 = 11.
    expect(text).toContain("TOTAL");
    expect(text).toContain("11.00");
  });

  it("schliesst Projekte von Kolleg:innen aus — unabhängig von der Rolle", async () => {
    // Gleicher Export wie oben, aber als "owner" statt "member" — der
    // Rapport ist ein persönliches Dokument, der Eigen-Projekt-Filter gilt
    // deshalb für JEDE Rolle, nicht nur für member.
    setSession(userId, ORG, "owner");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customerId}`));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = extractPdfText(buf);
    expect(text).not.toContain("Kollegenprojekt");
    expect(text).toContain("11.00");
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

  it("ein Kunde ohne jede Buchung im gewählten Monat liefert ein PDF mit leerem Katalog statt eines Fehlers", async () => {
    const org2 = "test_export_sr_empty_org";
    await prisma.organization.create({ data: { id: org2, name: "Leer GmbH", slug: "export-sr-empty-org" } });
    const user2 = await prisma.user.create({ data: { email: "export-sr-empty@example.test", password: "irrelevant", firstName: "A", lastName: "B" } });
    await prisma.membership.create({ data: { orgId: org2, userId: user2.id, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "AB" } });
    const customer2 = await prisma.customer.create({ data: { orgId: org2, name: "Ohne Buchung AG" } });

    try {
      setSession(user2.id, org2, "member");
      const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customer2.id}`));
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = extractPdfText(buf);
      expect(text).toContain("keine gebuchten Projekte");
      expect(text).toContain("TOTAL");
      expect(text).toContain("0.00");
    } finally {
      await prisma.customer.deleteMany({ where: { orgId: org2 } });
      await prisma.membership.deleteMany({ where: { orgId: org2 } });
      await prisma.user.deleteMany({ where: { id: user2.id } });
      await prisma.organization.deleteMany({ where: { id: org2 } });
    }
  });
});
