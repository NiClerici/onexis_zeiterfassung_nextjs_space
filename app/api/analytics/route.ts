export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import {
  kennzahlen,
  feriensaldo,
  tagessollBasis,
  type Profil,
  type PensumChangeInput,
  type EintragMitDatum,
  type PayoutInput,
  type HolidayInput,
} from "@/lib/calc";
import { billableHoursByUserAndMonth, combineCustomerHours, type MonthlyCustomerHours } from "@/lib/customer-months";
import { logError } from "@/lib/error-log";
import { parseDateYMD } from "@/lib/dates";

// Profil.pensum/.wochenstunden sind in lib/calc.ts der Fallback von pensumAt()
// für Daten VOR der ersten PensumChange — also die historische Basis, nicht der
// aktuelle Wert. membership.pensum/weeklyHours werden von /api/pensum-changes
// bei jeder Änderung auf den neuesten Stand überschrieben; die Basis liegt in
// basePensum/baseWeeklyHours. Gleiches Muster wie in bulk-vacation/route.ts.
function buildProfil(membership: any): Profil {
  return {
    pensum: membership?.basePensum ?? membership?.pensum ?? 100,
    wochenstunden: membership?.baseWeeklyHours ?? membership?.weeklyHours ?? 42,
    startDate: membership?.startDate ?? null,
    exitDate: membership?.exitDate ?? null,
    ferientage: membership?.vacationDays ?? 25,
    maxWeeklyHours: membership?.org?.maxWeeklyHours ?? 45,
  };
}

function mapChanges(changes: any[]): PensumChangeInput[] {
  return changes.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
}

// Lokale Kopie von lib/calc.ts toUTCDate() (dort nicht exportiert) — normalisiert
// Date/String auf UTC-Mitternacht, konsistent mit den @db.Date-Grenzen oben.
function toUTCDateLocal(input: Date | string): Date {
  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(input);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function mapEintraege(entries: any[]): EintragMitDatum[] {
  return entries.map((e) => ({
    date: e.date,
    typ: e.type,
    von: e.von,
    bis: e.bis,
    pauseMin: e.pauseMin,
    hours: e.hours,
    countsAsWorktime: e.countsAsWorktime,
  }));
}

export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

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
    } else if (type === "quarter") {
      const quarter = parseInt(url?.searchParams?.get?.("quarter") ?? "1");
      const qStart = (quarter - 1) * 3;
      startDate = new Date(Date.UTC(year, qStart, 1));
      endDate = new Date(Date.UTC(year, qStart + 3, 0));
    } else if (type === "year") {
      startDate = new Date(Date.UTC(year, 0, 1));
      endDate = new Date(Date.UTC(year, 11, 31));
    } else {
      // Vorher fiel ein "custom"-Request ohne (oder mit unparsbarem) from/to
      // stillschweigend auf das ganze Jahr zurück bzw. ergab bei einem
      // kaputten Datumsstring "Invalid Date" und damit NaN-Vergleiche weiter
      // unten — beides ohne jede Fehlermeldung. Jetzt ein harter 400, analog
      // zur Validierung in app/api/time-entries/route.ts.
      const fromStr = url?.searchParams?.get?.("from") ?? "";
      const toStr = url?.searchParams?.get?.("to") ?? "";
      const parsedFrom = parseDateYMD(fromStr);
      const parsedTo = parseDateYMD(toStr);
      if (!parsedFrom || !parsedTo) {
        return NextResponse.json({ error: "Ungültiger oder unvollständiger Zeitraum" }, { status: 400 });
      }
      if (parsedTo.getTime() < parsedFrom.getTime()) {
        return NextResponse.json({ error: "Enddatum liegt vor dem Startdatum" }, { status: 400 });
      }
      startDate = parsedFrom;
      endDate = parsedTo;
    }

    const profil = buildProfil(membership);
    const heute = new Date();

    const pensumChangesRaw = await prisma.pensumChange.findMany({ where: { userId, orgId }, orderBy: { effectiveFrom: "asc" } });
    const changes = mapChanges(pensumChangesRaw);

    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
    const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

    const entriesRaw = await prisma.timeEntry.findMany({ where: { userId, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } } });
    const eintraege = mapEintraege(entriesRaw);

    const payoutsRaw = await prisma.overtimePayout.findMany({ where: { userId, orgId, date: { gte: startDate, lte: endDate } } });
    const payouts: PayoutInput[] = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));

    // Kundenstunden je Kalendermonat im gewählten Zeitraum — einmal geladen,
    // unten fürs Total und für die monatliche Aufschlüsselung (monthlyData)
    // wiederverwendet, statt pro Monat eine eigene Query abzusetzen. Additive
    // Summe aus TimeEntry und CustomerMonth-Migration (lib/customer-months.ts
    // combineCustomerHours()).
    const customerHoursByMonth = (await billableHoursByUserAndMonth({ orgId, userIds: [userId], from: startDate, to: endDate })).get(userId) ?? new Map<string, MonthlyCustomerHours>();
    const kundenstundenTotal = Array.from(customerHoursByMonth.values()).reduce((s, v) => s + combineCustomerHours(v), 0);
    // Anteil von kundenstundenTotal, der aus der CustomerMonth-Migration
    // stammt (statt aus Tageseinträgen) — rein informativ für die
    // Kundenstunden-Karte, ist bereits in kundenstundenTotal enthalten.
    const kundenstundenAusMigration = Array.from(customerHoursByMonth.values()).reduce((s, v) => s + v.fromMigration, 0);

    const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, holidays, kundenstunden: kundenstundenTotal });

    // Feiertagsstunden (bis heute) für die bestehende Feiertags-Karte
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    // Bewusst der AKTUELLE Tarif, nicht die Basis aus profil — diese Karte zeigt
    // Feiertagsstunden zum heute gültigen Pensum.
    const currentDailyRate = tagessollBasis(membership?.weeklyHours ?? 42, membership?.pensum ?? 100);
    const holidayHours = entriesRaw
      .filter((e) => e.type === "feiertag" && new Date(e.date) <= todayEnd)
      .reduce((s, e) => s + (e.hours ?? currentDailyRate), 0);

    // Feriensaldo für das Anzeigejahr (eigener Jahres-Query, unabhängig vom gewählten Zeitraum)
    const displayYear = startDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(displayYear, 0, 1));
    const yearEnd = new Date(Date.UTC(displayYear, 11, 31));
    const yearFerienRaw = await prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, type: "ferien", date: { gte: yearStart, lte: yearEnd } },
    });
    const fs = feriensaldo({ jahr: displayYear, heute, profil, changes, holidays, eintraege: mapEintraege(yearFerienRaw) });

    // Ausbezahlte Überstunden INNERHALB der gewählten Periode — konsistent mit
    // k.ueberstunden (das ebenfalls nur Auszahlungen in [startDate,endDate]
    // abzieht, siehe lib/calc.ts kennzahlen() payoutSum). Vorher wurde hier die
    // Gesamtsumme aller Auszahlungen verwendet, wodurch "overtime − paidOutHours"
    // nicht mehr mit "netOvertime" übereinstimmte, sobald eine Auszahlung
    // ausserhalb des gewählten Zeitraums lag. Die Gesamtsumme lebt jetzt in
    // cumulative.paidOutHours.
    const periodPaidOutHours = payouts.reduce((s, p) => s + p.hours, 0);
    const overtimeGross = Math.round((k.ist - k.soll) * 10) / 10;
    // Netto-Prognose per Periodenende (Ist + Geplant − Soll − Auszahlungen) —
    // k.prognoseSaldo (lib/calc.ts:334) ist die Brutto-Variante, für die
    // Überstunden-Matrix in der UI müssen beide Prognose-Werte aber netto sein,
    // konsistent mit netOvertime/cumulative.netOvertime unten.
    const forecastNetOvertimePeriod = Math.round((k.prognoseSaldo - periodPaidOutHours) * 10) / 10;

    // Kumulierter Überstundensaldo seit Eintritt (unabhängig vom gewählten
    // Zeitraum) — analog zum Feriensaldo-Muster oben, das ebenfalls einen
    // eigenen, vom periodType unabhängigen Query fährt. null, wenn der gewählte
    // Zeitraum die ganze Historie bereits abdeckt (z.B. custom ab Eintritt) —
    // dann wäre der kumulierte Wert identisch mit dem Zeitraum-Wert.
    const saldoStart = toUTCDateLocal(membership?.startDate ?? membership?.entryDate ?? startDate);
    let cumulative: {
      since: string;
      asOf: string;
      targetHours: number;
      actualHours: number;
      overtimeGross: number;
      paidOutHours: number;
      netOvertime: number;
      forecastNetOvertime: number;
    } | null = null;
    if (saldoStart.getTime() < startDate.getTime()) {
      const [cumEntriesRaw, cumPayoutsRaw] = await Promise.all([
        prisma.timeEntry.findMany({ where: { userId, orgId, deletedAt: null, date: { gte: saldoStart, lte: endDate } } }),
        prisma.overtimePayout.findMany({ where: { userId, orgId, date: { gte: saldoStart, lte: endDate } } }),
      ]);
      const cumEintraege = mapEintraege(cumEntriesRaw);
      const cumPayouts: PayoutInput[] = cumPayoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));
      // kundenstunden: 0 — Verrechnungsgrad wird aus diesem Aufruf nicht
      // verwendet, ein zusätzlicher billableHoursByUserAndMonth()-Query über
      // die ganze Historie wäre hier reiner Overhead.
      const kc = kennzahlen({ from: saldoStart, to: endDate, heute, eintraege: cumEintraege, profil, changes, payouts: cumPayouts, holidays, kundenstunden: 0 });
      const cumPaidOutHours = cumPayouts.reduce((s, p) => s + p.hours, 0);
      const asOf = endDate.getTime() < heute.getTime() ? endDate : heute;
      cumulative = {
        since: saldoStart.toISOString().slice(0, 10),
        asOf: asOf.toISOString().slice(0, 10),
        targetHours: kc.soll,
        actualHours: kc.ist,
        overtimeGross: Math.round((kc.ist - kc.soll) * 10) / 10,
        paidOutHours: Math.round(cumPaidOutHours * 10) / 10,
        netOvertime: kc.ueberstunden,
        forecastNetOvertime: Math.round((kc.prognoseSaldo - cumPaidOutHours) * 10) / 10,
      };
    }

    // Monatliche Aufschlüsselung fürs Chart
    const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const monthlyData: Array<{ month: string; target: number; actual: number; work: number; customer: number }> = [];
    const currentMonth = new Date(startDate);
    while (currentMonth <= endDate) {
      const mYear = currentMonth.getUTCFullYear();
      const mMonth = currentMonth.getUTCMonth() + 1;
      const mStart = new Date(Date.UTC(mYear, mMonth - 1, 1));
      const mEndFull = new Date(Date.UTC(mYear, mMonth, 0));
      const mEnd = mEndFull > endDate ? endDate : mEndFull;
      const mk = kennzahlen({
        from: mStart,
        to: mEnd,
        heute,
        eintraege,
        profil,
        changes,
        payouts,
        holidays,
        kundenstunden: combineCustomerHours(customerHoursByMonth.get(`${mYear}-${mMonth}`) ?? { fromEntries: 0, fromMigration: 0 }),
      });
      // Arbeitsstunden (ohne Absenzen) für den Vergleich mit Kundenstunden im
      // Verlaufs-Chart — kennzahlen() liefert das bereits als eigenes Feld
      // (mk.arbeitsstunden), ein zweiter Aufruf mit vorgefilterten Einträgen
      // war redundant.
      monthlyData.push({ month: monthNames[mMonth - 1] ?? "", target: mk.soll, actual: mk.ist, work: mk.arbeitsstunden, customer: mk.kundenstunden });
      currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
    }

    return NextResponse.json({
      targetHours: k.soll,
      actualHours: k.ist,
      customerHours: k.kundenstunden,
      // Anteil von customerHours aus der CustomerMonth-Migration (bereits
      // enthalten, nicht zusätzlich) — rein informativ für die Aufschlüsselung
      // in der Kundenstunden-Karte. 0, wenn der Zeitraum keine Migrationsdaten hat.
      customerHoursFromMigration: Math.round(kundenstundenAusMigration * 10) / 10,
      billingRate: k.verrechnungsgrad,
      // Nenner von billingRate, für die Aufschlüsselung unter der Kachel
      // (Betrieb.md-Nachtrag, 21.08.2026): reine Arbeitszeit, ohne Absenzen.
      workHours: k.arbeitsstunden,
      vacationDays: fs.bezogen,
      holidays: currentDailyRate > 0 ? Math.round((holidayHours / currentDailyRate) * 10) / 10 : 0,
      overtime: overtimeGross,
      paidOutHours: Math.round(periodPaidOutHours * 10) / 10,
      // Überstunden (Art. 321c OR, vertraglich) — netto nach Auszahlungen.
      netOvertime: k.ueberstunden,
      // Netto-Prognose per Periodenende, für die Überstunden-Matrix.
      forecastNetOvertime: forecastNetOvertimePeriod,
      // ISO-Datum des Periodenendes — für die Zeilenbeschriftung "per <Datum>"
      // in der Überstunden-Matrix. Die UI kann das für quarter/year/custom
      // nicht selbst ableiten.
      periodEnd: endDate.toISOString().slice(0, 10),
      // Kumulierter Saldo seit Eintritt, unabhängig vom gewählten Zeitraum —
      // s.o. Berechnung. null, wenn der Zeitraum die Historie bereits abdeckt.
      cumulative,
      // Überzeit (Art. 12/13 ArG, gesetzliches Wochenlimit) — separater Begriff,
      // siehe lib/calc.ts KennzahlenResult.ueberzeit (MIGRATION.md Punkt 6a).
      weeklyOvertime: k.ueberzeit,
      futureHours: k.geplantZukunft,
      fullTargetHours: k.sollGesamt,
      // Feriensaldo (für Anzeigejahr)
      vacationBalance: {
        year: displayYear,
        totalDays: fs.anspruch,
        usedDays: fs.bezogen,
        plannedDays: fs.geplant,
        remainingDays: fs.offen,
      },
      monthlyData,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Analytics error:", error);
    await logError("GET /api/analytics", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
