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

// Erster Wochentag `weekday` (0=So) im Monat `month0` (0-indexiert) —
// Baustein für nterSonntagImMonat unten.
function ersterWochentagImMonat(year: number, month0: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month0, 1));
  const diff = (weekday - d.getUTCDay() + 7) % 7;
  return addDays(d, diff);
}

// N-ter Sonntag eines Monats (n=1 → erster Sonntag) — Baustein für
// Feiertage, die relativ zu einem Wochentag statt zu Ostern definiert sind
// (GE: Jeûne genevois = Donnerstag nach dem 1. Sonntag im September; VD:
// Bettagsmontag = Montag nach dem 3. Sonntag im September, identisch mit dem
// eidgenössischen Dank-, Buss- und Bettag).
function nterSonntagImMonat(year: number, month0: number, n: number): Date {
  return addDays(ersterWochentagImMonat(year, month0, 0), (n - 1) * 7);
}

// Verschiebt ein fixes Datum auf den folgenden Montag, falls es auf einen
// Sonntag fällt (NE: Instauration de la République, 1. März — 2026 z.B. auf
// einen Sonntag, dort gesetzlich auf Montag, 2. März, beobachtet).
function aufMontagFallsSonntag(date: Date): Date {
  return date.getUTCDay() === 0 ? addDays(date, 1) : date;
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

// Kantonale Feiertage für alle 26 Kantone — recherchiert über mehrere
// unabhängige, gezielte Quellen pro Kanton (nicht nur eine Sammelübersicht),
// aber wie beim ursprünglichen 10-Kantone-Stand "praxistauglich genug", nicht
// juristisch letztgültig geprüft. Zwei Einschränkungen bewusst dokumentiert:
//
// - Berchtoldstag (2. Januar) ist in der Schweiz oft kommunal/betrieblich
//   statt kantonal geregelt ("Usanz" statt Gesetz) — verschiedene Quellen
//   nennen dafür widersprüchliche Kantonslisten. Ergänzt wird er hier nur bei
//   VD und NE (dediziert und übereinstimmend bestätigt); bei allen anderen,
//   nicht bereits vorher schon gelisteten Kantonen bewusst weggelassen statt
//   einer unsicheren Quelle zu folgen.
// - Für Kantone ohne eigenen Zweig (aktuell BL, SH, AR, SG, GR, TG, GL) sind
//   mangels dediziert bestätigter Quelle keine Zusatztage hinterlegt (GR z.B.
//   gezielt gegengeprüft: genau die 8 Basissatz-Tage, keine weiteren) — sie
//   bekommen nur den Basissatz aus generateHolidaysForYear(). Wie bisher
//   "ergänzbar" (Punkt 6c): weitere Kantone/Tage lassen sich jederzeit als
//   zusätzliche Holiday-Zeilen ergänzen, dafür braucht es keine Codeänderung.
export function kantonaleFeiertage(year: number, canton: string): HolidayDef[] {
  const ostern = easterSunday(year);
  const result: HolidayDef[] = [];

  if (["ZH", "BE", "SO", "AG", "VD", "NE"].includes(canton)) {
    result.push({ date: fmt(new Date(Date.UTC(year, 0, 2))), name: "Berchtoldstag", canton, halfDay: false });
  }
  // Katholisch geprägte "Innerschweiz"-Gruppe — historisch gemeinsame
  // Tradition (LU/UR/SZ/OW/NW/ZG plus FR/SO/AI/TI/VS); SO passt ausserdem zur
  // bekannten Kennzahl "12 Feiertage/Jahr", identisch mit VS/LU, was nur mit
  // dieser Gruppenzugehörigkeit erklärbar ist.
  if (["LU", "UR", "SZ", "OW", "NW", "ZG", "SO", "FR", "AI", "TI", "VS"].includes(canton)) {
    result.push({ date: fmt(addDays(ostern, 60)), name: "Fronleichnam", canton, halfDay: false });
    result.push({ date: fmt(new Date(Date.UTC(year, 7, 15))), name: "Mariä Himmelfahrt", canton, halfDay: false });
    result.push({ date: fmt(new Date(Date.UTC(year, 10, 1))), name: "Allerheiligen", canton, halfDay: false });
  }
  if (["LU", "UR", "SZ", "OW", "TI", "VS"].includes(canton)) {
    result.push({ date: fmt(new Date(Date.UTC(year, 11, 8))), name: "Mariä Empfängnis", canton, halfDay: false });
  }
  // Heilige Drei Könige nur für TI dediziert bestätigt (eigene TI-Recherche
  // ergab genau "15 Feiertage total", was nur mit diesem Tag aufgeht) — die
  // breitere LU/UR/AI-Zuordnung stammte nur aus derselben Sammelübersicht,
  // die bei anderen Zeilen (Karfreitag, Stephanstag, Tag der Arbeit)
  // nachweislich falsch pauschalisierte, deshalb hier bewusst nicht
  // übernommen.
  if (canton === "TI") {
    result.push({ date: fmt(new Date(Date.UTC(year, 0, 6))), name: "Heilige Drei Könige", canton, halfDay: false });
  }
  if (["SO", "TI", "VS"].includes(canton)) {
    result.push({ date: fmt(new Date(Date.UTC(year, 2, 19))), name: "Josefstag", canton, halfDay: false });
  }
  if (canton === "TI") {
    result.push({ date: fmt(new Date(Date.UTC(year, 5, 29))), name: "Peter und Paul", canton, halfDay: false });
  }
  // Tag der Arbeit — nur die drei per gezielter Einzelrecherche bestätigten
  // Kantone; andere Kantone (auch SO) kennen den 1. Mai teils nur
  // kommunal/betrieblich, nicht gesetzlich.
  if (["BS", "TI", "NE"].includes(canton)) {
    result.push({ date: fmt(new Date(Date.UTC(year, 4, 1))), name: "Tag der Arbeit", canton, halfDay: false });
  }
  if (canton === "JU") {
    result.push({ date: fmt(new Date(Date.UTC(year, 5, 23))), name: "Kantonsfeiertag Jura", canton, halfDay: false });
  }

  // Genf: eigene Traditionslinie statt Zusatz zum reformierten/katholischen
  // Muster oben — laut direkter Quelle KEIN Berchtoldstag, KEIN 1. Mai und
  // KEIN Stephanstag (letzteres wird über BASIS_AUSNAHMEN in
  // generateHolidaysForYear() unten aus dem Basissatz entfernt, analog zu
  // Karfreitag bei TI/VS — GE/VD/NE waren vor dieser Änderung gar nicht
  // generierbar, es gibt also anders als bei TI/VS kein bestehendes
  // Verhalten, das dadurch rückwirkend brechen könnte).
  if (canton === "GE") {
    result.push({ date: fmt(addDays(nterSonntagImMonat(year, 8, 1), 4)), name: "Jeûne genevois", canton, halfDay: false });
    result.push({ date: fmt(new Date(Date.UTC(year, 11, 31))), name: "Restauration de la République", canton, halfDay: false });
  }
  // Waadt: Bettagsmontag ist laut Quelle der einzige Kanton, der diesen Tag
  // gesetzlich anerkennt (identisch mit dem eidg. Dank-, Buss- und Bettag,
  // der 3. Sonntag im September, plus der folgende Montag).
  if (canton === "VD") {
    result.push({ date: fmt(addDays(nterSonntagImMonat(year, 8, 3), 1)), name: "Bettagsmontag", canton, halfDay: false });
  }
  // Neuenburg: fixer Gründungstag, auf Montag verschoben, falls er auf einen
  // Sonntag fällt (z.B. 2026: 1. März ist ein Sonntag → beobachtet am 2. März).
  if (canton === "NE") {
    result.push({ date: fmt(aufMontagFallsSonntag(new Date(Date.UTC(year, 2, 1)))), name: "Instauration de la République", canton, halfDay: false });
  }
  // Basel-Stadt: Fasnacht ist relativ zu Ostern, aber über den Aschermittwoch
  // (Ostern−46) statt direkt — Fasnachtsmontag ist der Montag danach
  // (Ostern−41), Fasnachtsmittwoch zwei Tage später (Ostern−39). Beide nur
  // halbtags frei, gegengeprüft mit den konkreten 2026-Daten der Quelle
  // (23./25. Februar). Vorabend 1. August ist ein fixer halber Tag.
  if (canton === "BS") {
    result.push({ date: fmt(addDays(ostern, -41)), name: "Fasnachtsmontag", canton, halfDay: true });
    result.push({ date: fmt(addDays(ostern, -39)), name: "Fasnachtsmittwoch", canton, halfDay: true });
    result.push({ date: fmt(new Date(Date.UTC(year, 6, 31))), name: "Vorabend 1. August", canton, halfDay: true });
  }

  return result;
}

export function generateHolidaysForYear(year: number, canton?: string | null): HolidayDef[] {
  // Basissatz-Tage, die trotz kantonsunabhängiger Definition in
  // swissBasisFeiertage() bei einzelnen Kantonen laut dedizierter Quelle
  // NICHT gelten:
  // - Karfreitag bei TI/VS (zwei unabhängige Quellen: "die einzigen
  //   Kantone, wo Karfreitag ein normaler Arbeitstag ist") — TI/VS waren
  //   schon vor dieser Änderung generierbar, betrifft also potenziell schon
  //   bestehende Erwartungen (bewusst abgesprochen, siehe Plan).
  // - Stephanstag bei GE/VD/NE (jeweils dedizierte Quelle mit vollständiger
  //   Feiertagsliste, die Stephanstag nicht enthält) — alle drei sind mit
  //   dieser Änderung neu generierbar, es gibt kein bestehendes Verhalten,
  //   das dadurch bricht.
  const BASIS_AUSNAHMEN: Record<string, string[]> = {
    TI: ["Karfreitag"],
    VS: ["Karfreitag"],
    GE: ["Stephanstag"],
    VD: ["Stephanstag"],
    NE: ["Stephanstag"],
  };
  const ausgeschlossen = canton ? (BASIS_AUSNAHMEN[canton] ?? []) : [];
  const basis = swissBasisFeiertage(year).filter((h) => !ausgeschlossen.includes(h.name));
  if (!canton) return basis;
  return [...basis, ...kantonaleFeiertage(year, canton)];
}
