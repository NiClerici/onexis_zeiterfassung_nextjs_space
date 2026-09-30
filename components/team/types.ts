// Gemeinsame Typen für die Team-Hub-Komponenten (components/team/*) — 1:1
// zur JSON-Form von GET /api/team (app/api/team/route.ts).

export interface FeriensaldoData {
  anspruch: number;
  bezogen: number;
  geplant: number;
  offen: number;
}

export interface AbsenzVerteilung {
  stunden: number;
  tage: number;
}

export const ABSENZ_SPALTEN = ["ferien", "krank", "militaer", "unbezahlt"] as const;
export type AbsenzSpalte = (typeof ABSENZ_SPALTEN)[number];

export interface Zeitverteilung {
  kunden: number;
  intern: number;
  absenzen: Record<AbsenzSpalte | "feiertag", AbsenzVerteilung>;
  geplantAbsenzen: Record<AbsenzSpalte | "feiertag", AbsenzVerteilung>;
}

export interface KundeNachKunde {
  customerId: string;
  name: string;
  stunden: number;
}

export interface SaldoKumuliert {
  since: string;
  asOf: string;
  targetHours: number;
  actualHours: number;
  overtimeGross: number;
  paidOutHours: number;
  netOvertime: number;
  forecastNetOvertime: number;
}

export interface SaldoSeriePunkt {
  date: string;
  balance: number;
  delta: number;
}

export interface TeamMember {
  userId: string;
  name: string;
  pensum: number;
  soll: number;
  ist: number;
  ueberstunden: number;
  ueberzeit: number;
  kundenstunden: number;
  verrechnungsgrad: number;
  feriensaldo: FeriensaldoData;
  verteilung: Zeitverteilung;
  kundenNachKunde: KundeNachKunde[];
  saldoKumuliert: SaldoKumuliert;
  saldoSerie: SaldoSeriePunkt[];
  // null bei einem Zeitraum, der kein exakter Kalendermonat ist.
  monthLocked: boolean | null;
  // ISO-Datumsstring, editierbar über app/api/team/member-dates/route.ts —
  // für owner/admin jedes Mitglied, für manager nur sich selbst + direkt
  // Unterstellte. Steuert über buildProfil() auch die Sollstunden-Berechnung.
  entryDate: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  customerName: string;
  hourlyRate: number;
  budgetHours: number | null;
  stunden: number;
  umsatz: number;
  ueberzogen: boolean;
}

export interface CustomerNachPerson {
  userId: string;
  name: string;
  stunden: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  hourlyRate: number | null;
  stunden: number;
  umsatz: number;
  nachPerson: CustomerNachPerson[];
}

export interface TeamTotals {
  soll: number;
  ist: number;
  ueberstunden: number;
  kundenstunden: number;
  verrechnungsgrad: number;
  verteilung: { kunden: number; intern: number; absenzen: Record<AbsenzSpalte | "feiertag", AbsenzVerteilung> };
}

export interface TeamData {
  members: TeamMember[];
  totals: TeamTotals;
  customers: CustomerRow[];
  projects: ProjectRow[];
  kundenstundenUnscharf: boolean;
  monthLock: { year: number; month: number } | null;
}
