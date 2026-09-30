// Kumulierter Überstundensaldo seit Eintritt, und dessen Verlauf über die
// Zeit — extrahiert aus app/api/analytics/route.ts (dort ursprünglich die
// einzige Stelle, die einen Saldo unabhängig vom gewählten Zeitraum zeigte).
// Der Team-Hub (app/api/team/route.ts) braucht dieselbe Rechnung jetzt auch
// pro Teammitglied, nicht nur für die eigene Person — deshalb hierher
// ausgelagert statt ein zweites Mal geschrieben. Reine Berechnung, kein
// Prisma-Import (gleiches Prinzip wie lib/calc.ts): die Aufrufer laden
// Einträge/Auszahlungen selbst und reichen sie rein.

import {
  kennzahlen,
  montagDerWoche,
  type Profil,
  type PensumChangeInput,
  type EintragMitDatum,
  type PayoutInput,
  type HolidayInput,
} from "@/lib/calc";

// Lokale Kopie von lib/calc.ts toUTCDate() (dort nicht exportiert) —
// normalisiert Date/String auf UTC-Mitternacht.
function toUTCDate(input: Date | string): Date {
  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(input);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface KumulierterSaldoInput {
  profil: Profil;
  changes: PensumChangeInput[];
  holidays: HolidayInput[];
  heute: Date | string;
  // Beginn der Historie — üblicherweise Eintrittsdatum (Membership.startDate
  // bzw. entryDate).
  since: Date | string;
  to: Date | string;
  // Einträge/Auszahlungen von `since` bis `to`, bereits geladen.
  eintraege: EintragMitDatum[];
  payouts: PayoutInput[];
}

export interface KumulierterSaldoResult {
  since: string;
  asOf: string;
  targetHours: number;
  actualHours: number;
  overtimeGross: number;
  paidOutHours: number;
  netOvertime: number;
  forecastNetOvertime: number;
}

export function kumulierterSaldo(input: KumulierterSaldoInput): KumulierterSaldoResult {
  const since = toUTCDate(input.since);
  const to = toUTCDate(input.to);
  const heute = toUTCDate(input.heute);
  const kc = kennzahlen({
    from: since,
    to,
    heute,
    eintraege: input.eintraege,
    profil: input.profil,
    changes: input.changes,
    payouts: input.payouts,
    holidays: input.holidays,
    kundenstunden: 0,
  });
  const paidOutHours = input.payouts.reduce((s, p) => s + p.hours, 0);
  const asOf = to.getTime() < heute.getTime() ? to : heute;
  return {
    since: since.toISOString().slice(0, 10),
    asOf: asOf.toISOString().slice(0, 10),
    targetHours: kc.soll,
    actualHours: kc.ist,
    overtimeGross: round1(kc.ist - kc.soll),
    paidOutHours: round1(paidOutHours),
    netOvertime: kc.ueberstunden,
    forecastNetOvertime: round1(kc.prognoseSaldo - paidOutHours),
  };
}

export interface SaldoSeriePunkt {
  date: string;
  balance: number;
  delta: number;
}

export interface SaldoSerieInput {
  profil: Profil;
  changes: PensumChangeInput[];
  holidays: HolidayInput[];
  heute: Date | string;
  // Anfang, ab dem der Saldo mitgerechnet wird (Eintritt, sofern das vor dem
  // gewählten Zeitraum liegt — sonst identisch mit periodStart).
  seriesStart: Date | string;
  // Beginn des gewählten Zeitraums — ab hier entstehen die Balken/Punkte,
  // seriesStart..periodStart-1 liefert nur den Startwert.
  periodStart: Date | string;
  // Ende des gewählten Zeitraums (für den letzten Punkt, auch wenn er in der
  // Zukunft liegt — Auszahlungen später im Zeitraum zählen dann noch mit).
  endDate: Date | string;
  // Letzter tatsächlich zu zeichnender Tag — min(endDate, heute).
  seriesLast: Date | string;
  // true, wenn seriesStart vor periodStart liegt (es also echte Historie
  // vor dem gewählten Zeitraum gibt).
  hasHistory: boolean;
  granularity: "day" | "week" | "month";
  eintraege: EintragMitDatum[];
  payouts: PayoutInput[];
}

const DAY_MS = 86400000;

// Verlauf des Überstundensaldos über [periodStart, seriesLast], mit einem
// zusätzlichen Startpunkt am Vortag von periodStart. balance ist der
// Nettosaldo seit seriesStart per Bucket-Ende, jeweils über kennzahlen() neu
// über die ganze Strecke gerechnet statt Deltas aufzusummieren — der letzte
// Punkt entspricht dadurch exakt kumulierterSaldo().netOvertime.
export function saldoSerie(input: SaldoSerieInput): SaldoSeriePunkt[] {
  const heute = toUTCDate(input.heute);
  const periodStart = toUTCDate(input.periodStart);
  const endDate = toUTCDate(input.endDate);
  const seriesStart = toUTCDate(input.seriesStart);
  const seriesLast = toUTCDate(input.seriesLast);

  const result: SaldoSeriePunkt[] = [];
  if (seriesLast.getTime() < periodStart.getTime()) return result;

  const balanceAt = (to: Date) =>
    kennzahlen({
      from: seriesStart,
      to,
      heute,
      eintraege: input.eintraege,
      profil: input.profil,
      changes: input.changes,
      payouts: input.payouts,
      holidays: input.holidays,
      kundenstunden: 0,
    }).ueberstunden;

  const dayBefore = new Date(periodStart.getTime() - DAY_MS);
  let prev = input.hasHistory ? balanceAt(dayBefore) : 0;
  result.push({ date: dayBefore.toISOString().slice(0, 10), balance: prev, delta: 0 });

  let cursor = new Date(periodStart);
  while (cursor.getTime() <= seriesLast.getTime()) {
    let bucketEnd: Date;
    if (input.granularity === "day") bucketEnd = new Date(cursor);
    else if (input.granularity === "week") bucketEnd = new Date(montagDerWoche(cursor).getTime() + 6 * DAY_MS);
    else bucketEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const isLast = bucketEnd.getTime() >= seriesLast.getTime();
    if (isLast) bucketEnd = seriesLast;
    const balance = balanceAt(isLast ? endDate : bucketEnd);
    result.push({ date: bucketEnd.toISOString().slice(0, 10), balance, delta: round1(balance - prev) });
    prev = balance;
    cursor = new Date(bucketEnd.getTime() + DAY_MS);
  }
  return result;
}
