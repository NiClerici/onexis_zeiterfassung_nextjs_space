// Reine Berechnungslogik für Sollstunden, Kennzahlen und Feriensaldo.
// Kein Prisma-Import, keine DB-Zugriffe — alles kommt als Parameter rein.

export const EINTRAG_TYPEN = [
  "arbeit",
  "ferien",
  "krank",
  "feiertag",
  "militaer",
  "unbezahlt",
] as const;

export type EintragTyp = (typeof EINTRAG_TYPEN)[number];

export interface Profil {
  pensum: number;
  wochenstunden: number;
  startDate: Date | string | null;
  // Analog zu startDate: an und vor exitDate zählt der Tag noch normal
  // (letzter Arbeitstag), erst danach ist das Tagessoll 0 (MIGRATION.md
  // Punkt 4d, Austritt eines Mitglieds).
  exitDate: Date | string | null;
  ferientage: number;
  // Gesetzliche Höchstarbeitszeit (Art. 12/13 ArG, 45 oder 50 Stunden pro
  // Kalenderwoche) — Organization.maxWeeklyHours, hier auf Profil statt in
  // einem eigenen Parameter, damit sollStundenTag/kennzahlen weiterhin aus
  // einem einzigen "was diese Person/Organisation betrifft"-Objekt lesen
  // (MIGRATION.md Punkt 6a).
  maxWeeklyHours: number;
}

export interface PensumChangeInput {
  effectiveFrom: Date | string;
  pensum: number;
  wochenstunden: number;
}

// Feiertag, wie sollStundenTag ihn braucht — nur Datum + Halbtag, canton/name
// sind reine Verwaltungsinfo der Holiday-Tabelle und für die Berechnung
// irrelevant (MIGRATION.md Punkt 6c).
export interface HolidayInput {
  date: Date | string;
  halfDay: boolean;
}

export interface EintragInput {
  typ: EintragTyp;
  von?: string | null;
  bis?: string | null;
  pauseMin?: number | null;
  hours?: number | null;
}

export interface EintragMitDatum extends EintragInput {
  date: Date | string;
  customerId?: string | null;
  // Verrechenbar — trägt jeder Eintrag jetzt selbst (MIGRATION.md Punkt 5),
  // vorbelegt aus Projekt/Kunde beim Anlegen. Ersetzt die frühere
  // Kunden-Lookup-Liste (KundeInput) für kundenstunden in kennzahlen().
  billable?: boolean | null;
}

export interface PayoutInput {
  date: Date | string;
  hours: number;
}

export interface KennzahlenInput {
  from: Date | string;
  to: Date | string;
  heute: Date | string;
  eintraege: EintragMitDatum[];
  profil: Profil;
  changes: PensumChangeInput[];
  payouts: PayoutInput[];
  holidays: HolidayInput[];
}

export interface KennzahlenResult {
  soll: number;
  ist: number;
  // Überstunden (Art. 321c OR): über der VERTRAGLICHEN Arbeitszeit, abzüglich
  // Auszahlungen. Hiess früher "ueberzeit" — fachlich falsch benannt, siehe
  // ueberzeit unten für den tatsächlichen ArG-Begriff (MIGRATION.md Punkt 6a).
  ueberstunden: number;
  // Überzeit (Art. 12/13 ArG): Summe der Wochenanteile über der GESETZLICHEN
  // Höchstarbeitszeit (profil.maxWeeklyHours), kalenderwochenweise (Mo–So)
  // gerechnet. Zählt nur typ="arbeit" — Absenzen sind keine Arbeitszeit im
  // Sinne des ArG. Berücksichtigt nur Wochen(-anteile) innerhalb von
  // [from, bisHeute]; Tage ausserhalb des abgefragten Zeitraums (z.B. der Rest
  // einer Woche vor Periodenbeginn) fliessen wie bei soll/ist grundsätzlich
  // nicht ein — dieselbe Einschränkung gilt dort bereits.
  ueberzeit: number;
  kundenstunden: number;
  verrechnungsgrad: number;
  geplantZukunft: number;
  sollGesamt: number;
  totalPrognose: number;
  prognoseSaldo: number;
}

export interface FeriensaldoInput {
  jahr: number;
  heute: Date | string;
  profil: Profil;
  changes: PensumChangeInput[];
  holidays: HolidayInput[];
  eintraege: EintragMitDatum[];
}

export interface FeriensaldoResult {
  anspruch: number;
  bezogen: number;
  geplant: number;
  offen: number;
}

// Normalisiert Date/String auf UTC-Mitternacht des Kalendertags. Prisma liefert
// @db.Date-Felder als UTC-Mitternacht zurück — konsistente UTC-Arithmetik
// vermeidet Off-by-one-Fehler durch lokale Zeitzonen-Verschiebung.
function toUTCDate(input: Date | string): Date {
  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    const d = new Date(input);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pensumAt(
  datum: Date | string,
  profil: Profil,
  changes: PensumChangeInput[]
): { pensum: number; wochenstunden: number } {
  const d = toUTCDate(datum);
  let result = { pensum: profil.pensum, wochenstunden: profil.wochenstunden };
  let latest: number | null = null;
  for (const change of changes) {
    const cd = toUTCDate(change.effectiveFrom).getTime();
    if (cd <= d.getTime() && (latest === null || cd > latest)) {
      latest = cd;
      result = { pensum: change.pensum, wochenstunden: change.wochenstunden };
    }
  }
  return result;
}

export function sollStundenTag(
  datum: Date | string,
  profil: Profil,
  changes: PensumChangeInput[],
  holidays: HolidayInput[]
): number {
  const d = toUTCDate(datum);
  if (profil.startDate && d.getTime() < toUTCDate(profil.startDate).getTime()) {
    return 0;
  }
  if (profil.exitDate && d.getTime() > toUTCDate(profil.exitDate).getTime()) {
    return 0;
  }
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return 0;
  const { pensum, wochenstunden } = pensumAt(d, profil, changes);
  const basis = (wochenstunden * pensum) / 100 / 5;
  // Feiertag (MIGRATION.md Punkt 6c): ganzer Tag → 0, Halbtag → halbes Soll.
  const feiertag = holidays.find((h) => toUTCDate(h.date).getTime() === d.getTime());
  if (feiertag) return feiertag.halfDay ? basis / 2 : 0;
  return basis;
}

export function stundenAusEintrag(eintrag: EintragInput, sollStundenDesTages: number): number {
  if (eintrag.typ === "unbezahlt") return 0;
  if (eintrag.typ === "arbeit") {
    if (!eintrag.von || !eintrag.bis) return eintrag.hours ?? 0;
    const [vh, vm] = eintrag.von.split(":").map(Number);
    const [bh, bm] = eintrag.bis.split(":").map(Number);
    const vonMin = vh * 60 + vm;
    let bisMin = bh * 60 + bm;
    if (bisMin < vonMin) bisMin += 24 * 60;
    const pause = eintrag.pauseMin ?? 0;
    return (bisMin - vonMin - pause) / 60;
  }
  return eintrag.hours ?? sollStundenDesTages;
}

// Montag der Kalenderwoche (UTC-Mitternacht), in der datum liegt — dieselbe
// "Woche startet Montag"-Konvention, die auch der Kalender verwendet. Dient
// als Gruppierungsschlüssel für die wochenweise ArG-Überzeit. Exportiert,
// damit der ArG-Kontrollexport (MIGRATION.md Punkt 7) dieselbe
// Wochendefinition verwendet statt sie ein zweites Mal zu implementieren.
export function montagDerWoche(datum: Date): Date {
  const day = datum.getUTCDay(); // 0=So, 1=Mo, ..., 6=Sa
  const diffZuMontag = day === 0 ? -6 : 1 - day;
  const montag = new Date(datum);
  montag.setUTCDate(datum.getUTCDate() + diffZuMontag);
  return montag;
}

// Exportiert (analog zu montagDerWoche), damit wochenUebersicht() und die
// Teamsicht (MIGRATION.md Punkt 8) dieselbe Tag-für-Tag-Sollstunden-Summe
// verwenden statt sie zweimal zu implementieren.
export function summeSollstunden(
  from: Date,
  to: Date,
  profil: Profil,
  changes: PensumChangeInput[],
  holidays: HolidayInput[]
): number {
  if (to.getTime() < from.getTime()) return 0;
  let total = 0;
  const current = new Date(from);
  while (current.getTime() <= to.getTime()) {
    total += sollStundenTag(current, profil, changes, holidays);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return total;
}

export function kennzahlen(input: KennzahlenInput): KennzahlenResult {
  const from = toUTCDate(input.from);
  const to = toUTCDate(input.to);
  const heute = toUTCDate(input.heute);
  const bisHeute = to.getTime() < heute.getTime() ? to : heute;

  const soll = summeSollstunden(from, bisHeute, input.profil, input.changes, input.holidays);
  const sollGesamt = summeSollstunden(from, to, input.profil, input.changes, input.holidays);

  let ist = 0;
  let kundenstunden = 0;
  let geplantZukunft = 0;
  // Nur tatsächlich geleistete Arbeitszeit (typ="arbeit") zählt für die
  // ArG-Höchstarbeitszeit — Absenzen sind keine Arbeitszeit im Sinne des
  // Gesetzes. Gruppiert nach Montag der jeweiligen Kalenderwoche.
  const arbeitsstundenProWoche = new Map<number, number>();

  for (const eintrag of input.eintraege) {
    const d = toUTCDate(eintrag.date);
    if (d.getTime() > to.getTime()) continue;
    const tagesSoll = sollStundenTag(d, input.profil, input.changes, input.holidays);
    const stunden = stundenAusEintrag(eintrag, tagesSoll);
    if (d.getTime() <= bisHeute.getTime()) {
      ist += stunden;
      if (eintrag.typ === "arbeit" && eintrag.billable) {
        kundenstunden += stunden;
      }
      if (eintrag.typ === "arbeit" && d.getTime() >= from.getTime()) {
        const wochenSchluessel = montagDerWoche(d).getTime();
        arbeitsstundenProWoche.set(wochenSchluessel, (arbeitsstundenProWoche.get(wochenSchluessel) ?? 0) + stunden);
      }
    } else if (d.getTime() > heute.getTime()) {
      geplantZukunft += stunden;
    }
  }

  const payoutSum = input.payouts
    .filter((p) => {
      const d = toUTCDate(p.date);
      return d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
    })
    .reduce((s, p) => s + p.hours, 0);

  const ueberstunden = ist - soll - payoutSum;

  let ueberzeit = 0;
  for (const wochenstunden of arbeitsstundenProWoche.values()) {
    if (wochenstunden > input.profil.maxWeeklyHours) {
      ueberzeit += wochenstunden - input.profil.maxWeeklyHours;
    }
  }

  const verrechnungsgrad = ist > 0 ? (kundenstunden / ist) * 100 : 0;
  const totalPrognose = ist + geplantZukunft;
  const prognoseSaldo = totalPrognose - sollGesamt;

  return {
    soll: round1(soll),
    ist: round1(ist),
    ueberstunden: round1(ueberstunden),
    ueberzeit: round1(ueberzeit),
    kundenstunden: round1(kundenstunden),
    verrechnungsgrad: round1(verrechnungsgrad),
    geplantZukunft: round1(geplantZukunft),
    sollGesamt: round1(sollGesamt),
    totalPrognose: round1(totalPrognose),
    prognoseSaldo: round1(prognoseSaldo),
  };
}

export interface WochenSummary {
  // Montag der Kalenderwoche, "YYYY-MM-DD".
  montag: string;
  // Tatsächliche/vorerfasste Arbeitszeit (nur typ="arbeit") in dieser Woche,
  // innerhalb [from, to] — unabhängig davon, ob das Datum in der
  // Vergangenheit oder Zukunft liegt (Punkt 8 braucht auch vorerfasste
  // ZUKÜNFTIGE Wochen für die Auslastungsprognose).
  arbeitsstunden: number;
  // Anteil von arbeitsstunden über profil.maxWeeklyHours (Art. 12/13 ArG) — 0, wenn keine.
  ueberzeit: number;
  // Davon verrechenbare Arbeitszeit (typ="arbeit" && billable).
  kundenstunden: number;
  // kundenstunden / arbeitsstunden * 100 — 0 bei arbeitsstunden = 0.
  verrechnungsgrad: number;
  // Volles Wochensoll (Mo–So laut sollStundenTag), unabhängig davon, ob
  // [from, to] mitten in der Woche endet — Vereinfachung für eine
  // konsistente Wochenkachel in Heatmap/Prognose statt eines an den
  // Periodenrand angeschnittenen Teilsolls.
  sollStunden: number;
  // arbeitsstunden / sollStunden * 100 — 0 bei sollStunden = 0.
  auslastung: number;
}

// Wochenweise Aufschlüsselung der Arbeitszeit — DICHT über jede Kalenderwoche
// zwischen montagDerWoche(from) und montagDerWoche(to) (auch Wochen ganz ohne
// Einträge erscheinen mit 0-Werten), nicht nur über Wochen mit Einträgen.
// Dient gleich drei Zwecken, die dieselbe Wochen-Gruppierung brauchen und
// deshalb bewusst eine gemeinsame Funktion sind statt drei fast identischer:
//   - ArG-Kontrollexport (Punkt 7): arbeitsstunden + ueberzeit je Woche.
//   - Teamsicht-Heatmap (Punkt 8): verrechnungsgrad je Mitarbeiter*in und Woche.
//   - Teamsicht-Prognose (Punkt 8): auslastung (arbeitsstunden/sollStunden)
//     für Wochen, deren Montag in der Zukunft liegt — "geplante Auslastung
//     aus vorerfassten Einträgen".
// kennzahlen() selbst bleibt unverändert, das hier ist eine zusätzliche,
// rein additive Funktion.
export function wochenUebersicht(
  eintraege: EintragMitDatum[],
  profil: Profil,
  changes: PensumChangeInput[],
  holidays: HolidayInput[],
  from: Date | string,
  to: Date | string
): WochenSummary[] {
  const fromD = toUTCDate(from);
  const toD = toUTCDate(to);
  if (toD.getTime() < fromD.getTime()) return [];

  const arbeitMap = new Map<number, number>();
  const kundenMap = new Map<number, number>();
  for (const eintrag of eintraege) {
    if (eintrag.typ !== "arbeit") continue;
    const d = toUTCDate(eintrag.date);
    if (d.getTime() < fromD.getTime() || d.getTime() > toD.getTime()) continue;
    // sollStundenDesTages ist für typ="arbeit" irrelevant (stundenAusEintrag
    // nutzt es nur für Absenzen ohne eigene von/bis-Zeit) — 0 ist hier sicher.
    const stunden = stundenAusEintrag(eintrag, 0);
    const key = montagDerWoche(d).getTime();
    arbeitMap.set(key, (arbeitMap.get(key) ?? 0) + stunden);
    if (eintrag.billable) kundenMap.set(key, (kundenMap.get(key) ?? 0) + stunden);
  }

  const result: WochenSummary[] = [];
  let montag = montagDerWoche(fromD);
  const letzterMontag = montagDerWoche(toD);
  while (montag.getTime() <= letzterMontag.getTime()) {
    const key = montag.getTime();
    const arbeitsstunden = round1(arbeitMap.get(key) ?? 0);
    const kundenstunden = round1(kundenMap.get(key) ?? 0);
    const wochenEnde = new Date(montag.getTime() + 6 * 24 * 60 * 60 * 1000);
    const sollStunden = round1(summeSollstunden(montag, wochenEnde, profil, changes, holidays));
    result.push({
      montag: montag.toISOString().split("T")[0],
      arbeitsstunden,
      ueberzeit: round1(Math.max(0, arbeitsstunden - profil.maxWeeklyHours)),
      kundenstunden,
      verrechnungsgrad: arbeitsstunden > 0 ? round1((kundenstunden / arbeitsstunden) * 100) : 0,
      sollStunden,
      auslastung: sollStunden > 0 ? round1((arbeitsstunden / sollStunden) * 100) : 0,
    });
    montag = new Date(montag.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return result;
}

export function feriensaldo(input: FeriensaldoInput): FeriensaldoResult {
  const { jahr, profil, changes, holidays } = input;
  const heute = toUTCDate(input.heute);
  const startDate = profil.startDate ? toUTCDate(profil.startDate) : null;

  let anspruch: number;
  if (startDate && startDate.getUTCFullYear() === jahr) {
    const startMonat = startDate.getUTCMonth() + 1;
    anspruch = (profil.ferientage * (13 - startMonat)) / 12;
  } else {
    anspruch = profil.ferientage;
  }
  anspruch = round1(anspruch);

  // bezogen/geplant sind wie anspruch in Tagen. Jeder Eintrag wird über das
  // Tagessoll seines Datums in einen Tage-Anteil umgerechnet (Halbtage etc.
  // bleiben so korrekt anteilig). changes muss dabei durchgereicht werden —
  // sonst wird nach einem Pensumswechsel mit dem falschen Tagessoll geteilt
  // und ein voller Ferientag zählt z.B. nur als 0.6 Tage.
  let bezogen = 0;
  let geplant = 0;
  for (const eintrag of input.eintraege) {
    if (eintrag.typ !== "ferien") continue;
    const d = toUTCDate(eintrag.date);
    if (d.getUTCFullYear() !== jahr) continue;
    const tagesSoll = sollStundenTag(d, profil, changes, holidays);
    const stunden = stundenAusEintrag(eintrag, tagesSoll);
    const tage = tagesSoll > 0 ? stunden / tagesSoll : 0;
    if (d.getTime() <= heute.getTime()) bezogen += tage;
    else geplant += tage;
  }
  bezogen = round1(bezogen);
  geplant = round1(geplant);
  const offen = round1(anspruch - bezogen - geplant);

  return { anspruch, bezogen, geplant, offen };
}
