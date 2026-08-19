// Test für GET /api/export/stundenrapport — baut TimeEntry-Zeilen direkt in
// der Test-DB auf (Muster wie lib/export-routes.test.ts), liest den
// zurückgegebenen Buffer wieder mit ExcelJS ein und prüft Kopf, Projekt-
// Summenblock und Detailzeilen. Zusätzlich ein echter Round-Trip: Import der
// Swissgrid-Referenzdatei (lib/import-stundenrapport.ts), dann Export
// desselben Monats — Summen müssen exakt übereinstimmen.

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

import { GET as exportGet } from "@/app/api/export/stundenrapport/route";
import { POST as importPost } from "@/app/api/import/stundenrapport/route";

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
let customerId: string;
let projectAId: string;
let projectBId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "ONEXIS GmbH", slug: "export-stundenrapport-test-org", plan: "pro" } });
  const user = await prisma.user.create({ data: { email: "export-sr@example.test", password: "irrelevant", firstName: "Nico", lastName: "Clerici" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "CLN" } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Swissgrid" } });
  customerId = customer.id;
  const projectA = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Salesforce <> IAM" } });
  projectAId = projectA.id;
  const projectB = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Phy. Schutz UW" } });
  projectBId = projectB.id;

  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-01"), type: "arbeit", hours: 6, notiz: "SPI und SF anbindung", customerId, projectId: projectAId },
  });
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-08"), type: "arbeit", hours: 3, notiz: "Export Fehler", customerId, projectId: projectBId },
  });
  // Entry ohne Projekt (nur Kunde) — soll trotzdem exportiert werden, mit
  // Platzhalter-Projektnamen.
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-07-09"), type: "arbeit", hours: 2, notiz: null, customerId, projectId: null },
  });
  // Entry in einem anderen Monat — darf im Juli-Export nicht auftauchen.
  await prisma.timeEntry.create({
    data: { orgId: ORG, userId, date: new Date("2026-08-01"), type: "arbeit", hours: 8, notiz: "August", customerId, projectId: projectAId },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("GET /api/export/stundenrapport", () => {
  it("liefert Kopf, Projekt-Summenblock und Detailzeilen für den gewählten Monat", async () => {
    setSession(userId, ORG, "member");
    const res = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customerId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("Stundenrapport_Swissgrid_07-2026.xlsx");

    const wb = await readWorkbook(res);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Swissgrid");

    expect(ws.getCell("A1").value).toBe("Stundenrapport:");
    expect(ws.getCell("C1").value).toBe("Nico Clerici, ONEXIS GmbH");
    expect(ws.getCell("A2").value).toBe("Monat:");
    expect(ws.getCell("C2").value).toBe("Juli 2026");
    expect(ws.getCell("A3").value).toBe("Kunde:");
    expect(ws.getCell("C3").value).toBe("Swissgrid");

    // Summenblock: 3 Projektzeilen (inkl. "(ohne Projekt)") + Total-Zeile,
    // ab Zeile 5.
    expect(ws.getCell("A5").value).toBe("STD");
    expect(ws.getCell("B5").value).toBe("Projekt");

    const projectRowValues: Record<string, number> = {};
    for (let r = 6; r <= 8; r++) {
      const name = ws.getCell(`B${r}`).value as string;
      projectRowValues[name] = ws.getCell(`A${r}`).value as number;
    }
    expect(projectRowValues["Salesforce <> IAM"]).toBe(6);
    expect(projectRowValues["Phy. Schutz UW"]).toBe(3);
    expect(projectRowValues["(ohne Projekt)"]).toBe(2);

    expect(ws.getCell("B9").value).toBe("Total (Stunden)");
    expect(ws.getCell("A9").value).toBe(11);

    // Detail-Header ab Zeile 11 (Zeile 10 ist die Leerzeile).
    expect(ws.getCell("A11").value).toBe("Datum");
    expect(ws.getCell("B11").value).toBe("Kürzel");
    expect(ws.getCell("C11").value).toBe("Projekt");
    expect(ws.getCell("D11").value).toBe("Tasks");
    expect(ws.getCell("E11").value).toBe("Std");

    // 3 Detailzeilen (August-Eintrag fehlt), sortiert nach Datum.
    expect(ws.getCell("A12").value).toBe("01.07.2026");
    expect(ws.getCell("B12").value).toBe("CLN");
    expect(ws.getCell("E12").value).toBe(6);
    expect(ws.getCell("A14").value).toBe("09.07.2026");
    expect(ws.getCell("C14").value).toBe("(ohne Projekt)");

    // TOTAL-Zeile: Formel über die drei Detailzeilen.
    expect(ws.getCell("A15").value).toBe("TOTAL");
    const totalCell = ws.getCell("E15").value as any;
    expect(totalCell?.formula).toBe("SUM(E12:E14)");
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

describe("Round-Trip: Import der Swissgrid-Referenzdatei, dann Export desselben Monats", () => {
  it("Export-Summe stimmt exakt mit den unabhängig ausgezählten 91.00h überein", async () => {
    const orgId = "test_export_sr_roundtrip_org";
    await prisma.organization.create({ data: { id: orgId, name: "Roundtrip Org", slug: "export-sr-roundtrip-org", plan: "pro" } });
    const user = await prisma.user.create({ data: { email: "export-sr-roundtrip@example.test", password: "irrelevant", firstName: "R", lastName: "T" } });
    await prisma.membership.create({ data: { orgId, userId: user.id, role: "member", entryDate: new Date("2026-01-01"), kuerzel: "CLN" } });

    try {
      setSession(user.id, orgId, "member");
      const buf = readFileSync("/Users/nicoclerici/Documents/Arbeit/Zeiterfassung/ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv");
      const fd = new FormData();
      fd.set("file", new File([buf], "ONEXIS_Stundenabbrechnung_April-26_NClerici(Swissgrid Juli).csv", { type: "text/csv" }));
      fd.set("mode", "commit");
      const importRes = await importPost(new Request("http://localhost/api/import/stundenrapport", { method: "POST", body: fd }));
      const importBody = await importRes.json();
      expect(importBody.imported).toBe(18);

      const customer = await prisma.customer.findFirst({ where: { orgId, name: "Swissgrid" } });
      expect(customer).not.toBeNull();

      const exportRes = await exportGet(req(`/api/export/stundenrapport?year=2026&month=7&customerId=${customer!.id}`));
      expect(exportRes.status).toBe(200);
      const wb = await readWorkbook(exportRes);
      const ws = wb.worksheets[0];

      // Summenblock: genau 2 Projektzeilen (Zeile 6-7), Total in Zeile 8.
      expect(ws.getCell("B6").value).not.toBeNull();
      expect(ws.getCell("B8").value).toBe("Total (Stunden)");
      expect(ws.getCell("A8").value).toBe(91);

      // 18 Detailzeilen ab Zeile 11 bis 28, TOTAL in Zeile 29.
      expect(ws.getCell("A29").value).toBe("TOTAL");
      expect((ws.getCell("E29").value as any)?.formula).toBe("SUM(E11:E28)");

      let sum = 0;
      for (let r = 11; r <= 28; r++) sum += Number(ws.getCell(`E${r}`).value ?? 0);
      expect(sum).toBeCloseTo(91, 5);
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
