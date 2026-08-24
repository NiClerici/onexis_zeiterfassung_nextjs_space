export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { gatherOrgExport } from "@/lib/org-export";
import { styleHeaderRow, styleDataRow } from "@/lib/export-helpers";
import { logError } from "@/lib/error-log";

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const date = new Date(d);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

// Excel-Version: eine lesbare GESCHÄFTLICHE Zusammenfassung, bewusst nicht
// jede technische Tabelle (Audit-Trails, MonthLock, Invitation bleiben
// hier aussen vor — die stehen vollständig im JSON-Export). JSON bleibt
// die technisch VOLLSTÄNDIGE Fassung für echte Datenportabilität/Auskunft.
function buildExcelWorkbook(data: Awaited<ReturnType<typeof gatherOrgExport>>): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ONEXIS Zeiterfassung";

  const wsMembers = workbook.addWorksheet("Mitglieder");
  wsMembers.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "E-Mail", key: "email", width: 26 },
    { header: "Rolle", key: "role", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Eintritt", key: "entry", width: 14 },
    { header: "Austritt", key: "exit", width: 14 },
  ];
  styleHeaderRow(wsMembers.getRow(1), 6);
  for (const m of data.memberships) {
    const row = wsMembers.addRow({
      name: `${m.user.firstName} ${m.user.lastName}`,
      email: m.user.email,
      role: m.role,
      status: m.status,
      entry: fmtDate(m.entryDate),
      exit: fmtDate(m.exitDate),
    });
    styleDataRow(row, 6);
  }

  const wsEntries = workbook.addWorksheet("Zeiteinträge");
  wsEntries.columns = [
    { header: "Datum", key: "date", width: 14 },
    { header: "Typ", key: "type", width: 14 },
    { header: "Von", key: "von", width: 10 },
    { header: "Bis", key: "bis", width: 10 },
    { header: "Pause (Min)", key: "pause", width: 12 },
    { header: "Stunden", key: "hours", width: 12 },
    { header: "Notiz", key: "notiz", width: 24 },
    { header: "Gelöscht am", key: "deletedAt", width: 14 },
  ];
  styleHeaderRow(wsEntries.getRow(1), 8);
  for (const e of data.timeEntries) {
    const row = wsEntries.addRow({
      date: fmtDate(e.date),
      type: e.type,
      von: e.von ?? "",
      bis: e.bis ?? "",
      pause: e.pauseMin,
      hours: e.hours ?? "",
      notiz: e.notiz ?? "",
      deletedAt: fmtDate(e.deletedAt),
    });
    styleDataRow(row, 8);
  }

  const wsCustomers = workbook.addWorksheet("Kunden");
  wsCustomers.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Stundensatz", key: "rate", width: 14 },
  ];
  styleHeaderRow(wsCustomers.getRow(1), 2);
  for (const c of data.customers) {
    const row = wsCustomers.addRow({ name: c.name, rate: c.hourlyRate ?? "" });
    styleDataRow(row, 2);
  }

  const wsProjects = workbook.addWorksheet("Projekte");
  wsProjects.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "SAP-/Auftrags-Nr.", key: "externalRef", width: 24 },
    { header: "Stundensatz", key: "rate", width: 14 },
    { header: "Budget (h)", key: "budget", width: 14 },
    { header: "Aktiv", key: "active", width: 10 },
  ];
  styleHeaderRow(wsProjects.getRow(1), 5);
  for (const p of data.projects) {
    const row = wsProjects.addRow({ name: p.name, externalRef: p.externalRef ?? "", rate: p.hourlyRate ?? "", budget: p.budgetHours ?? "", active: p.active ? "Ja" : "Nein" });
    styleDataRow(row, 5);
  }

  const wsCustomerMonths = workbook.addWorksheet("Kundenstunden");
  wsCustomerMonths.columns = [
    { header: "Person", key: "name", width: 24 },
    { header: "Jahr", key: "year", width: 10 },
    { header: "Monat", key: "month", width: 10 },
    { header: "Kunde", key: "customer", width: 24 },
    { header: "Projekt", key: "project", width: 24 },
    { header: "Stunden", key: "hours", width: 12 },
  ];
  styleHeaderRow(wsCustomerMonths.getRow(1), 6);
  const userNameById = new Map(data.memberships.map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`]));
  const customerNameById = new Map(data.customers.map((c) => [c.id, c.name]));
  const projectNameById = new Map(data.projects.map((p) => [p.id, p.name]));
  for (const cm of data.customerMonths) {
    const row = wsCustomerMonths.addRow({
      name: userNameById.get(cm.userId) ?? cm.userId,
      year: cm.year,
      month: cm.month,
      customer: customerNameById.get(cm.customerId) ?? cm.customerId,
      project: cm.projectId ? (projectNameById.get(cm.projectId) ?? cm.projectId) : "",
      hours: cm.hours,
    });
    styleDataRow(row, 6);
  }

  const wsAbsences = workbook.addWorksheet("Absenzanträge");
  wsAbsences.columns = [
    { header: "Person", key: "name", width: 24 },
    { header: "Von", key: "from", width: 14 },
    { header: "Bis", key: "to", width: 14 },
    { header: "Typ", key: "type", width: 14 },
    { header: "Status", key: "status", width: 14 },
  ];
  styleHeaderRow(wsAbsences.getRow(1), 5);
  for (const a of data.absenceRequests) {
    const row = wsAbsences.addRow({
      name: `${a.user.firstName} ${a.user.lastName}`,
      from: fmtDate(a.fromDate),
      to: fmtDate(a.toDate),
      type: a.type,
      status: a.status,
    });
    styleDataRow(row, 5);
  }

  return workbook;
}

export async function GET(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const url = new URL(req.url);
    const format = url?.searchParams?.get?.("format") ?? "json";

    const data = await gatherOrgExport(orgId);
    const orgSlug = data.organization?.slug ?? "organisation";

    if (format === "excel") {
      const workbook = buildExcelWorkbook(data);
      const buffer = await workbook.xlsx.writeBuffer();
      return new Response(buffer as ArrayBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${orgSlug}_export.xlsx"`,
        },
      });
    }

    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${orgSlug}_export.json"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET organization export error:", error);
    await logError("GET /api/admin/organization/export", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
