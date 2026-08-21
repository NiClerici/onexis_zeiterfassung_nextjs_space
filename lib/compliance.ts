// Reine Prüfung von Pausen-/Ruhezeit-/Höchstarbeitszeit-Vorgaben nach ArG
// (Arbeitsgesetz) — kein Prisma, kein DB-Zugriff, gleiches Trennungsprinzip
// wie lib/calc.ts. Liefert nur Warnungen (nicht-blockierend, MIGRATION.md
// Punkt 6d) — nichts hier verhindert das Speichern eines Eintrags.

import type { EintragMitDatum } from "./calc";
import { mindestPauseMin } from "./arbeitszeit";

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

// Pro Organisation abschaltbare Warnungen (Punkt "ArG-Toggles"). Der
// Funktions-Default bleibt bewusst "alles an" — der abweichende
// Organisations-Default (Sonntag standardmässig aus) lebt ausschliesslich
// in der DB-Spalte Organization.warnSonntagsarbeit, nicht hier. So bleibt
// insbesondere der ArG-Kontrollexport (app/api/export/arg-control/route.ts),
// der pruefeCompliance ohne Optionen aufruft, unverändert vollständig.
export interface ComplianceOptions {
  warnPauseZuKurz?: boolean;
  warnSonntagsarbeit?: boolean;
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

// Zeit zwischen zwei Arbeitseinträgen desselben Tages. Wer vormittags für
// Kunde A und nachmittags für Kunde B je einen eigenen Eintrag erfasst
// (08:00–12:00 und 13:00–17:00), hat die Mittagspause als LÜCKE erfasst und
// nicht als pauseMin — sie ist trotzdem eine Pause im Sinne von Art. 15 ArG.
// Ohne diese Funktion meldet die Pausenregel dort einen Verstoss, obwohl
// faktisch pausiert wurde (HARDENING.md A5).
//
// Überlappende oder verschachtelte Einträge erzeugen keine negative Pause:
// die Intervalle werden nach Startzeitpunkt sortiert und das bisher späteste
// Ende mitgeführt, Lücken unter 0 fallen weg.
function lueckenMinutenDesTages(eintraege: EintragMitDatum[]): number {
  const intervalle = eintraege
    .map(eintragStartEnde)
    .filter((x): x is { start: Date; ende: Date } => x !== null)
    .map((x) => ({ start: x.start.getTime(), ende: x.ende.getTime() }))
    .sort((a, b) => a.start - b.start);
  if (intervalle.length < 2) return 0;

  let luecken = 0;
  let spaetestesEnde = intervalle[0].ende;
  for (let i = 1; i < intervalle.length; i++) {
    const luecke = intervalle[i].start - spaetestesEnde;
    if (luecke > 0) luecken += luecke / (1000 * 60);
    spaetestesEnde = Math.max(spaetestesEnde, intervalle[i].ende);
  }
  return luecken;
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
  eintraegeVortag: EintragMitDatum[],
  options: ComplianceOptions = {}
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (eintraegeEinesTages.length === 0) return violations;

  const arbeitsstunden = arbeitsstundenDesTages(eintraegeEinesTages);
  // Effektive Pause = erfasste pauseMin PLUS die Lücken zwischen mehreren
  // Arbeitseinträgen desselben Tages (siehe lueckenMinutenDesTages).
  const erfasstePauseMin = pauseMinutenDesTages(eintraegeEinesTages);
  const lueckenMin = Math.round(lueckenMinutenDesTages(eintraegeEinesTages));
  const pauseMin = erfasstePauseMin + lueckenMin;

  // Pausenregel Art. 15 ArG: der höchste erreichte Schwellenwert bestimmt die
  // Mindestpause, nicht eine Summe aus allen Stufen. Dieselbe Staffel wie
  // buildArbeitszeit() in lib/arbeitszeit.ts — eine Stelle, damit neu
  // erfasste Einträge nicht ihre eigene Warnung auslösen.
  const erforderlichePauseMin = mindestPauseMin(arbeitsstunden);

  if (options.warnPauseZuKurz !== false && erforderlichePauseMin > 0 && pauseMin < erforderlichePauseMin) {
    // Lücken nur erwähnen, wenn es welche gibt — sonst bleibt die Meldung
    // wie bisher.
    const erfasstText =
      lueckenMin > 0
        ? `erfasst: ${erfasstePauseMin} Min. + ${lueckenMin} Min. zwischen den Einträgen = ${pauseMin} Min.`
        : `erfasst: ${pauseMin} Min.`;
    violations.push({
      type: "pause_zu_kurz",
      message: `Bei ${arbeitsstunden.toFixed(1)}h Arbeitszeit sind mindestens ${erforderlichePauseMin} Min. Pause vorgeschrieben (${erfasstText}).`,
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
  if (options.warnSonntagsarbeit !== false && istSonntag && hatArbeit) {
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
