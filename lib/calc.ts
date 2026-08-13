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
}

export interface PensumChangeInput {
  effectiveFrom: Date | string;
  pensum: number;
  wochenstunden: number;
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
}

export interface PayoutInput {
  date: Date | string;
  hours: number;
}

export interface KundeInput {
  id: string;
  billable: boolean;
}

export interface KennzahlenInput {
  from: Date | string;
  to: Date | string;
  heute: Date | string;
  eintraege: EintragMitDatum[];
  profil: Profil;
  changes: PensumChangeInput[];
  payouts: PayoutInput[];
  kunden: KundeInput[];
}

export interface KennzahlenResult {
  soll: number;
  ist: number;
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
  changes: PensumChangeInput[]
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
  return (wochenstunden * pensum) / 100 / 5;
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

function summeSollstunden(
  from: Date,
  to: Date,
  profil: Profil,
  changes: PensumChangeInput[]
): number {
  if (to.getTime() < from.getTime()) return 0;
  let total = 0;
  const current = new Date(from);
  while (current.getTime() <= to.getTime()) {
    total += sollStundenTag(current, profil, changes);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return total;
}

export function kennzahlen(input: KennzahlenInput): KennzahlenResult {
  const from = toUTCDate(input.from);
  const to = toUTCDate(input.to);
  const heute = toUTCDate(input.heute);
  const bisHeute = to.getTime() < heute.getTime() ? to : heute;

  const soll = summeSollstunden(from, bisHeute, input.profil, input.changes);
  const sollGesamt = summeSollstunden(from, to, input.profil, input.changes);

  const billableKundenIds = new Set(input.kunden.filter((k) => k.billable).map((k) => k.id));

  let ist = 0;
  let kundenstunden = 0;
  let geplantZukunft = 0;

  for (const eintrag of input.eintraege) {
    const d = toUTCDate(eintrag.date);
    if (d.getTime() > to.getTime()) continue;
    const tagesSoll = sollStundenTag(d, input.profil, input.changes);
    const stunden = stundenAusEintrag(eintrag, tagesSoll);
    if (d.getTime() <= bisHeute.getTime()) {
      ist += stunden;
      if (eintrag.typ === "arbeit" && eintrag.customerId && billableKundenIds.has(eintrag.customerId)) {
        kundenstunden += stunden;
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

  const ueberzeit = ist - soll - payoutSum;
  const verrechnungsgrad = ist > 0 ? (kundenstunden / ist) * 100 : 0;
  const totalPrognose = ist + geplantZukunft;
  const prognoseSaldo = totalPrognose - sollGesamt;

  return {
    soll: round1(soll),
    ist: round1(ist),
    ueberzeit: round1(ueberzeit),
    kundenstunden: round1(kundenstunden),
    verrechnungsgrad: round1(verrechnungsgrad),
    geplantZukunft: round1(geplantZukunft),
    sollGesamt: round1(sollGesamt),
    totalPrognose: round1(totalPrognose),
    prognoseSaldo: round1(prognoseSaldo),
  };
}

export function feriensaldo(input: FeriensaldoInput): FeriensaldoResult {
  const { jahr, profil, changes } = input;
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
    const tagesSoll = sollStundenTag(d, profil, changes);
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
