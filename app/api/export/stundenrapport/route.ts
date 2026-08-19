export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { parseYearMonthFromUrl, fmtDate, styleHeaderRow, styleDataRow } from "@/lib/export-helpers";
import { stundenAusEintrag } from "@/lib/calc";

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Sheet-Namen dürfen in Excel u.a. kein \ / ? * [ ] : enthalten und max.
// 31 Zeichen lang sein.
function sheetSafeName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Kunde";
}

// Export im Layout des alten ONEXIS-Stundenrapports — ein Kunde und ein
// Monat pro Datei: oben eine Stunden-je-Projekt-Zusammenfassung, darunter
// die Tages-/Projektzeilen. Anders als das Original ohne Betragsspalte
// (Produktentscheid) und mit ECHTEN Summen im Kopfblock — im
// Originaltemplate stand dort ein separater, von den Detailzeilen
// entkoppelter Projektkatalog mit SAP-Codes und immer 0.00 als Platzhalter.
// Datenquelle sind die Tageseinträge (TimeEntry mit Projekt/Kunde), die
// direkt im Kalender erfasst werden — kein Import mehr, der Nico bewusst
// wieder entfernt hat (zu fehleranfällig).
export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();
    const url = new URL(req.url);
    const { year, month } = parseYearMonthFromUrl(url);
    const customerId = url.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId fehlt" }, { status: 400 });
    }

    const [customer, membership] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, orgId } }),
      prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { user: true, org: true } }),
    ]);
    if (!customer) return NextResponse.json({ error: "Kunde nicht gefunden" }, { status: 404 });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));

    const entries = await prisma.timeEntry.findMany({
      where: { userId, orgId, type: "arbeit", deletedAt: null, customerId: customer.id, date: { gte: monthStart, lte: monthEnd } },
      include: { project: { select: { name: true } } },
      orderBy: { date: "asc" },
    });

    const kuerzel = membership.kuerzel ?? "";
    const personName = `${membership.user.firstName} ${membership.user.lastName}, ${membership.org.name}`;

    const rows = entries.map((e) => ({
      date: e.date,
      kuerzel,
      projektName: e.project?.name ?? "(ohne Projekt)",
      task: e.notiz ?? "",
      hours: round2(stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0)),
    }));

    const byProject = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      byProject.set(r.projektName, (byProject.get(r.projektName) ?? 0) + r.hours);
      total += r.hours;
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(sheetSafeName(customer.name));
    ws.columns = [{ width: 11 }, { width: 8 }, { width: 28 }, { width: 40 }, { width: 8 }];

    ws.getCell("A1").value = "Stundenrapport:";
    ws.getCell("C1").value = personName;
    ws.getCell("A2").value = "Monat:";
    ws.getCell("C2").value = `${MONTH_NAMES[month - 1]} ${year}`;
    ws.getCell("A3").value = "Kunde:";
    ws.getCell("C3").value = customer.name;
    for (const addr of ["A1", "C1", "A2", "C2", "A3", "C3"]) {
      ws.getCell(addr).font = { size: 14 };
    }

    let r = 5;
    ws.getCell(`A${r}`).value = "STD";
    ws.getCell(`B${r}`).value = "Projekt";
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).font = { bold: true };
    r++;

    const projectRows = [...byProject.entries()].sort((a, b) => b[1] - a[1]);
    for (const [projektName, hours] of projectRows) {
      ws.getCell(`A${r}`).value = round2(hours);
      ws.getCell(`A${r}`).numFmt = "0.00";
      ws.getCell(`B${r}`).value = projektName;
      ws.mergeCells(`B${r}:C${r}`);
      r++;
    }

    ws.getCell(`A${r}`).value = round2(total);
    ws.getCell(`A${r}`).numFmt = "0.00";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = "Total (Stunden)";
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(`B${r}`).font = { bold: true };
    r += 2; // eine Leerzeile, wie im Original

    const headerRow = ws.getRow(r);
    headerRow.values = ["Datum", "Kürzel", "Projekt", "Tasks", "Std"];
    styleHeaderRow(headerRow, 5);
    r++;

    const firstDetailRow = r;
    for (const row of rows) {
      const dataRow = ws.getRow(r);
      dataRow.values = [fmtDate(new Date(row.date)), row.kuerzel, row.projektName, row.task, row.hours];
      dataRow.getCell(5).numFmt = "0.00";
      styleDataRow(dataRow, 5);
      r++;
    }
    const lastDetailRow = r - 1;

    const totalRow = ws.getRow(r);
    totalRow.getCell(1).value = "TOTAL";
    totalRow.getCell(1).font = { bold: true };
    if (lastDetailRow >= firstDetailRow) {
      totalRow.getCell(5).value = { formula: `SUM(E${firstDetailRow}:E${lastDetailRow})` };
    } else {
      totalRow.getCell(5).value = 0;
    }
    totalRow.getCell(5).numFmt = "0.00";
    totalRow.getCell(5).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `Stundenrapport_${sheetSafeName(customer.name)}_${String(month).padStart(2, "0")}-${year}.xlsx`;

    return new Response(buffer as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET export/stundenrapport error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
