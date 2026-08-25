export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, canSeeUser, AccessError } from "@/lib/access";
import ExcelJS from "exceljs";
import {
  stundenAusEintrag,
  wochenUebersicht,
  montagDerWoche,
  type Profil,
  type EintragMitDatum,
  type HolidayInput,
} from "@/lib/calc";
import { pruefeCompliance } from "@/lib/compliance";
import { buildProfil, mapChanges, mapEintraege, parseExportRange, styleHeaderRow, styleDataRow } from "@/lib/export-helpers";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function dateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().split("T")[0];
}

// Prüffähige Tabelle nach Art. 73 ArGV 1 für EINE Person, ein Sheet pro
// Person (auch bei scope=org). Läuft Tag für Tag durch [startDate, endDate]
// statt nur über vorhandene Einträge — Ruhetage müssen als solche sichtbar
// sein, nicht als fehlende Zeilen.
//
// Dokumentierte Vereinfachung (wie schon bei den Praxis-Richtwerten in
// 6c/6d): das Schema speichert nur die PAUSENDAUER (pauseMin), nicht ihre
// Lage (Beginn/Ende der Pause) — Art. 73 verlangt "Dauer und Lage" der
// Pausen. Ohne ein eigenes Pausen-Zeitfeld im Schema kann nur die Dauer
// ausgewiesen werden; das ist hier bewusst so belassen (kein Scope dieses
// Punktes, Schemaänderung wäre ein eigener Punkt) und nicht verschwiegen —
// die Spaltenüberschrift heisst deshalb "Pause (Min)", nicht "Pause (Lage)".
function addKontrollSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  startDate: Date,
  endDate: Date,
  eintraege: EintragMitDatum[],
  profil: Profil
) {
  const ws = workbook.addWorksheet(sheetName.slice(0, 31)); // Excel-Limit: max. 31 Zeichen je Sheetname
  ws.columns = [
    { header: "Datum", key: "date", width: 12 },
    { header: "Wochentag", key: "weekday", width: 12 },
    { header: "Beginn", key: "beginn", width: 10 },
    { header: "Ende", key: "ende", width: 10 },
    { header: "Pause (Min)", key: "pause", width: 12 },
    { header: "Tagesarbeitszeit (h)", key: "tagesarbeit", width: 18 },
    { header: "Wochenarbeitszeit (h)", key: "wochenarbeit", width: 18 },
    { header: "Überzeit (h)", key: "ueberzeit", width: 12 },
    { header: "Ruhetag", key: "ruhetag", width: 10 },
    { header: "Nachtarbeit", key: "nacht", width: 12 },
    { header: "Sonntagsarbeit", key: "sonntag", width: 14 },
  ];
  styleHeaderRow(ws.getRow(1), 11);

  const byDay = new Map<string, EintragMitDatum[]>();
  for (const e of eintraege) {
    const key = dateKey(e.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(e);
  }

  const wochen = wochenUebersicht(eintraege, profil, startDate, endDate);
  const wochenMap = new Map(wochen.map((w) => [w.montag, w]));

  const current = new Date(startDate);
  while (current.getTime() <= endDate.getTime()) {
    const key = dateKey(current);
    const dayEntries = byDay.get(key) ?? [];
    const vortagKey = dateKey(new Date(current.getTime() - 24 * 60 * 60 * 1000));
    const vortagEntries = byDay.get(vortagKey) ?? [];

    const arbeitEntries = dayEntries.filter((e) => e.typ === "arbeit" && e.von && e.bis);
    let beginn = "";
    let ende = "";
    let pauseMin = 0;
    let tagesarbeit = 0;
    if (arbeitEntries.length > 0) {
      beginn = arbeitEntries.reduce((min, e) => (e.von! < min ? e.von! : min), arbeitEntries[0].von!);
      ende = arbeitEntries.reduce((max, e) => (e.bis! > max ? e.bis! : max), arbeitEntries[0].bis!);
      pauseMin = arbeitEntries.reduce((s, e) => s + (e.pauseMin ?? 0), 0);
      tagesarbeit = arbeitEntries.reduce((s, e) => s + stundenAusEintrag(e, 0), 0);
    }

    const montagKey = dateKey(montagDerWoche(current));
    const woche = wochenMap.get(montagKey);

    const violations = pruefeCompliance(dayEntries, vortagEntries);
    const nachtarbeit = violations.some((v) => v.type === "nachtarbeit");
    const sonntagsarbeit = violations.some((v) => v.type === "sonntagsarbeit");

    const row = ws.addRow({
      date: dateKeyToDisplay(key),
      weekday: WEEKDAY_NAMES[current.getUTCDay()],
      beginn,
      ende,
      pause: arbeitEntries.length > 0 ? pauseMin : "",
      tagesarbeit: arbeitEntries.length > 0 ? Math.round(tagesarbeit * 100) / 100 : "",
      wochenarbeit: woche ? woche.arbeitsstunden : "",
      ueberzeit: woche ? woche.ueberzeit : "",
      ruhetag: arbeitEntries.length === 0 ? "Ja" : "Nein",
      nacht: nachtarbeit ? "Ja" : "Nein",
      sonntag: sonntagsarbeit ? "Ja" : "Nein",
    });
    styleDataRow(row, 11);
    if (nachtarbeit || sonntagsarbeit) row.getCell(10).font = row.getCell(11).font = { color: { argb: "FFDC2626" } };
    if (woche && woche.ueberzeit > 0) row.getCell(8).font = { color: { argb: "FFDC2626" }, bold: true };

    current.setUTCDate(current.getUTCDate() + 1);
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function dateKeyToDisplay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

async function loadPersonData(orgId: string, userId: string, startDate: Date, endDate: Date) {
  const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true, user: { select: { firstName: true, lastName: true } } } });
  if (!membership) return null;

  const profil = buildProfil(membership);
  const pensumChangesRaw = await prisma.pensumChange.findMany({ where: { userId, orgId }, orderBy: { effectiveFrom: "asc" } });
  const changes = mapChanges(pensumChangesRaw);
  const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
  const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

  // Ein Tag VOR startDate mitladen, damit die Ruhezeitprüfung (in
  // pruefeCompliance, hier nur für Nacht-/Sonntagsarbeit gebraucht) auch für
  // den allerersten Tag des Exports einen Vortag kennt — anders als im
  // Kalender (der nur den sichtbaren Monat lädt) kontrollieren wir hier
  // exakt den angefragten Zeitraum und können die eine zusätzliche Zeile
  // einfach mitladen.
  const rangeStart = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
  const entries = await prisma.timeEntry.findMany({
    where: { userId, orgId, deletedAt: null, date: { gte: rangeStart, lte: endDate } },
    orderBy: { date: "asc" },
  });
  const eintraege = mapEintraege(entries);

  return { profil, changes, holidays, eintraege, name: `${membership.user.firstName} ${membership.user.lastName}` };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId } = ctx;

    const url = new URL(req.url);
    const { startDate, endDate } = parseExportRange(url);
    const scope = url?.searchParams?.get?.("scope") ?? "self";

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ONEXIS Zeiterfassung";
    let filename = "arg_kontrollexport.xlsx";

    if (scope === "org") {
      requireRole(ctx.role, ["owner", "admin"]);
      const memberships = await prisma.membership.findMany({
        where: { orgId, status: "aktiv" },
        select: { userId: true },
        orderBy: [{ user: { lastName: "asc" } }],
      });
      for (const m of memberships) {
        const data = await loadPersonData(orgId, m.userId, startDate, endDate);
        if (!data) continue;
        addKontrollSheet(workbook, data.name, startDate, endDate, data.eintraege, data.profil);
      }
      filename = "arg_kontrollexport_organisation.xlsx";
    } else {
      let userId = ctx.userId;
      if (scope === "person") {
        const targetUserId = url?.searchParams?.get?.("userId") ?? "";
        if (!targetUserId) return NextResponse.json({ error: "userId erforderlich" }, { status: 400 });
        if (!(await canSeeUser(ctx, targetUserId))) throw new AccessError(403, "Forbidden");
        userId = targetUserId;
      }
      const data = await loadPersonData(orgId, userId, startDate, endDate);
      if (!data) return NextResponse.json({ error: "Membership not found" }, { status: 404 });
      addKontrollSheet(workbook, data.name, startDate, endDate, data.eintraege, data.profil);
      filename = `arg_kontrollexport_${data.name.replace(/\s+/g, "_")}.xlsx`;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("ArG-Kontrollexport error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
