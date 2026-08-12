export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";
import {
  kennzahlen,
  feriensaldo,
  sollStundenTag,
  stundenAusEintrag,
  type Profil,
  type PensumChangeInput,
  type EintragMitDatum,
  type PayoutInput,
  type KundeInput,
} from "@/lib/calc";

function buildProfil(user: any): Profil {
  return {
    pensum: user?.pensum ?? 100,
    wochenstunden: user?.weeklyHours ?? 42,
    startDate: user?.startDate ?? null,
    ferientage: user?.vacationDays ?? 25,
  };
}

function mapChanges(changes: any[]): PensumChangeInput[] {
  return changes.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
}

function mapEintraege(entries: any[]): EintragMitDatum[] {
  return entries.map((e) => ({
    date: e.date,
    typ: e.type,
    von: e.von,
    bis: e.bis,
    pauseMin: e.pauseMin,
    hours: e.hours,
    customerId: e.customerId,
  }));
}

const fmtDate = (d: Date) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const TYPE_LABELS: Record<string, string> = {
  arbeit: "Arbeitszeit",
  ferien: "Ferien",
  krank: "Krank",
  feiertag: "Feiertag",
  militaer: "Militär",
  unbezahlt: "Unbezahlt",
};

// Style helpers
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A56DB" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const LABEL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row.height = 24;
}

function styleDataRow(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: "middle" };
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const url = new URL(req.url);
    const type = url?.searchParams?.get?.("type") ?? "month";
    let startDate: Date;
    let endDate: Date;

    const now = new Date();
    const year = parseInt(url?.searchParams?.get?.("year") ?? String(now.getFullYear()));
    const month = parseInt(url?.searchParams?.get?.("month") ?? String(now.getMonth() + 1));

    // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
    // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC den letzten Tag der Periode abschneiden.
    if (type === "month") {
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0));
    } else if (type === "year") {
      startDate = new Date(Date.UTC(year, 0, 1));
      endDate = new Date(Date.UTC(year, 11, 31));
    } else {
      const fromStr = url?.searchParams?.get?.("from") ?? "";
      const toStr = url?.searchParams?.get?.("to") ?? "";
      startDate = fromStr ? new Date(fromStr) : new Date(Date.UTC(year, 0, 1));
      endDate = toStr ? new Date(toStr) : new Date(Date.UTC(year, 11, 31));
    }

    const profil = buildProfil(user);
    const heute = new Date();

    const pensumChangesRaw = await prisma.pensumChange.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
    const changes = mapChanges(pensumChangesRaw);

    const kundenRaw = await prisma.customer.findMany({ where: { userId } });
    const kunden: KundeInput[] = kundenRaw.map((k) => ({ id: k.id, billable: k.billable }));

    const entries = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });
    const eintraege = mapEintraege(entries);

    const payoutsRaw = await prisma.overtimePayout.findMany({ where: { userId, date: { gte: startDate, lte: endDate } } });
    const payouts: PayoutInput[] = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));

    const customerHours = await prisma.customerHour.findMany({
      where: {
        userId,
        OR: (() => {
          const conditions: any[] = [];
          const current = new Date(startDate);
          while (current <= endDate) {
            conditions.push({ year: current.getUTCFullYear(), month: current.getUTCMonth() + 1 });
            current.setUTCMonth(current.getUTCMonth() + 1);
          }
          return conditions?.length > 0 ? conditions : [{ year: 0, month: 0 }];
        })(),
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, kunden });

    const allPayouts = await prisma.overtimePayout.findMany({ where: { userId } });
    const totalPaidOutHours = allPayouts.reduce((s, p) => s + p.hours, 0);
    const netOvertime = k.ueberzeit;
    const overtimeGross = Math.round((k.ist - k.soll) * 10) / 10;

    const totalCustomerHours = customerHours.reduce((s: number, ch: any) => s + (ch?.hours ?? 0), 0);

    // ---- Feriensaldo für das Anzeigejahr ----
    const displayYear = startDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(displayYear, 0, 1));
    const yearEnd = new Date(Date.UTC(displayYear, 11, 31));
    const yearFerienRaw = await prisma.timeEntry.findMany({
      where: { userId, type: "ferien", date: { gte: yearStart, lte: yearEnd } },
    });
    const fs = feriensaldo({ jahr: displayYear, heute, profil, eintraege: mapEintraege(yearFerienRaw) });

    // ---- Build Excel workbook ----
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ONEXIS Zeiterfassung";

    // === Sheet 1: Tageszeiten ===
    const ws1 = workbook.addWorksheet("Tageszeiten");
    ws1.columns = [
      { header: "Datum", key: "date", width: 16 },
      { header: "Wochentag", key: "weekday", width: 14 },
      { header: "Von", key: "von", width: 10 },
      { header: "Bis", key: "bis", width: 10 },
      { header: "Stunden", key: "hours", width: 12 },
      { header: "Typ", key: "type", width: 16 },
      { header: "Kunde/Projekt", key: "projekt", width: 20 },
      { header: "Notiz", key: "notiz", width: 24 },
    ];
    styleHeaderRow(ws1.getRow(1), 8);

    const weekdayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    for (const entry of entries ?? []) {
      const d = new Date(entry.date);
      const tagesSoll = sollStundenTag(d, profil, changes);
      const stunden = stundenAusEintrag(
        { typ: entry.type as any, von: entry.von, bis: entry.bis, pauseMin: entry.pauseMin, hours: entry.hours },
        tagesSoll
      );
      const row = ws1.addRow({
        date: fmtDate(d),
        weekday: weekdayNames[d.getDay()] ?? "",
        von: entry.von ?? "",
        bis: entry.bis ?? "",
        hours: Math.round(stunden * 100) / 100,
        type: TYPE_LABELS[entry.type ?? ""] ?? entry.type ?? "",
        projekt: entry.projekt ?? "",
        notiz: entry.notiz ?? "",
      });
      styleDataRow(row, 8);
      const typeCell = row.getCell(6);
      if (entry.type === "ferien") typeCell.font = { color: { argb: "FF2563EB" } };
      else if (entry.type === "feiertag") typeCell.font = { color: { argb: "FF9333EA" } };
      else if (entry.type === "krank" || entry.type === "militaer") typeCell.font = { color: { argb: "FFDC2626" } };
    }

    ws1.views = [{ state: "frozen", ySplit: 1 }];

    // === Sheet 2: Kundenstunden ===
    const ws2 = workbook.addWorksheet("Kundenstunden");
    ws2.columns = [
      { header: "Jahr", key: "year", width: 10 },
      { header: "Monat", key: "month", width: 16 },
      { header: "Kunde", key: "customer", width: 28 },
      { header: "Stunden", key: "hours", width: 12 },
    ];
    styleHeaderRow(ws2.getRow(1), 4);

    for (const ch of customerHours ?? []) {
      const row = ws2.addRow({
        year: ch.year,
        month: monthNames[(ch.month ?? 1) - 1] ?? "",
        customer: ch.customerName ?? "",
        hours: Math.round((ch?.hours ?? 0) * 100) / 100,
      });
      styleDataRow(row, 4);
    }

    if ((customerHours?.length ?? 0) === 0) {
      const emptyRow = ws2.addRow({ year: "", month: "", customer: "Keine Kundenstunden vorhanden", hours: "" });
      emptyRow.getCell(3).font = { italic: true, color: { argb: "FF999999" } };
    }

    ws2.views = [{ state: "frozen", ySplit: 1 }];

    // === Sheet 3: Zusammenfassung ===
    const ws3 = workbook.addWorksheet("Zusammenfassung");
    ws3.columns = [
      { header: "Kennzahl", key: "label", width: 32 },
      { header: "Wert", key: "value", width: 18 },
    ];
    styleHeaderRow(ws3.getRow(1), 2);

    const summaryRows: Array<{ label: string; value: string | number; bold?: boolean; color?: string }> = [
      { label: "Zeitraum", value: `${fmtDate(startDate)} – ${fmtDate(endDate)}` },
      { label: "", value: "" },
      { label: "Sollstunden (bis heute)", value: `${k.soll.toFixed(1)}h` },
      { label: "Sollstunden (gesamt)", value: `${k.sollGesamt.toFixed(1)}h` },
      { label: "", value: "" },
      { label: "Ist-Stunden (bis heute)", value: `${k.ist.toFixed(1)}h`, bold: true },
      { label: "", value: "" },
      { label: "Geplante Stunden (Zukunft)", value: `${k.geplantZukunft.toFixed(1)}h` },
      { label: "Total (Ist + Geplant)", value: `${k.totalPrognose.toFixed(1)}h`, bold: true },
      { label: "", value: "" },
      { label: "Überstunden (aktuell)", value: `${overtimeGross >= 0 ? "+" : ""}${overtimeGross.toFixed(1)}h`, color: overtimeGross >= 0 ? "FF16A34A" : "FFDC2626" },
    ];

    if (totalPaidOutHours > 0) {
      summaryRows.push(
        { label: "Ausbezahlte Überstunden", value: `−${totalPaidOutHours.toFixed(1)}h` },
        { label: "Überzeit (netto)", value: `${netOvertime >= 0 ? "+" : ""}${netOvertime.toFixed(1)}h`, bold: true, color: netOvertime >= 0 ? "FF16A34A" : "FFDC2626" },
      );
    }

    summaryRows.push(
      { label: "", value: "" },
      { label: "Kundenstunden (Total)", value: `${k.kundenstunden.toFixed(1)}h` },
      { label: "Verrechnungsgrad", value: `${k.verrechnungsgrad.toFixed(1)}%` },
      { label: "", value: "" },
      { label: "Prognose Saldo", value: `${k.prognoseSaldo >= 0 ? "+" : ""}${k.prognoseSaldo.toFixed(1)}h`, bold: true, color: k.prognoseSaldo >= 0 ? "FF16A34A" : "FFDC2626" },
      { label: "", value: "" },
      { label: `Feriensaldo ${displayYear}`, value: "", bold: true },
      { label: "Gesamtanspruch", value: `${fs.anspruch} Tage`, bold: true },
      { label: "Bezogen", value: `${fs.bezogen} Tage` },
      { label: "Geplant", value: `${fs.geplant} Tage` },
      { label: "Restlich", value: `${fs.offen} Tage`, bold: true, color: fs.offen >= 0 ? "FF16A34A" : "FFDC2626" },
    );

    for (const item of summaryRows) {
      const row = ws3.addRow({ label: item.label, value: item.value });
      if (item.label === "") continue; // spacer row
      row.getCell(1).font = item.bold ? { ...LABEL_FONT } : { size: 11 };
      row.getCell(1).border = BORDER_THIN;
      row.getCell(2).border = BORDER_THIN;
      row.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
      if (item.bold) row.getCell(2).font = { bold: true, size: 11 };
      if (item.color) row.getCell(2).font = { ...(row.getCell(2).font as any), color: { argb: item.color } };
    }

    ws3.views = [{ state: "frozen", ySplit: 1 }];

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="zeiterfassung_export.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
