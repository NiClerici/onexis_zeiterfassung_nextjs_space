export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { parseYearMonthFromUrl } from "@/lib/export-helpers";
import {
  FONT_INFO_HEADER,
  FONT_CATALOG_LABEL,
  FONT_CATALOG_DATA,
  FONT_CATALOG_DATA_MUTED,
  FONT_DETAIL_HEADER,
  FONT_DETAIL_DATA,
  BORDER_MEDIUM_AUTO,
  BORDER_THIN_AUTO,
} from "@/lib/export-helpers";
import { stundenAusEintrag } from "@/lib/calc";
import { logError } from "@/lib/error-log";
import { ownProjectsWhere } from "@/lib/project-visibility";

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Sheet-Namen dürfen in Excel u.a. kein \ / ? * [ ] : enthalten und max.
// 31 Zeichen lang sein.
function sheetSafeName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Kunde";
}

// Dateinamen dürfen zusätzlich keine Leerzeichen enthalten (Vorlagenstil:
// "ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx"), sonst gleiche
// Regeln wie sheetSafeName.
function fileSafeName(name: string): string {
  return name.replace(/[\\/?*[\]:"<>|]/g, " ").trim().replace(/\s+/g, "-");
}

const NO_PROJECT_KEY = "__ohne-projekt__";
const NO_PROJECT_LABEL = "(ohne Projekt)";

// Export im Layout des alten ONEXIS-Stundenrapports — ein Kunde und ein
// Monat pro Datei: oben ein Projektkatalog mit SAP-/Auftragsnummern und
// Betrag-je-Projekt-Formel, darunter die Tages-/Projektzeilen. Zellgenau
// nach ONEXIS_Stundenabbrechnung_April-26_NClerici.xlsx (Vermessung siehe
// Plan-Datei) — anders als die Vorlage selbst enthält eine Exportdatei nur
// EIN Monatsblatt statt mehrerer. Datenquelle sind die Tageseinträge
// (TimeEntry mit Projekt/Kunde), die direkt im Kalender erfasst werden —
// kein Import mehr, der Nico bewusst wieder entfernt hat (zu fehleranfällig).
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

    // Katalog nur mit EIGENEN Projekten (lib/project-visibility.ts, gleiche
    // Regel wie GET /api/projects für "member") — der Rapport ist ein
    // persönliches Dokument, deshalb gilt der Filter für jede Rolle, auch
    // für owner/admin/manager. Ohne ihn stünden Projekte von Kolleg:innen
    // meist mit 0.00 h im Katalog (Bug: "sehe Projekte der anderen
    // Mitarbeiter").
    const ownFilter = await ownProjectsWhere(orgId, userId);
    const [entries, activeProjects] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { userId, orgId, type: "arbeit", deletedAt: null, customerId: customer.id, date: { gte: monthStart, lte: monthEnd } },
        include: { project: { select: { id: true, name: true, hourlyRate: true, externalRef: true } } },
        orderBy: { date: "asc" },
      }),
      prisma.project.findMany({ where: { orgId, customerId: customer.id, active: true, ...ownFilter }, orderBy: { name: "asc" } }),
    ]);

    const kuerzel = membership.kuerzel ?? "";
    const personName = `${membership.user.firstName} ${membership.user.lastName}, ${membership.org.name}`;

    const rows = entries.map((e) => ({
      date: e.date,
      kuerzel,
      projectId: e.project?.id ?? null,
      projektName: e.project?.name ?? NO_PROJECT_LABEL,
      task: e.notiz ?? "",
      hours: round2(stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0)),
    }));

    // Stunden je Projekt (bzw. "ohne Projekt") für den Katalogblock —
    // dieselbe Zuordnung, die auch die Detailzeilen tragen, damit
    // Kopfsumme und Detailsumme nie auseinanderlaufen.
    const hoursByKey = new Map<string, number>();
    for (const r of rows) {
      const key = r.projectId ?? NO_PROJECT_KEY;
      hoursByKey.set(key, (hoursByKey.get(key) ?? 0) + r.hours);
    }

    // Katalog = alle aktiven EIGENEN Projekte des Kunden (auch mit 0 Stunden
    // diesen Monat, siehe ownFilter oben) + Projekte, auf die diesen Monat
    // gebucht wurde, aber die nicht (mehr) aktiv sind + "(ohne Projekt)",
    // falls Stunden ohne Zuordnung existieren. Sonst würde die Kopfsumme
    // unter der Detailsumme liegen.
    const catalogByKey = new Map<string, { label: string; sortKey: string; rate: number | null }>();
    for (const p of activeProjects) {
      catalogByKey.set(p.id, {
        label: p.externalRef ? `${p.externalRef} | ${p.name}` : p.name,
        sortKey: p.name,
        rate: p.hourlyRate ?? customer.hourlyRate ?? null,
      });
    }
    for (const e of entries) {
      if (e.project && !catalogByKey.has(e.project.id)) {
        catalogByKey.set(e.project.id, {
          label: e.project.externalRef ? `${e.project.externalRef} | ${e.project.name}` : e.project.name,
          sortKey: e.project.name,
          rate: e.project.hourlyRate ?? customer.hourlyRate ?? null,
        });
      }
    }
    const catalogRows = [...catalogByKey.entries()]
      .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
      .map(([key, v]) => ({ key, label: v.label, rate: v.rate, hours: hoursByKey.get(key) ?? 0 }));
    if (hoursByKey.has(NO_PROJECT_KEY)) {
      catalogRows.push({
        key: NO_PROJECT_KEY,
        label: NO_PROJECT_LABEL,
        rate: customer.hourlyRate ?? null,
        hours: hoursByKey.get(NO_PROJECT_KEY) ?? 0,
      });
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(sheetSafeName(`${customer.name} ${MONTH_NAMES[month - 1]}`));
    ws.columns = [{ width: 11 }, { width: 7.16 }, { width: 27.66 }, { width: 57.66 }, { width: 7.66 }];
    ws.pageSetup = {
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: "portrait",
      paperSize: 9,
      scale: 65,
      margins: { left: 0.7086614173228347, right: 0.7086614173228347, top: 0.7480314960629921, bottom: 0.7480314960629921, header: 0.31496062992125984, footer: 0.31496062992125984 },
    };

    ws.getCell("A1").value = "Stundenrapport:";
    ws.getCell("C1").value = personName;
    ws.getCell("A2").value = "Monat:";
    ws.getCell("C2").value = `${MONTH_NAMES[month - 1]} ${year}`;
    ws.getCell("C2").numFmt = "@";
    ws.getCell("A3").value = "Kunde:";
    ws.getCell("C3").value = customer.name;
    for (const addr of ["A1", "C1", "A2", "C2", "A3", "C3"]) {
      ws.getCell(addr).font = FONT_INFO_HEADER;
    }
    ws.getRow(1).height = 19;
    ws.getRow(2).height = 19;
    ws.getRow(3).height = 19;
    ws.getRow(4).height = 20;

    // Katalogblock: Kopfzeile ab 5, eine Zeile je Projekt, danach die
    // Totalzeile — Zeilennummern wachsen mit der Projektanzahl, anders als
    // in der starren Vorlage.
    let r = 5;
    ws.getCell(`A${r}`).value = "STD";
    ws.getCell(`B${r}`).value = "Projekt";
    ws.getCell(`C${r}`).value = "Projekt";
    ws.getCell(`D${r}`).value = "Betrag ohne MwSt";
    for (const col of ["A", "B", "C", "D"]) {
      const cell = ws.getCell(`${col}${r}`);
      cell.font = FONT_CATALOG_LABEL;
      cell.border = BORDER_MEDIUM_AUTO;
      cell.alignment = { vertical: "middle", wrapText: true };
    }
    ws.mergeCells(`B${r}:C${r}`);
    ws.getRow(r).height = 17;
    r++;

    const firstCatalogRow = r;
    for (const c of catalogRows) {
      ws.getCell(`A${r}`).value = c.hours;
      ws.getCell(`A${r}`).numFmt = "0.00";
      ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getCell(`B${r}`).value = c.label;
      ws.getCell(`C${r}`).value = c.label;
      ws.getCell(`B${r}`).font = FONT_CATALOG_DATA_MUTED;
      ws.getCell(`C${r}`).font = FONT_CATALOG_DATA_MUTED;
      if (c.rate != null) {
        ws.getCell(`D${r}`).value = { formula: `A${r}*${c.rate}` };
        ws.getCell(`D${r}`).numFmt = "#,##0.00";
      }
      for (const col of ["A", "B", "C", "D"]) {
        const cell = ws.getCell(`${col}${r}`);
        if (col === "A") cell.font = FONT_CATALOG_DATA;
        else if (col === "D") cell.font = FONT_CATALOG_DATA;
        cell.border = { left: BORDER_MEDIUM_AUTO.left, right: BORDER_MEDIUM_AUTO.right, bottom: BORDER_MEDIUM_AUTO.bottom };
        if (!cell.alignment) cell.alignment = { vertical: "middle", wrapText: true };
      }
      ws.mergeCells(`B${r}:C${r}`);
      ws.getRow(r).height = 27;
      r++;
    }
    const lastCatalogRow = r - 1;

    ws.getCell(`A${r}`).value = "Total (o. MwSt)";
    ws.getCell(`B${r}`).value = "Total (o. MwSt)";
    ws.getCell(`C${r}`).value = { formula: `SUM(D${firstCatalogRow}:D${lastCatalogRow})` };
    ws.getCell(`C${r}`).numFmt = "#,##0.00";
    ws.getCell(`D${r}`).value = { formula: `SUM(D${firstCatalogRow}:D${lastCatalogRow})` };
    ws.getCell(`D${r}`).numFmt = "#,##0.00";
    for (const col of ["A", "B", "C", "D"]) {
      const cell = ws.getCell(`${col}${r}`);
      cell.font = FONT_CATALOG_LABEL;
      cell.border = BORDER_MEDIUM_AUTO;
      cell.alignment = { vertical: "middle", wrapText: true };
    }
    ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:D${r}`);
    ws.getRow(r).height = 17;
    r += 3; // zwei Leerzeilen wie im Original, dann der Detail-Header

    const headerRow = ws.getRow(r);
    headerRow.getCell(1).value = "Datum";
    headerRow.getCell(2).value = "Kürzel";
    headerRow.getCell(3).value = "Projekt";
    headerRow.getCell(4).value = "Tasks";
    headerRow.getCell(5).value = "Std";
    for (let i = 1; i <= 5; i++) {
      const cell = headerRow.getCell(i);
      cell.font = FONT_DETAIL_HEADER;
      cell.border = BORDER_THIN_AUTO;
      if (i === 5) cell.alignment = { horizontal: "left" };
    }
    r++;

    const firstDetailRow = r;
    for (const row of rows) {
      const dataRow = ws.getRow(r);
      // ExcelJS berechnet die Excel-Seriennummer direkt aus d.getTime()
      // (Utils.dateToExcel) — nicht über lokale Datumsteile. Der rohe
      // UTC-Mitternachtswert aus Prisma (@db.Date) muss deshalb UNVERÄNDERT
      // in die Zelle, sonst verschiebt sich der Tag serverzeitzonen-
      // abhängig um einen Tag (siehe Testfall unter TZ=Europe/Zurich).
      dataRow.getCell(1).value = new Date(row.date);
      dataRow.getCell(1).numFmt = "dd.mm.yyyy;@";
      dataRow.getCell(2).value = row.kuerzel;
      dataRow.getCell(3).value = row.projektName;
      dataRow.getCell(4).value = row.task;
      dataRow.getCell(4).alignment = { wrapText: true };
      dataRow.getCell(5).value = row.hours;
      dataRow.getCell(5).numFmt = "0.00";
      for (let i = 1; i <= 5; i++) {
        const cell = dataRow.getCell(i);
        cell.font = FONT_DETAIL_DATA;
        cell.border = BORDER_THIN_AUTO;
        if (i === 4) cell.alignment = { ...cell.alignment, wrapText: true };
      }
      r++;
    }
    const lastDetailRow = r - 1;
    r++; // eine Leerzeile wie im Original, gehört noch zur Summenformel

    const totalRow = ws.getRow(r);
    totalRow.getCell(1).value = "TOTAL";
    totalRow.getCell(1).font = FONT_DETAIL_HEADER;
    if (lastDetailRow >= firstDetailRow) {
      totalRow.getCell(5).value = { formula: `SUM(E${firstDetailRow}:E${r - 1})` };
    } else {
      totalRow.getCell(5).value = 0;
    }
    totalRow.getCell(5).numFmt = "0.00";
    totalRow.getCell(5).font = FONT_DETAIL_HEADER;

    const buffer = await workbook.xlsx.writeBuffer();
    const orgPrefix = fileSafeName(membership.org.name.split(/\s+/)[0] ?? "Export");
    const monthSlug = `${MONTH_NAMES[month - 1]}-${String(year % 100).padStart(2, "0")}`;
    const initials = `${membership.user.firstName?.[0] ?? ""}${membership.user.lastName ?? ""}`;
    const fileName = `${orgPrefix}_Stundenabbrechnung_${monthSlug}_${fileSafeName(customer.name)}_${fileSafeName(initials)}.xlsx`;

    return new Response(buffer as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET export/stundenrapport error:", error);
    await logError("GET /api/export/stundenrapport", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
