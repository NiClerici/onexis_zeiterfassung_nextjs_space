// Berechnung Schweizer Feiertage — kein Prisma, kein DB-Zugriff (gleiches
// Trennungsprinzip wie lib/calc.ts). Dient als Generator für Holiday-Zeilen,
// die dann als Seed in die DB geschrieben werden (MIGRATION.md Punkt 6c).

export interface HolidayDef {
  date: string; // YYYY-MM-DD
  name: string;
  canton: string | null; // null = Basissatz, kantonsunabhängig
  halfDay: boolean;
}

// Gauss'sche Osterformel (Meeus/Jones/Butcher-Algorithmus) — liefert
// Ostersonntag als UTC-Datum. Karfreitag, Ostermontag, Auffahrt,
// Pfingstmontag und Fronleichnam sind alle relativ dazu definiert.
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Schweizer Basissatz — acht Tage, die in der überwiegenden Mehrheit der
// Kantone arbeitsfrei sind. Vereinfachung, bewusst dokumentiert: nur der
// 1. August ist bundesrechtlich fix (Art. 110 Abs. 3 BV), die übrigen sind
// formal kantonal geregelt, aber praktisch nahezu überall gleich — als
// kantonsunabhängiger Basissatz (canton: null) hier praxistauglich genug.
export function swissBasisFeiertage(year: number): HolidayDef[] {
  const ostern = easterSunday(year);
  return [
    { date: fmt(new Date(Date.UTC(year, 0, 1))), name: "Neujahr", canton: null, halfDay: false },
    { date: fmt(addDays(ostern, -2)), name: "Karfreitag", canton: null, halfDay: false },
    { date: fmt(addDays(ostern, 1)), name: "Ostermontag", canton: null, halfDay: false },
    { date: fmt(addDays(ostern, 39)), name: "Auffahrt", canton: null, halfDay: false },
    { date: fmt(addDays(ostern, 50)), name: "Pfingstmontag", canton: null, halfDay: false },
    { date: fmt(new Date(Date.UTC(year, 7, 1))), name: "Bundesfeier", canton: null, halfDay: false },
    { date: fmt(new Date(Date.UTC(year, 11, 25))), name: "Weihnachten", canton: null, halfDay: false },
    { date: fmt(new Date(Date.UTC(year, 11, 26))), name: "Stephanstag", canton: null, halfDay: false },
  ];
}

// Kantonale Feiertage — bewusst keine Vollabdeckung aller 26 Kantone (das
// wäre ein eigener, deutlich grösserer Punkt); eine repräsentative Auswahl,
// die das canton-Feld und die Auswahl-/Ergänzungslogik real nutzbar macht.
// Weitere Kantone/Feiertage lassen sich jederzeit als zusätzliche
// Holiday-Zeilen ergänzen ("ergänzbar", Punkt 6c) — dafür braucht es keine
// Codeänderung hier.
export function kantonaleFeiertage(year: number, canton: string): HolidayDef[] {
  const ostern = easterSunday(year);
  const result: HolidayDef[] = [];
  if (["ZH", "BE", "SO", "AG"].includes(canton)) {
    result.push({ date: fmt(new Date(Date.UTC(year, 0, 2))), name: "Berchtoldstag", canton, halfDay: false });
  }
  if (["LU", "UR", "SZ", "TI", "VS"].includes(canton)) {
    result.push({ date: fmt(addDays(ostern, 60)), name: "Fronleichnam", canton, halfDay: false });
    result.push({ date: fmt(new Date(Date.UTC(year, 7, 15))), name: "Mariä Himmelfahrt", canton, halfDay: false });
    result.push({ date: fmt(new Date(Date.UTC(year, 10, 1))), name: "Allerheiligen", canton, halfDay: false });
  }
  if (canton === "JU") {
    result.push({ date: fmt(new Date(Date.UTC(year, 5, 23))), name: "Kantonsfeiertag Jura", canton, halfDay: false });
  }
  return result;
}

export function generateHolidaysForYear(year: number, canton?: string | null): HolidayDef[] {
  const basis = swissBasisFeiertage(year);
  if (!canton) return basis;
  return [...basis, ...kantonaleFeiertage(year, canton)];
}
