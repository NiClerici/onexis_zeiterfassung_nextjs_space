export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

// Helper: get target hours for a date range considering pensum changes
async function getTargetHoursForExport(userId: string, start: Date, end: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return 0;

  const pensumChanges = await prisma.pensumChange.findMany({
    where: { userId },
    orderBy: { effectiveFrom: "asc" },
  });

  function getDailyRateForDate(date: Date): number {
    let effectivePensum = user?.basePensum ?? user?.pensum ?? 100;
    let effectiveWeeklyHours = user?.baseWeeklyHours ?? user?.weeklyHours ?? 42;
    for (const change of pensumChanges) {
      const changeDate = new Date(change.effectiveFrom);
      if (changeDate <= date) {
        effectivePensum = change.pensum;
        effectiveWeeklyHours = change.weeklyHours;
      }
    }
    return (effectiveWeeklyHours * effectivePensum / 100) / 5;
  }

  let total = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      total += getDailyRateForDate(current);
    }
    current.setDate(current.getDate() + 1);
  }
  return total;
}

const fmtDate = (d: Date) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

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

    const url = new URL(req.url);
    const type = url?.searchParams?.get?.("type") ?? "month";
    let startDate: Date;
    let endDate: Date;

    const now = new Date();
    const year = parseInt(url?.searchParams?.get?.("year") ?? String(now.getFullYear()));
    const month = parseInt(url?.searchParams?.get?.("month") ?? String(now.getMonth() + 1));

    if (type === "month") {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else if (type === "year") {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    } else {
      const fromStr = url?.searchParams?.get?.("from") ?? "";
      const toStr = url?.searchParams?.get?.("to") ?? "";
      startDate = fromStr ? new Date(fromStr) : new Date(year, 0, 1);
      endDate = toStr ? new Date(toStr) : new Date(year, 11, 31);
    }

    // Fetch data
    const entries = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });

    const customerHours = await prisma.customerHour.findMany({
      where: {
        userId,
        OR: (() => {
          const conditions: any[] = [];
          const current = new Date(startDate);
          while (current <= endDate) {
            conditions.push({ year: current.getFullYear(), month: current.getMonth() + 1 });
            current.setMonth(current.getMonth() + 1);
          }
          return conditions?.length > 0 ? conditions : [{ year: 0, month: 0 }];
        })(),
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    // Summary calculations
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const pastEntries = entries.filter((e: any) => new Date(e.date) <= todayEnd);
    const futureEntries = entries.filter((e: any) => new Date(e.date) > todayEnd);

    const workHours = pastEntries.filter((e: any) => e?.type === "work").reduce((s: number, e: any) => s + (e?.hours ?? 0), 0);
    const vacationHours = pastEntries.filter((e: any) => e?.type === "vacation").reduce((s: number, e: any) => s + (e?.hours ?? 0), 0);
    const holidayHours = pastEntries.filter((e: any) => e?.type === "holiday").reduce((s: number, e: any) => s + (e?.hours ?? 0), 0);
    const istHours = workHours + vacationHours + holidayHours;
    const futureHoursTotal = futureEntries.reduce((s: number, e: any) => s + (e?.hours ?? 0), 0);
    const totalIstPlusPlan = istHours + futureHoursTotal;

    const fullTargetHours = await getTargetHoursForExport(userId, startDate, endDate);
    const effectiveEndDate = endDate > todayEnd ? todayEnd : endDate;
    const cappedTargetHours = effectiveEndDate >= startDate
      ? await getTargetHoursForExport(userId, startDate, effectiveEndDate)
      : 0;

    const overtimeCurrent = istHours - cappedTargetHours;
    const forecastBalance = totalIstPlusPlan - fullTargetHours;

    const allPayouts = await prisma.overtimePayout.findMany({ where: { userId } });
    const totalPaidOutHours = allPayouts?.reduce?.((s: number, p: any) => s + (p?.hours ?? 0), 0) ?? 0;
    const netOvertime = overtimeCurrent - totalPaidOutHours;

    const totalCustomerHours = customerHours.reduce((s: number, ch: any) => s + (ch?.hours ?? 0), 0);

    // ---- Vacation balance calculation (same logic as analytics) ----
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const pensumChanges = await prisma.pensumChange.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
    function getDailyRateForDate(date: Date): number {
      let effectivePensum = user?.basePensum ?? user?.pensum ?? 100;
      let effectiveWeeklyHours = user?.baseWeeklyHours ?? user?.weeklyHours ?? 42;
      for (const change of pensumChanges) {
        const changeDate = new Date(change.effectiveFrom);
        if (changeDate <= date) { effectivePensum = change.pensum; effectiveWeeklyHours = change.weeklyHours; }
      }
      return (effectiveWeeklyHours * effectivePensum / 100) / 5;
    }

    const displayYear = startDate.getFullYear();
    const userVacationDaysPerYear = user?.vacationDays ?? 25;
    const userStartDate = user?.startDate ? new Date(user.startDate) : null;
    let proRataVacation = userVacationDaysPerYear;
    if (userStartDate) {
      const sy = userStartDate.getFullYear();
      if (sy === displayYear) {
        const diy = ((displayYear % 4 === 0 && displayYear % 100 !== 0) || displayYear % 400 === 0) ? 366 : 365;
        const soy = new Date(displayYear, 0, 1);
        const dp = Math.max(0, Math.floor((userStartDate.getTime() - soy.getTime()) / (1000 * 60 * 60 * 24)));
        proRataVacation = userVacationDaysPerYear * ((diy - dp) / diy);
      } else if (sy > displayYear) { proRataVacation = 0; }
    }

    let carryoverDays = 0;
    if (displayYear > 2020) {
      const prevYearStart = new Date(displayYear - 1, 0, 1);
      const prevYearEnd = new Date(displayYear - 1, 11, 31);
      let prevYearEntitlement = userVacationDaysPerYear;
      if (userStartDate) {
        const sy = userStartDate.getFullYear();
        if (sy === displayYear - 1) {
          const dip = (((displayYear - 1) % 4 === 0 && (displayYear - 1) % 100 !== 0) || (displayYear - 1) % 400 === 0) ? 366 : 365;
          const sop = new Date(displayYear - 1, 0, 1);
          const dp = Math.max(0, Math.floor((userStartDate.getTime() - sop.getTime()) / (1000 * 60 * 60 * 24)));
          prevYearEntitlement = userVacationDaysPerYear * ((dip - dp) / dip);
        } else if (sy > displayYear - 1) { prevYearEntitlement = 0; }
      }
      const prevVacEntries = await prisma.timeEntry.findMany({ where: { userId, type: "vacation", date: { gte: prevYearStart, lte: prevYearEnd } } });
      const prevVacHours = prevVacEntries?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
      const prevDailyRate = getDailyRateForDate(prevYearEnd);
      const prevUsedDays = prevDailyRate > 0 ? prevVacHours / prevDailyRate : 0;
      carryoverDays = Math.max(0, prevYearEntitlement - prevUsedDays);
    }

    const currentYearStart = new Date(displayYear, 0, 1);
    const currentYearEnd = new Date(displayYear, 11, 31);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const currentYearVacEntries = await prisma.timeEntry.findMany({ where: { userId, type: "vacation", date: { gte: currentYearStart, lte: currentYearEnd } } });
    const yearDailyRate = getDailyRateForDate(new Date(displayYear, 6, 1));
    const pastVacHours = currentYearVacEntries?.filter?.((e: any) => new Date(e.date) <= today)?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const usedVacDays = yearDailyRate > 0 ? pastVacHours / yearDailyRate : 0;
    const futureVacHours = currentYearVacEntries?.filter?.((e: any) => new Date(e.date) > today)?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const plannedVacDays = yearDailyRate > 0 ? futureVacHours / yearDailyRate : 0;
    const totalVacDays = proRataVacation + carryoverDays;
    const remainingVacDays = totalVacDays - usedVacDays - plannedVacDays;

    // ---- Build Excel workbook ----
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ONEXIS Zeiterfassung";

    // === Sheet 1: Tageszeiten ===
    const ws1 = workbook.addWorksheet("Tageszeiten");
    const typeMap: Record<string, string> = { work: "Arbeitszeit", vacation: "Ferien", holiday: "Feiertag" };

    ws1.columns = [
      { header: "Datum", key: "date", width: 16 },
      { header: "Wochentag", key: "weekday", width: 14 },
      { header: "Stunden", key: "hours", width: 12 },
      { header: "Typ", key: "type", width: 16 },
    ];
    styleHeaderRow(ws1.getRow(1), 4);

    const weekdayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    for (const entry of entries ?? []) {
      const d = new Date(entry.date);
      const row = ws1.addRow({
        date: fmtDate(d),
        weekday: weekdayNames[d.getDay()] ?? "",
        hours: Math.round((entry?.hours ?? 0) * 100) / 100,
        type: typeMap?.[entry?.type ?? ""] ?? entry?.type ?? "",
      });
      styleDataRow(row, 4);
      // Color-code the type
      const typeCell = row.getCell(4);
      if (entry.type === "vacation") typeCell.font = { color: { argb: "FF2563EB" } };
      else if (entry.type === "holiday") typeCell.font = { color: { argb: "FF9333EA" } };
    }

    // Freeze header row
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
      { label: "Sollstunden (bis heute)", value: `${cappedTargetHours.toFixed(1)}h` },
      { label: "Sollstunden (gesamt)", value: `${fullTargetHours.toFixed(1)}h` },
      { label: "", value: "" },
      { label: "Arbeitsstunden", value: `${workHours.toFixed(1)}h` },
      { label: "Ferienstunden", value: `${vacationHours.toFixed(1)}h` },
      { label: "Feiertagsstunden", value: `${holidayHours.toFixed(1)}h` },
      { label: "Ist-Stunden (bis heute)", value: `${istHours.toFixed(1)}h`, bold: true },
      { label: "", value: "" },
      { label: "Geplante Stunden (Zukunft)", value: `${futureHoursTotal.toFixed(1)}h` },
      { label: "Total (Ist + Geplant)", value: `${totalIstPlusPlan.toFixed(1)}h`, bold: true },
      { label: "", value: "" },
      { label: "Überstunden (aktuell)", value: `${overtimeCurrent >= 0 ? "+" : ""}${overtimeCurrent.toFixed(1)}h`, color: overtimeCurrent >= 0 ? "FF16A34A" : "FFDC2626" },
    ];

    if (totalPaidOutHours > 0) {
      summaryRows.push(
        { label: "Ausbezahlte Überstunden", value: `−${totalPaidOutHours.toFixed(1)}h` },
        { label: "Überzeit (netto)", value: `${netOvertime >= 0 ? "+" : ""}${netOvertime.toFixed(1)}h`, bold: true, color: netOvertime >= 0 ? "FF16A34A" : "FFDC2626" },
      );
    }

    summaryRows.push(
      { label: "", value: "" },
      { label: "Kundenstunden (Total)", value: `${totalCustomerHours.toFixed(1)}h` },
      { label: "Verrechnungsgrad", value: `${workHours > 0 ? ((totalCustomerHours / workHours) * 100).toFixed(1) : "0.0"}%` },
      { label: "", value: "" },
      { label: "Prognose Saldo", value: `${forecastBalance >= 0 ? "+" : ""}${forecastBalance.toFixed(1)}h`, bold: true, color: forecastBalance >= 0 ? "FF16A34A" : "FFDC2626" },
      { label: "", value: "" },
      { label: `Feriensaldo ${displayYear}`, value: "", bold: true },
      { label: "Ferienanspruch", value: `${(Math.round(proRataVacation * 10) / 10)} Tage` },
      ...(carryoverDays > 0 ? [{ label: "Übertrag Vorjahr", value: `${(Math.round(carryoverDays * 10) / 10)} Tage` }] : []),
      { label: "Gesamtanspruch", value: `${(Math.round(totalVacDays * 10) / 10)} Tage`, bold: true },
      { label: "Bezogen", value: `${(Math.round(usedVacDays * 10) / 10)} Tage` },
      { label: "Geplant", value: `${(Math.round(plannedVacDays * 10) / 10)} Tage` },
      { label: "Restlich", value: `${(Math.round(remainingVacDays * 10) / 10)} Tage`, bold: true, color: remainingVacDays >= 0 ? "FF16A34A" : "FFDC2626" },
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
