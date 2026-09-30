// Gemeinsamer Zeitraum-Zustand für den Team-Hub (app/(app)/team/page.tsx).
// Vorher hatte jede Seite (Teamsicht, Analytics, Absenzen) einen eigenen
// Picker mit unterschiedlichen Optionen (Monat/Jahr/Custom vs. Monat/
// Quartal/Jahr/Custom vs. Monat/Jahr) — hier eine einzige Definition mit
// Woche/Monat/Quartal/Jahr/Custom, die der Team-Hub für alle seine Tabs
// verwendet. Reine Berechnung, kein Prisma-Import (gleiches Prinzip wie
// lib/calc.ts).
//
// Das Backend (app/api/team/route.ts, lib/export-helpers.ts parseExportRange)
// kennt weiterhin nur type=month|year|custom — Woche und Quartal werden hier
// in periodQuery() in ein konkretes [from,to]-Intervall aufgelöst, bevor sie
// als type=custom an die API gehen. Das hält die Backend-Zeitraumlogik
// unverändert, die an mehreren Stellen (Export-Routen) geteilt wird.

import { montagDerWoche } from "@/lib/calc";

export type PeriodType = "week" | "month" | "quarter" | "year" | "custom";

export interface PeriodValue {
  type: PeriodType;
  // Montag der Woche, "YYYY-MM-DD".
  week: string;
  // "YYYY-MM".
  month: string;
  // Jahr des Quartals (kann vom Jahr des Kalenderjahrs-Pickers abweichen,
  // wird aber im Normalfall synchron gehalten).
  quarterYear: number;
  // 1-4.
  quarter: number;
  year: number;
  // "YYYY-MM-DD", nur bei type="custom" verwendet.
  from: string;
  to: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function defaultPeriod(now: Date = new Date()): PeriodValue {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = montagDerWoche(today);
  const quarter = Math.floor(today.getUTCMonth() / 3) + 1;
  return {
    type: "month",
    week: isoDate(monday),
    month: `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}`,
    quarterYear: today.getUTCFullYear(),
    quarter,
    year: today.getUTCFullYear(),
    from: isoDate(today),
    to: isoDate(today),
  };
}

// UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags verglichen
// (siehe lib/calc.ts toUTCDate-Kommentar) — dieselbe Konvention hier.
export function periodRange(p: PeriodValue): { startDate: Date; endDate: Date } {
  if (p.type === "week") {
    const start = new Date(`${p.week}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 6 * 86400000);
    return { startDate: start, endDate: end };
  }
  if (p.type === "month") {
    const [y, m] = p.month.split("-").map(Number);
    return { startDate: new Date(Date.UTC(y, m - 1, 1)), endDate: new Date(Date.UTC(y, m, 0)) };
  }
  if (p.type === "quarter") {
    const qStart = (p.quarter - 1) * 3;
    return { startDate: new Date(Date.UTC(p.quarterYear, qStart, 1)), endDate: new Date(Date.UTC(p.quarterYear, qStart + 3, 0)) };
  }
  if (p.type === "year") {
    return { startDate: new Date(Date.UTC(p.year, 0, 1)), endDate: new Date(Date.UTC(p.year, 11, 31)) };
  }
  return { startDate: new Date(`${p.from}T00:00:00.000Z`), endDate: new Date(`${p.to}T00:00:00.000Z`) };
}

// Query-String für /api/team, /api/export & Co — diese kennen nur
// type=month|year|custom, Woche/Quartal werden deshalb als aufgelöstes
// [from,to] übergeben.
export function periodQuery(p: PeriodValue): string {
  if (p.type === "month") {
    const [y, m] = p.month.split("-");
    return `type=month&year=${y}&month=${m}`;
  }
  if (p.type === "year") {
    return `type=year&year=${p.year}`;
  }
  const { startDate, endDate } = periodRange(p);
  return `type=custom&from=${isoDate(startDate)}&to=${isoDate(endDate)}`;
}

// ‹ › Navigation im Hub-Kopf — verschiebt den Zeitraum um eine Einheit.
// "custom" hat keinen festen Rhythmus und bleibt deshalb unverändert.
export function shiftPeriod(p: PeriodValue, dir: 1 | -1): PeriodValue {
  if (p.type === "week") {
    const d = new Date(`${p.week}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + dir * 7);
    return { ...p, week: isoDate(d) };
  }
  if (p.type === "month") {
    const [y, m] = p.month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return { ...p, month: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` };
  }
  if (p.type === "quarter") {
    let q = p.quarter + dir;
    let y = p.quarterYear;
    if (q < 1) { q = 4; y -= 1; }
    if (q > 4) { q = 1; y += 1; }
    return { ...p, quarter: q, quarterYear: y };
  }
  if (p.type === "year") {
    return { ...p, year: p.year + dir };
  }
  return p;
}
