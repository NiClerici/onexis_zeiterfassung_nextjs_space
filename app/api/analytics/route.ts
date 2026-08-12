export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import {
  kennzahlen,
  feriensaldo,
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

    const profil = buildProfil(user);
    const heute = new Date();

    const pensumChangesRaw = await prisma.pensumChange.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } });
    const changes = mapChanges(pensumChangesRaw);

    const kundenRaw = await prisma.customer.findMany({ where: { userId } });
    const kunden: KundeInput[] = kundenRaw.map((k) => ({ id: k.id, billable: k.billable }));

    const entriesRaw = await prisma.timeEntry.findMany({ where: { userId, date: { gte: startDate, lte: endDate } } });
    const eintraege = mapEintraege(entriesRaw);

    const payoutsRaw = await prisma.overtimePayout.findMany({ where: { userId, date: { gte: startDate, lte: endDate } } });
    const payouts: PayoutInput[] = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));

    const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, kunden });

    // Feiertagsstunden (bis heute) für die bestehende Feiertags-Karte
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const currentDailyRate = (profil.wochenstunden * profil.pensum) / 100 / 5;
    const holidayHours = entriesRaw
      .filter((e) => e.type === "feiertag" && new Date(e.date) <= todayEnd)
      .reduce((s, e) => s + (e.hours ?? currentDailyRate), 0);

    // Feriensaldo für das Anzeigejahr (eigener Jahres-Query, unabhängig vom gewählten Zeitraum)
    const displayYear = startDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(displayYear, 0, 1));
    const yearEnd = new Date(Date.UTC(displayYear, 11, 31));
    const yearFerienRaw = await prisma.timeEntry.findMany({
      where: { userId, type: "ferien", date: { gte: yearStart, lte: yearEnd } },
    });
    const fs = feriensaldo({ jahr: displayYear, heute, profil, eintraege: mapEintraege(yearFerienRaw) });

    // Ausbezahlte Überstunden: kumulierte Gesamtsumme (informativ), unabhängig vom Zeitraum
    const allPayouts = await prisma.overtimePayout.findMany({ where: { userId } });
    const totalPaidOutHours = allPayouts.reduce((s, p) => s + p.hours, 0);
    const overtimeGross = Math.round((k.ist - k.soll) * 10) / 10;

    // Monatliche Aufschlüsselung fürs Chart
    const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const arbeitEintraege = eintraege.filter((e) => e.typ === "arbeit");
    const monthlyData: Array<{ month: string; target: number; actual: number; work: number; customer: number }> = [];
    const currentMonth = new Date(startDate);
    while (currentMonth <= endDate) {
      const mYear = currentMonth.getUTCFullYear();
      const mMonth = currentMonth.getUTCMonth() + 1;
      const mStart = new Date(Date.UTC(mYear, mMonth - 1, 1));
      const mEndFull = new Date(Date.UTC(mYear, mMonth, 0));
      const mEnd = mEndFull > endDate ? endDate : mEndFull;
      const mk = kennzahlen({ from: mStart, to: mEnd, heute, eintraege, profil, changes, payouts, kunden });
      // Arbeitsstunden (ohne Absenzen) für den Vergleich mit Kundenstunden im Verlaufs-Chart
      const mkWork = kennzahlen({ from: mStart, to: mEnd, heute, eintraege: arbeitEintraege, profil, changes, payouts: [], kunden });
      monthlyData.push({ month: monthNames[mMonth - 1] ?? "", target: mk.soll, actual: mk.ist, work: mkWork.ist, customer: mk.kundenstunden });
      currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
    }

    return NextResponse.json({
      targetHours: k.soll,
      actualHours: k.ist,
      customerHours: k.kundenstunden,
      billingRate: k.verrechnungsgrad,
      vacationDays: fs.bezogen,
      holidays: currentDailyRate > 0 ? Math.round((holidayHours / currentDailyRate) * 10) / 10 : 0,
      overtime: overtimeGross,
      paidOutHours: Math.round(totalPaidOutHours * 10) / 10,
      netOvertime: k.ueberzeit,
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
    console.error("Analytics error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
