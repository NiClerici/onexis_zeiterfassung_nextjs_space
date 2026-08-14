// Reine Prüfung von Pausen-/Ruhezeit-/Höchstarbeitszeit-Vorgaben nach ArG
// (Arbeitsgesetz) — kein Prisma, kein DB-Zugriff, gleiches Trennungsprinzip
// wie lib/calc.ts. Liefert nur Warnungen (nicht-blockierend, MIGRATION.md
// Punkt 6d) — nichts hier verhindert das Speichern eines Eintrags.

import type { EintragMitDatum } from "./calc";

export type ComplianceViolationType =
  | "pause_zu_kurz"
  | "tagesarbeitszeit_ueberschritten"
  | "ruhezeit_zu_kurz"
  | "sonntagsarbeit"
  | "nachtarbeit";

export interface ComplianceViolation {
  type: ComplianceViolationType;
  message: string;
}

// Praxis-Richtwert (SECO-Wegleitung zu Art. 9/12 ArG): die tägliche
// Höchstarbeitszeit inkl. Überzeit soll 12.5h nicht übersteigen. Das Gesetz
// selbst kennt primär eine WÖCHENTLICHE Höchstarbeitszeit (Profil.maxWeeklyHours,
// siehe Punkt 6a) — dieser Tageswert ist eine dokumentierte Vereinfachung,
// kein hartkodierter Gesetzestext, analog zu den anderen bewusst vereinfachten
// Rechtsannahmen dieses Punktes (Basissatz Feiertage in 6c etc.).
const MAX_TAGESARBEITSZEIT_STUNDEN = 12.5;

// Nachtarbeit per Art. 16/17 ArG: 23:00–06:00.
const NACHT_START_MIN = 23 * 60;
const NACHT_ENDE_MIN = 6 * 60;

function parseZeitInMinuten(zeit: string): number {
  const [h, m] = zeit.split(":").map(Number);
  return h * 60 + m;
}

function toUTCDate(input: Date | string): Date {
  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(input);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

// Absoluter Zeitpunkt (Datum + Uhrzeit) für den Start/das Ende eines
// Arbeitseintrags. Ein Ende, das zeitlich vor dem Start liegt, bedeutet eine
// Schicht über Mitternacht — dieselbe Konvention wie stundenAusEintrag in
// lib/calc.ts (bisMin < vonMin → +24h).
function eintragStartEnde(entry: EintragMitDatum): { start: Date; ende: Date } | null {
  if (entry.typ !== "arbeit" || !entry.von || !entry.bis) return null;
  const tag = toUTCDate(entry.date);
  const vonMin = parseZeitInMinuten(entry.von);
  let bisMin = parseZeitInMinuten(entry.bis);
  const start = new Date(tag.getTime() + vonMin * 60 * 1000);
  if (bisMin <= vonMin) bisMin += 24 * 60;
  const ende = new Date(tag.getTime() + bisMin * 60 * 1000);
  return { start, ende };
}

// Netto-Arbeitszeit (von–bis abzüglich Pause) — dieselbe Formel wie
// stundenAusEintrag in lib/calc.ts. Für Pausen-/Höchstgrenzen-Prüfung ist die
// NETTO-Zeit massgeblich, nicht die blosse Anwesenheitsspanne (die braucht
// eintragStartEnde() weiter unten für die Ruhezeit-/Nachtarbeitsprüfung).
function nettoArbeitsstunden(entry: EintragMitDatum): number {
  if (entry.typ !== "arbeit" || !entry.von || !entry.bis) return 0;
  const vonMin = parseZeitInMinuten(entry.von);
  let bisMin = parseZeitInMinuten(entry.bis);
  if (bisMin <= vonMin) bisMin += 24 * 60;
  const pause = entry.pauseMin ?? 0;
  return (bisMin - vonMin - pause) / 60;
}

function arbeitsstundenDesTages(eintraege: EintragMitDatum[]): number {
  return eintraege.reduce((sum, e) => sum + nettoArbeitsstunden(e), 0);
}

function pauseMinutenDesTages(eintraege: EintragMitDatum[]): number {
  return eintraege
    .filter((e) => e.typ === "arbeit" && e.von && e.bis)
    .reduce((sum, e) => sum + (e.pauseMin ?? 0), 0);
}

// Prüft, ob ein [start,ende)-Intervall (in Minuten seit Mitternacht, ende
// kann > 1440 sein bei Nachtschicht) die Nachtzeitspanne 23:00–06:00 berührt.
function ueberschneidetNachtzeit(vonMin: number, bisMin: number): boolean {
  // Zwei Nachtfenster im 0..(bisMin)-Bereich betrachten: [23:00, 24:00) und
  // [24:00+0:00, 24:00+6:00) — deckt auch Schichten ab, die über Mitternacht
  // hinausgehen (bisMin > 1440).
  const fenster: Array<[number, number]> = [
    [NACHT_START_MIN, 24 * 60],
    [24 * 60, 24 * 60 + NACHT_ENDE_MIN],
  ];
  return fenster.some(([fensterVon, fensterBis]) => vonMin < fensterBis && bisMin > fensterVon);
}

// pruefeCompliance(eintraege eines Tages, vortag) — MIGRATION.md Punkt 6d.
// Beide Parameter sind die (rohen) Einträge genau je eines Kalendertags;
// eintraegeVortag wird nur für die Ruhezeitprüfung zum Vortag gebraucht.
export function pruefeCompliance(
  eintraegeEinesTages: EintragMitDatum[],
  eintraegeVortag: EintragMitDatum[]
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (eintraegeEinesTages.length === 0) return violations;

  const arbeitsstunden = arbeitsstundenDesTages(eintraegeEinesTages);
  const pauseMin = pauseMinutenDesTages(eintraegeEinesTages);

  // Pausenregel Art. 15 ArG: der höchste erreichte Schwellenwert bestimmt die
  // Mindestpause, nicht eine Summe aus allen Stufen.
  let erforderlichePauseMin = 0;
  if (arbeitsstunden > 9) erforderlichePauseMin = 60;
  else if (arbeitsstunden > 7) erforderlichePauseMin = 30;
  else if (arbeitsstunden > 5.5) erforderlichePauseMin = 15;

  if (erforderlichePauseMin > 0 && pauseMin < erforderlichePauseMin) {
    violations.push({
      type: "pause_zu_kurz",
      message: `Bei ${arbeitsstunden.toFixed(1)}h Arbeitszeit sind mindestens ${erforderlichePauseMin} Min. Pause vorgeschrieben (erfasst: ${pauseMin} Min.).`,
    });
  }

  if (arbeitsstunden > MAX_TAGESARBEITSZEIT_STUNDEN) {
    violations.push({
      type: "tagesarbeitszeit_ueberschritten",
      message: `Tagesarbeitszeit von ${arbeitsstunden.toFixed(1)}h überschreitet die Höchstgrenze von ${MAX_TAGESARBEITSZEIT_STUNDEN}h.`,
    });
  }

  // Ruhezeit zum Vortag (Art. 15a ArG, mind. 11h) — nur prüfbar, wenn an
  // beiden Tagen tatsächlich Arbeitseinträge mit von/bis vorliegen.
  const heutigeStarts = eintraegeEinesTages.map(eintragStartEnde).filter((x): x is { start: Date; ende: Date } => x !== null);
  const gestrigeEnden = eintraegeVortag.map(eintragStartEnde).filter((x): x is { start: Date; ende: Date } => x !== null);
  if (heutigeStarts.length > 0 && gestrigeEnden.length > 0) {
    const fruehesterStartHeute = new Date(Math.min(...heutigeStarts.map((x) => x.start.getTime())));
    const spaetestesEndeGestern = new Date(Math.max(...gestrigeEnden.map((x) => x.ende.getTime())));
    const ruhezeitStunden = (fruehesterStartHeute.getTime() - spaetestesEndeGestern.getTime()) / (1000 * 60 * 60);
    if (ruhezeitStunden < 11) {
      violations.push({
        type: "ruhezeit_zu_kurz",
        message: `Nur ${Math.max(0, ruhezeitStunden).toFixed(1)}h Ruhezeit zum Vortag (vorgeschrieben: 11h).`,
      });
    }
  }

  // Sonntagsarbeit (Art. 18 ArG) — Wochentag aus dem Datum des ersten Eintrags.
  const tagesDatum = toUTCDate(eintraegeEinesTages[0].date);
  const istSonntag = tagesDatum.getUTCDay() === 0;
  const hatArbeit = eintraegeEinesTages.some((e) => e.typ === "arbeit" && e.von && e.bis);
  if (istSonntag && hatArbeit) {
    violations.push({
      type: "sonntagsarbeit",
      message: "Sonntagsarbeit erfasst — bewilligungspflichtig, sofern nicht ausdrücklich freigegeben.",
    });
  }

  // Nachtarbeit (Art. 16/17 ArG, 23:00–06:00).
  const hatNachtarbeit = eintraegeEinesTages.some((e) => {
    if (e.typ !== "arbeit" || !e.von || !e.bis) return false;
    const vonMin = parseZeitInMinuten(e.von);
    let bisMin = parseZeitInMinuten(e.bis);
    if (bisMin <= vonMin) bisMin += 24 * 60;
    return ueberschneidetNachtzeit(vonMin, bisMin);
  });
  if (hatNachtarbeit) {
    violations.push({
      type: "nachtarbeit",
      message: "Nachtarbeit (23:00–06:00) erfasst — bewilligungspflichtig, sofern nicht ausdrücklich freigegeben.",
    });
  }

  return violations;
}
