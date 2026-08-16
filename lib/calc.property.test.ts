// Property-basierte Tests für sollStundenTag (HARDENING.md B3).
//
// Beispieltests in lib/calc.test.ts prüfen konkrete Werte an konkreten Tagen.
// Hier geht es um das Gegenstück: über sehr viele zufällig erzeugte Profile,
// Pensumsänderungen und Tage werden nur INVARIANTEN geprüft — Eigenschaften,
// die für jede erlaubte Eingabe gelten müssen. Das fängt Fehlerklassen, die
// einzelne Beispiele verfehlen.
//
// Bewusst KEIN fast-check als neue Abhängigkeit: ein geseedeter PRNG reicht
// für diesen Zweck und hält jeden Fehlschlag exakt reproduzierbar — bei einem
// roten Test steht der Seed in der Fehlermeldung und der Fall lässt sich
// unverändert nachstellen.

import { describe, expect, it } from "vitest";
import { sollStundenTag, pensumAt, summeSollstunden, type Profil, type PensumChangeInput, type HolidayInput } from "./calc";

// mulberry32 — kleiner, schneller PRNG mit 32-Bit-Seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intBetween(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

const TAG_MS = 24 * 60 * 60 * 1000;
const ZEITRAUM_START = Date.UTC(2024, 0, 1);
const ZEITRAUM_ENDE = Date.UTC(2028, 11, 31);
const TAGE_GESAMT = Math.round((ZEITRAUM_ENDE - ZEITRAUM_START) / TAG_MS) + 1;

function tagBeiIndex(i: number): Date {
  return new Date(ZEITRAUM_START + i * TAG_MS);
}

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

interface Szenario {
  profil: Profil;
  changes: PensumChangeInput[];
  holidays: HolidayInput[];
}

// Erzeugt ein zufälliges, aber plausibles Szenario: Wochenstunden 20–50,
// Pensum 10–100, Eintritt irgendwann im Zeitraum, in der Hälfte der Fälle ein
// Austritt danach, 0–5 Pensumsänderungen und 0–12 Feiertage.
function zufallsSzenario(seed: number): Szenario {
  const rnd = mulberry32(seed);
  const wochenstunden = intBetween(rnd, 20, 50);
  const pensum = intBetween(rnd, 10, 100);

  const startIndex = intBetween(rnd, 0, Math.floor(TAGE_GESAMT / 2));
  const hatAustritt = rnd() < 0.5;
  const exitIndex = hatAustritt ? intBetween(rnd, startIndex, TAGE_GESAMT - 1) : null;

  const profil: Profil = {
    wochenstunden,
    pensum,
    ferientage: intBetween(rnd, 20, 30),
    startDate: ymd(tagBeiIndex(startIndex)),
    exitDate: exitIndex === null ? null : ymd(tagBeiIndex(exitIndex)),
    maxWeeklyHours: rnd() < 0.5 ? 45 : 50,
  };

  const changes: PensumChangeInput[] = [];
  const anzahlChanges = intBetween(rnd, 0, 5);
  for (let i = 0; i < anzahlChanges; i++) {
    changes.push({
      effectiveFrom: ymd(tagBeiIndex(intBetween(rnd, 0, TAGE_GESAMT - 1))),
      pensum: intBetween(rnd, 0, 100),
      wochenstunden: intBetween(rnd, 20, 50),
    });
  }

  const holidays: HolidayInput[] = [];
  const anzahlFeiertage = intBetween(rnd, 0, 12);
  for (let i = 0; i < anzahlFeiertage; i++) {
    holidays.push({
      date: ymd(tagBeiIndex(intBetween(rnd, 0, TAGE_GESAMT - 1))),
      halfDay: rnd() < 0.3,
    });
  }

  return { profil, changes, holidays };
}

const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

describe("sollStundenTag — Invarianten über 5 Jahre und 25 Zufallsszenarien (HARDENING.md B3)", () => {
  it("liefert für JEDEN Tag einen endlichen Wert zwischen 0 und 24", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      for (let i = 0; i < TAGE_GESAMT; i++) {
        const tag = tagBeiIndex(i);
        const soll = sollStundenTag(tag, profil, changes, holidays);
        // Ein einziger Fehlschlag nennt Seed und Tag — damit ist der Fall
        // ohne Rätselraten reproduzierbar.
        const wo = `seed=${seed} tag=${ymd(tag)}`;
        expect(Number.isFinite(soll), `${wo}: nicht endlich (${soll})`).toBe(true);
        expect(soll, `${wo}: negativ`).toBeGreaterThanOrEqual(0);
        expect(soll, `${wo}: über 24h`).toBeLessThanOrEqual(24);
      }
    }
  });

  it("ist an Wochenenden immer 0, unabhängig von Pensum, Feiertagen und Änderungen", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      for (let i = 0; i < TAGE_GESAMT; i++) {
        const tag = tagBeiIndex(i);
        const wochentag = tag.getUTCDay();
        if (wochentag !== 0 && wochentag !== 6) continue;
        expect(sollStundenTag(tag, profil, changes, holidays), `seed=${seed} tag=${ymd(tag)}`).toBe(0);
      }
    }
  });

  it("ist vor dem Eintritt und nach dem Austritt immer 0", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      const start = new Date(`${profil.startDate}T00:00:00Z`).getTime();
      const exit = profil.exitDate ? new Date(`${profil.exitDate}T00:00:00Z`).getTime() : null;
      for (let i = 0; i < TAGE_GESAMT; i++) {
        const tag = tagBeiIndex(i);
        const t = tag.getTime();
        if (t < start || (exit !== null && t > exit)) {
          expect(sollStundenTag(tag, profil, changes, holidays), `seed=${seed} tag=${ymd(tag)}`).toBe(0);
        }
      }
    }
  });

  it("ist deterministisch: derselbe Tag liefert bei wiederholtem Aufruf denselben Wert", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      // Auch mit umgestellter Reihenfolge der Changes und Feiertage, denn
      // beide Arrays kommen aus einer DB-Query ohne garantierte Sortierung.
      const changesUmgekehrt = [...changes].reverse();
      const holidaysUmgekehrt = [...holidays].reverse();
      for (let i = 0; i < TAGE_GESAMT; i += 13) {
        const tag = tagBeiIndex(i);
        const a = sollStundenTag(tag, profil, changes, holidays);
        const b = sollStundenTag(tag, profil, changes, holidays);
        expect(b, `seed=${seed} tag=${ymd(tag)}: nicht deterministisch`).toBe(a);
        // Reihenfolge darf nichts ändern, solange keine zwei Changes auf
        // demselben Tag liegen (dort gewinnt laut A2 der zuletzt übergebene).
        const tageMitMehrfachChange = new Set(
          changes.map((c) => String(c.effectiveFrom)).filter((d, idx, arr) => arr.indexOf(d) !== idx)
        );
        if (tageMitMehrfachChange.size === 0) {
          const c = sollStundenTag(tag, profil, changesUmgekehrt, holidaysUmgekehrt);
          expect(c, `seed=${seed} tag=${ymd(tag)}: reihenfolgeabhängig`).toBe(a);
        }
      }
    }
  });

  it("entspricht an einem normalen Arbeitstag exakt wochenstunden × pensum / 100 / 5", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      const feiertagsTage = new Set(holidays.map((h) => String(h.date)));
      const start = new Date(`${profil.startDate}T00:00:00Z`).getTime();
      const exit = profil.exitDate ? new Date(`${profil.exitDate}T00:00:00Z`).getTime() : null;

      for (let i = 0; i < TAGE_GESAMT; i += 7) {
        const tag = tagBeiIndex(i);
        const wochentag = tag.getUTCDay();
        const t = tag.getTime();
        // Nur echte Arbeitstage ohne Feiertag und innerhalb der Anstellung.
        if (wochentag === 0 || wochentag === 6) continue;
        if (feiertagsTage.has(ymd(tag))) continue;
        if (t < start || (exit !== null && t > exit)) continue;

        const { pensum, wochenstunden } = pensumAt(tag, profil, changes);
        const erwartet = (wochenstunden * pensum) / 100 / 5;
        expect(sollStundenTag(tag, profil, changes, holidays), `seed=${seed} tag=${ymd(tag)}`).toBeCloseTo(erwartet, 10);
      }
    }
  });

  it("halbiert das Tagessoll an einem Halbtags-Feiertag und setzt es an einem ganzen auf 0", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      const start = new Date(`${profil.startDate}T00:00:00Z`).getTime();
      const exit = profil.exitDate ? new Date(`${profil.exitDate}T00:00:00Z`).getTime() : null;

      for (const feiertag of holidays) {
        const tag = new Date(`${String(feiertag.date)}T00:00:00Z`);
        const wochentag = tag.getUTCDay();
        const t = tag.getTime();
        if (wochentag === 0 || wochentag === 6) continue;
        if (t < start || (exit !== null && t > exit)) continue;
        // Bei mehreren Einträgen auf denselben Tag gewinnt der erste Treffer
        // in holidays.find — dieser Fall wird hier übersprungen.
        const treffer = holidays.filter((h) => String(h.date) === String(feiertag.date));
        if (treffer.length > 1) continue;

        const { pensum, wochenstunden } = pensumAt(tag, profil, changes);
        const basis = (wochenstunden * pensum) / 100 / 5;
        const soll = sollStundenTag(tag, profil, changes, holidays);
        const wo = `seed=${seed} tag=${ymd(tag)} halfDay=${feiertag.halfDay}`;
        if (feiertag.halfDay) {
          expect(soll, wo).toBeCloseTo(basis / 2, 10);
        } else {
          expect(soll, wo).toBe(0);
        }
      }
    }
  });
});

describe("summeSollstunden — Wocheninvariante bei konstantem Pensum (HARDENING.md B3)", () => {
  it("eine volle Mo–So-Woche ohne Feiertage ergibt exakt wochenstunden × pensum / 100", () => {
    // Vorbedingung bewusst hergestellt: keine Pensumsänderung, keine
    // Feiertage, Woche vollständig innerhalb der Anstellung. Ohne diese drei
    // Bedingungen ist die Invariante per Definition verletzt (lib/calc.ts
    // prüft in genau dieser Reihenfolge startDate/exitDate, Wochenende,
    // Feiertag) — eine Invariante ohne ihre Vorbedingung zu behaupten wäre
    // ein Test, der das Falsche festschreibt.
    for (const seed of SEEDS) {
      const rnd = mulberry32(seed);
      const wochenstunden = intBetween(rnd, 20, 50);
      const pensum = intBetween(rnd, 0, 100);
      const profil: Profil = {
        wochenstunden,
        pensum,
        ferientage: 25,
        startDate: "2020-01-01",
        exitDate: null,
        maxWeeklyHours: 45,
      };

      for (let versuch = 0; versuch < 20; versuch++) {
        // Irgendein Montag im Zeitraum.
        const index = intBetween(rnd, 0, TAGE_GESAMT - 8);
        const kandidat = tagBeiIndex(index);
        const versatzZumMontag = (kandidat.getUTCDay() + 6) % 7;
        const montag = new Date(kandidat.getTime() - versatzZumMontag * TAG_MS);
        const sonntag = new Date(montag.getTime() + 6 * TAG_MS);

        const summe = summeSollstunden(montag, sonntag, profil, [], []);
        expect(summe, `seed=${seed} woche ab ${ymd(montag)}`).toBeCloseTo((wochenstunden * pensum) / 100, 10);
      }
    }
  });

  it("ist monoton im Pensum: mehr Pensum ergibt nie weniger Soll", () => {
    for (const seed of SEEDS) {
      const rnd = mulberry32(seed);
      const wochenstunden = intBetween(rnd, 20, 50);
      const basis: Profil = {
        wochenstunden,
        pensum: 0,
        ferientage: 25,
        startDate: "2020-01-01",
        exitDate: null,
        maxWeeklyHours: 45,
      };
      const von = tagBeiIndex(intBetween(rnd, 0, TAGE_GESAMT - 60));
      const bis = new Date(von.getTime() + 30 * TAG_MS);

      let vorheriges = -1;
      for (const pensum of [0, 10, 20, 40, 60, 80, 100]) {
        const summe = summeSollstunden(von, bis, { ...basis, pensum }, [], []);
        expect(summe, `seed=${seed} pensum=${pensum}`).toBeGreaterThanOrEqual(vorheriges);
        vorheriges = summe;
      }
    }
  });

  it("ist additiv: die Summe zweier angrenzender Zeiträume entspricht dem Gesamtzeitraum", () => {
    for (const seed of SEEDS) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      const von = tagBeiIndex(intBetween(mulberry32(seed), 0, TAGE_GESAMT - 200));
      const mitte = new Date(von.getTime() + 90 * TAG_MS);
      const bis = new Date(von.getTime() + 180 * TAG_MS);

      const gesamt = summeSollstunden(von, bis, profil, changes, holidays);
      const teil1 = summeSollstunden(von, mitte, profil, changes, holidays);
      const teil2 = summeSollstunden(new Date(mitte.getTime() + TAG_MS), bis, profil, changes, holidays);
      expect(teil1 + teil2, `seed=${seed} ab ${ymd(von)}`).toBeCloseTo(gesamt, 10);
    }
  });

  it("liefert 0 für einen umgekehrten Zeitraum (bis vor von)", () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const { profil, changes, holidays } = zufallsSzenario(seed);
      const von = tagBeiIndex(100);
      const bis = tagBeiIndex(50);
      expect(summeSollstunden(von, bis, profil, changes, holidays), `seed=${seed}`).toBe(0);
    }
  });
});
