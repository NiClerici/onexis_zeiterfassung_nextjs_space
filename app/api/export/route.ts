export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, canSeeUser, listVisibleUserIds, AccessError } from "@/lib/access";
import ExcelJS from "exceljs";
import { kennzahlen, feriensaldo, sollStundenTag, stundenAusEintrag, type HolidayInput, type PayoutInput } from "@/lib/calc";
import {
  buildProfil,
  mapChanges,
  mapEintraege,
  parseExportRange,
  fmtDate,
  TYPE_LABELS,
  LABEL_FONT,
  BORDER_THIN,
  styleHeaderRow,
  styleDataRow,
} from "@/lib/export-helpers";

// Für scope=org (siehe GET unten): eine Zeile pro aktivem Mitglied statt der
// vollen Tagesliste — ein kompletter Tagesbericht für jede Person in einem
// einzigen Workbook wäre für grössere Organisationen unhandlich und
// überschneidet sich mit der noch kommenden Teamsicht (MIGRATION.md
// Punkt 8, teamKennzahlen()), die genau dafür gebaut wird. Diese Sheet
// bleibt bewusst eine kompakte Übersicht.
// restrictToUserIds (optional): manager exportieren mit scope=org NICHT die
// ganze Organisation, sondern nur ihr eigenes Team (MIGRATION.md Punkt 8 —
// dieselbe Lücke, die dort für die Teamsicht geschlossen wurde, gilt auch
// hier für den Excel-Export der Teamsicht-Tabelle).
async function buildOrgSummaryWorkbook(orgId: string, startDate: Date, endDate: Date, restrictToUserIds?: string[]): Promise<ExcelJS.Workbook> {
  const heute = new Date();
  const memberships = await prisma.membership.findMany({
    where: { orgId, status: "aktiv", ...(restrictToUserIds ? { userId: { in: restrictToUserIds } } : {}) },
    include: { user: { select: { firstName: true, lastName: true, email: true } }, org: true },
    orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
  });

  const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
  const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ONEXIS Zeiterfassung";
  const ws = workbook.addWorksheet("Alle Mitarbeitenden");
  ws.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "E-Mail", key: "email", width: 26 },
    { header: "Sollstunden", key: "soll", width: 14 },
    { header: "Iststunden", key: "ist", width: 14 },
    { header: "Überstunden", key: "ueberstunden", width: 14 },
    { header: "Überzeit", key: "ueberzeit", width: 12 },
    { header: "Verrechnungsgrad", key: "verrechnung", width: 16 },
    { header: "Feriensaldo (offen)", key: "ferien", width: 16 },
  ];
  styleHeaderRow(ws.getRow(1), 8);

  // Vier Queries für ALLE Mitglieder statt vier je Mitglied (HARDENING.md
  // B4) — bei 60 Mitgliedern sonst 244 Queries in 60 nacheinander
  // abgearbeiteten Runden. Gleiche Bündelung wie in app/api/team/route.ts,
  // die Berechnung darunter ist unverändert.
  const alleUserIds = memberships.map((m) => m.userId);
  const jahrStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
  const jahrEnde = new Date(Date.UTC(startDate.getUTCFullYear(), 11, 31));
  const [alleChanges, alleEntries, allePayouts, alleFerien] = await Promise.all([
    prisma.pensumChange.findMany({ where: { userId: { in: alleUserIds }, orgId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
    prisma.overtimePayout.findMany({ where: { userId: { in: alleUserIds }, orgId, date: { gte: startDate, lte: endDate } } }),
    prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, type: "ferien", date: { gte: jahrStart, lte: jahrEnde } } }),
  ]);
  // Gruppierung erhält die Query-Reihenfolge — für pensumChange also das
  // orderBy effectiveFrom asc, auf das sich pensumAt bei zwei Änderungen am
  // selben Tag verlässt (HARDENING.md A2).
  function nachUser<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const liste = map.get(row.userId);
      if (liste) liste.push(row);
      else map.set(row.userId, [row]);
    }
    return map;
  }
  const changesByUser = nachUser(alleChanges);
  const entriesByUser = nachUser(alleEntries);
  const payoutsByUser = nachUser(allePayouts);
  const ferienByUser = nachUser(alleFerien);

  for (const m of memberships) {
    const profil = buildProfil(m);
    const pensumChangesRaw = changesByUser.get(m.userId) ?? [];
    const entries = entriesByUser.get(m.userId) ?? [];
    const payoutsRaw = payoutsByUser.get(m.userId) ?? [];
    const ferienRaw = ferienByUser.get(m.userId) ?? [];
    const changes = mapChanges(pensumChangesRaw);
    const eintraege = mapEintraege(entries);
    const payouts: PayoutInput[] = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));
    const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, holidays });
    const fs = feriensaldo({ jahr: startDate.getUTCFullYear(), heute, profil, changes, holidays, eintraege: mapEintraege(ferienRaw) });

    const row = ws.addRow({
      name: `${m.user.firstName} ${m.user.lastName}`,
      email: m.user.email,
      soll: k.soll,
      ist: k.ist,
      ueberstunden: k.ueberstunden,
      ueberzeit: k.ueberzeit,
      verrechnung: `${k.verrechnungsgrad.toFixed(1)}%`,
      ferien: `${fs.offen} Tage`,
    });
    styleDataRow(row, 8);
    if (k.ueberzeit > 0) row.getCell(6).font = { color: { argb: "FFDC2626" }, bold: true };
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return workbook;
}

export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId } = ctx;

    const url = new URL(req.url);
    const { startDate, endDate } = parseExportRange(url);

    // scope: "self" (Standard) | "person" (admin/owner/manager exportiert
    // für ein anderes, sichtbares Mitglied — canSeeUser prüft das) | "org"
    // (admin/owner: ganze Organisation; manager: nur das eigene Team, siehe
    // restrictToUserIds unten). MIGRATION.md Punkt 7, erster Bullet:
    // "pro Person oder gesamte Organisation".
    const scope = url?.searchParams?.get?.("scope") ?? "self";

    if (scope === "org") {
      requireRole(ctx.role, ["owner", "admin", "manager"]);
      const restrictToUserIds = (await listVisibleUserIds(ctx)) ?? undefined;
      const workbook = await buildOrgSummaryWorkbook(orgId, startDate, endDate, restrictToUserIds);
      const buffer = await workbook.xlsx.writeBuffer();
      return new Response(buffer as ArrayBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="zeiterfassung_export_organisation.xlsx"`,
        },
      });
    }

    let userId = ctx.userId;
    if (scope === "person") {
      const targetUserId = url?.searchParams?.get?.("userId") ?? "";
      if (!targetUserId) return NextResponse.json({ error: "userId erforderlich" }, { status: 400 });
      if (!(await canSeeUser(ctx, targetUserId))) throw new AccessError(403, "Forbidden");
      userId = targetUserId;
    }

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const profil = buildProfil(membership);
    const heute = new Date();

    const pensumChangesRaw = await prisma.pensumChange.findMany({ where: { userId, orgId }, orderBy: { effectiveFrom: "asc" } });
    const changes = mapChanges(pensumChangesRaw);

    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
    const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

    // Weiterhin gebraucht für die Kundenstunden-Aufschlüsselung (Sheet 2)
    // unten — unabhängig davon, ob ein Kunde billable ist oder nicht.
    const kundenRaw = await prisma.customer.findMany({ where: { orgId } });

    const entries = await prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
      include: { customer: { select: { name: true } }, project: { select: { name: true } } },
    });
    const eintraege = mapEintraege(entries);

    const payoutsRaw = await prisma.overtimePayout.findMany({ where: { userId, orgId, date: { gte: startDate, lte: endDate } } });
    const payouts: PayoutInput[] = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));

    const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, holidays });

    const allPayouts = await prisma.overtimePayout.findMany({ where: { userId, orgId } });
    const totalPaidOutHours = allPayouts.reduce((s, p) => s + p.hours, 0);
    // Überstunden (Art. 321c OR, vertraglich) netto nach Auszahlungen.
    const netOvertime = k.ueberstunden;
    const overtimeGross = Math.round((k.ist - k.soll) * 10) / 10;

    // Stunden je Kunde im Zeitraum (arbeit-Einträge mit customerId), für Sheet 2
    const customerBreakdown = kundenRaw
      .map((kd) => {
        const hours = eintraege
          .filter((e) => e.customerId === kd.id && e.typ === "arbeit")
          .reduce((sum, e) => sum + stundenAusEintrag(e, sollStundenTag(e.date, profil, changes, holidays)), 0);
        return { name: kd.name, billable: kd.billable, hours };
      })
      .filter((c) => c.hours > 0)
      .sort((a, b) => b.hours - a.hours);

    // ---- Feriensaldo für das Anzeigejahr ----
    const displayYear = startDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(displayYear, 0, 1));
    const yearEnd = new Date(Date.UTC(displayYear, 11, 31));
    const yearFerienRaw = await prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, type: "ferien", date: { gte: yearStart, lte: yearEnd } },
    });
    const fs = feriensaldo({ jahr: displayYear, heute, profil, changes, holidays, eintraege: mapEintraege(yearFerienRaw) });

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
    let sheet1TotalHours = 0;
    for (const entry of entries ?? []) {
      const d = new Date(entry.date);
      const tagesSoll = sollStundenTag(d, profil, changes, holidays);
      const stunden = stundenAusEintrag(
        { typ: entry.type as any, von: entry.von, bis: entry.bis, pauseMin: entry.pauseMin, hours: entry.hours },
        tagesSoll
      );
      sheet1TotalHours += stunden;
      // Kunde/Projekt aus der Relation statt dem alten Freitext (MIGRATION.md
      // Punkt 5, Abschluss — die projekt-Spalte ist inzwischen gedroppt;
      // vor dem Drop per SQL verifiziert, dass 0 Zeilen unmigrierten Freitext
      // ohne projectId hatten).
      const kundeProjekt = [entry.customer?.name, entry.project?.name].filter(Boolean).join(" – ") || "";
      const row = ws1.addRow({
        date: fmtDate(d),
        weekday: weekdayNames[d.getDay()] ?? "",
        von: entry.von ?? "",
        bis: entry.bis ?? "",
        hours: Math.round(stunden * 100) / 100,
        type: TYPE_LABELS[entry.type ?? ""] ?? entry.type ?? "",
        projekt: kundeProjekt,
        notiz: entry.notiz ?? "",
      });
      styleDataRow(row, 8);
      const typeCell = row.getCell(6);
      if (entry.type === "ferien") typeCell.font = { color: { argb: "FF2563EB" } };
      else if (entry.type === "feiertag") typeCell.font = { color: { argb: "FF9333EA" } };
      else if (entry.type === "krank" || entry.type === "militaer") typeCell.font = { color: { argb: "FFDC2626" } };
    }

    // Summenzeile
    const sumRow = ws1.addRow({
      date: "",
      weekday: "",
      von: "",
      bis: "Total",
      hours: Math.round(sheet1TotalHours * 100) / 100,
      type: "",
      projekt: "",
      notiz: "",
    });
    for (let i = 1; i <= 8; i++) {
      sumRow.getCell(i).border = { top: { style: "double", color: { argb: "FF1A56DB" } } };
      sumRow.getCell(i).font = { bold: true };
    }
    sumRow.getCell(4).alignment = { horizontal: "right" };

    ws1.views = [{ state: "frozen", ySplit: 1 }];

    // === Sheet 2: Kundenstunden ===
    const ws2 = workbook.addWorksheet("Kundenstunden");
    ws2.columns = [
      { header: "Kunde", key: "customer", width: 28 },
      { header: "Verrechenbar", key: "billable", width: 14 },
      { header: "Stunden", key: "hours", width: 12 },
    ];
    styleHeaderRow(ws2.getRow(1), 3);

    for (const c of customerBreakdown) {
      const row = ws2.addRow({
        customer: c.name,
        billable: c.billable ? "Ja" : "Nein",
        hours: Math.round(c.hours * 100) / 100,
      });
      styleDataRow(row, 3);
    }

    if (customerBreakdown.length === 0) {
      const emptyRow = ws2.addRow({ customer: "Keine Kundenstunden vorhanden", billable: "", hours: "" });
      emptyRow.getCell(1).font = { italic: true, color: { argb: "FF999999" } };
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
        { label: "Überstunden (netto)", value: `${netOvertime >= 0 ? "+" : ""}${netOvertime.toFixed(1)}h`, bold: true, color: netOvertime >= 0 ? "FF16A34A" : "FFDC2626" },
      );
    }

    summaryRows.push(
      { label: "", value: "" },
      // Überzeit (Art. 12/13 ArG, gesetzliches Wochenlimit) — eigener Begriff,
      // unabhängig von Überstunden/Auszahlungen (MIGRATION.md Punkt 6a).
      { label: `Überzeit (> ${profil.maxWeeklyHours}h/Woche)`, value: `${k.ueberzeit.toFixed(1)}h`, bold: true, color: k.ueberzeit > 0 ? "FFDC2626" : "FF16A34A" },
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
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
