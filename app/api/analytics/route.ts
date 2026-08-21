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
      const fromStr = url?.searchParams?.get?.("from") ?? "";
      const toStr = url?.searchParams?.get?.("to") ?? "";
      startDate = fromStr ? new Date(fromStr) : new Date(Date.UTC(year, 0, 1));
      endDate = toStr ? new Date(toStr) : new Date(Date.UTC(year, 11, 31));
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

    // Ausbezahlte Überstunden: kumulierte Gesamtsumme (informativ), unabhängig vom Zeitraum
    const allPayouts = await prisma.overtimePayout.findMany({ where: { userId, orgId } });
    const totalPaidOutHours = allPayouts.reduce((s, p) => s + p.hours, 0);
    const overtimeGross = Math.round((k.ist - k.soll) * 10) / 10;

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
      paidOutHours: Math.round(totalPaidOutHours * 10) / 10,
      // Überstunden (Art. 321c OR, vertraglich) — netto nach Auszahlungen.
      netOvertime: k.ueberstunden,
      // Überzeit (Art. 12/13 ArG, gesetzliches Wochenlimit) — separater Begriff,
      // siehe lib/calc.ts KennzahlenResult.ueberzeit (MIGRATION.md Punkt 6a).
      weeklyOvertime: k.ueberzeit,
      // Forecast fields (für Prognose-Info-Box)
      futureHours: k.geplantZukunft,
      fullTargetHours: k.sollGesamt,
      forecastOvertime: k.prognoseSaldo,
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
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
