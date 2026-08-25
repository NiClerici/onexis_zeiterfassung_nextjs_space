// Prüft, ob eine TimeEntry-Zeile mit anderen Zeilen DESSELBEN Tages
// kollidiert — Duplikat, doppelte Absenz oder überlappende Arbeitszeit.
// Reine Berechnungslogik, kein Prisma (gleiches Trennungsprinzip wie
// lib/calc.ts und lib/compliance.ts).
//
// Grund für dieses Modul: components/day-entry-dialog.tsx liess bisher zwei
// exakt deckungsgleiche "arbeit"-Zeilen an einem Tag zu (der zweite Eintrag
// startet per Default wie der erste bei 08:00–17:00) und ebenso zwei
// "ferien"-Zeilen am selben Datum, was feriensaldo() (lib/calc.ts) dann als
// zwei bezogene Tage zählt. Andere Erfassungswege im Projekt haben diesen
// Schutz bereits: lib/absence-entries.ts überspringt einen Tag, der schon
// eine Zeile desselben Absenztyps hat, und bulk-apply/route.ts fasst Tage
// mit mehreren Zeilen gar nicht erst an. Dieses Modul bringt denselben
// Schutz für den Einzeldialog (POST/PUT /api/time-entries) und macht ihn
// dabei zur einzigen Quelle, statt die Regel ein drittes Mal zu kopieren.

import type { EintragInput } from "./calc";

export type KonfliktArt = "duplikat" | "absenz_doppelt" | "ueberlappung";

export interface EintragKonflikt {
  art: KonfliktArt;
  message: string;
}

export interface VergleichbarerEintrag extends EintragInput {
  // Fehlt bei ungespeicherten Zeilen (Tagesdialog: DraftRow.id ist dort
  // null) — eine Zeile ohne id kollidiert trotzdem, wird nur nie
  // fälschlich gegen sich selbst geprüft (das übernimmt der Aufrufer über
  // andereDesTages, das die eigene Zeile bereits ausschliesst).
  id?: string | null;
}

function parseZeitInMinuten(zeit: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(zeit);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

// [von, bis) in Minuten seit Mitternacht, bis > 1440 bei Schicht über
// Mitternacht — dieselbe Konvention wie eintragStartEnde() in
// lib/compliance.ts und stundenAusEintrag() in lib/calc.ts.
function spanne(eintrag: VergleichbarerEintrag): { von: number; bis: number } | null {
  if (eintrag.typ !== "arbeit" || !eintrag.von || !eintrag.bis) return null;
  const von = parseZeitInMinuten(eintrag.von);
  let bis = parseZeitInMinuten(eintrag.bis);
  if (von === null || bis === null) return null;
  if (bis <= von) bis += 24 * 60;
  return { von, bis };
}

function ueberlappen(a: { von: number; bis: number }, b: { von: number; bis: number }): boolean {
  return a.von < b.bis && b.von < a.bis;
}

function istGanztaegigeAbsenz(eintrag: VergleichbarerEintrag): boolean {
  return eintrag.typ !== "arbeit";
}

// Prüft `kandidat` gegen die übrigen Zeilen desselben Kalendertags
// (`andereDesTages` darf die eigene Zeile nicht enthalten — der Aufrufer
// filtert das vorher über id, siehe VergleichbarerEintrag.id). Migrierte
// Projekt-/Kundenzuordnungen ohne Wirkung auf die Arbeitszeit
// (countsAsWorktime === false, siehe TimeEntry.countsAsWorktime in
// prisma/schema.prisma) werden ignoriert — dieselbe Ausnahme wie
// getDayTotalHours() in app/(app)/calendar/page.tsx und kennzahlen() in
// lib/calc.ts.
export function pruefeEintragKonflikte(
  kandidat: VergleichbarerEintrag,
  andereDesTages: VergleichbarerEintrag[]
): EintragKonflikt[] {
  if (kandidat.countsAsWorktime === false) return [];
  const konflikte: EintragKonflikt[] = [];
  const relevante = andereDesTages.filter(
    (e) => e.countsAsWorktime !== false && (kandidat.id == null || e.id !== kandidat.id)
  );

  const kandidatSpanne = spanne(kandidat);

  for (const andere of relevante) {
    // Exaktes Duplikat: gleicher Typ, und bei "arbeit" identische Von/Bis
    // (bei Absenzen ohne Von/Bis reicht der gleiche Typ, siehe
    // absenz_doppelt unten — das wird dort separat abgedeckt, damit die
    // Meldung passender ist).
    if (
      kandidat.typ === andere.typ &&
      kandidat.typ === "arbeit" &&
      kandidat.von &&
      kandidat.bis &&
      kandidat.von === andere.von &&
      kandidat.bis === andere.bis &&
      (kandidat.pauseMin ?? 0) === (andere.pauseMin ?? 0)
    ) {
      konflikte.push({
        art: "duplikat",
        message: `Es existiert bereits ein identischer Eintrag an diesem Tag (${kandidat.von}–${kandidat.bis}).`,
      });
      continue;
    }

    // Doppelte Absenz: zweite Zeile desselben Absenztyps (z.B. zwei
    // "ferien"-Einträge) — analog zu lib/absence-entries.ts, das solche
    // Tage beim Bulk-Erfassen bereits überspringt.
    if (istGanztaegigeAbsenz(kandidat) && kandidat.typ === andere.typ) {
      konflikte.push({
        art: "absenz_doppelt",
        message: `An diesem Tag ist bereits ein Eintrag vom Typ "${kandidat.typ}" erfasst.`,
      });
      continue;
    }

    // Ganztägige Absenz neben Arbeitszeit (in beide Richtungen): eine
    // Absenz wie "krank" oder "ferien" schliesst denselben Tag als
    // Arbeitszeit-Tag aus.
    if (istGanztaegigeAbsenz(kandidat) !== istGanztaegigeAbsenz(andere)) {
      konflikte.push({
        art: "absenz_doppelt",
        message: `An diesem Tag ist bereits ein Eintrag vom Typ "${andere.typ}" erfasst, der sich mit einer Absenz nicht verträgt.`,
      });
      continue;
    }

    // Teilweise überlappende Arbeitszeit — nur eine Warnung, kein Blocker
    // (Nutzerentscheid: exakte Duplikate blocken, alles andere nur
    // anzeigen, weil es legitime Fälle gibt, z.B. Bereitschaft).
    const andereSpanne = spanne(andere);
    if (kandidatSpanne && andereSpanne && ueberlappen(kandidatSpanne, andereSpanne)) {
      konflikte.push({
        art: "ueberlappung",
        message: `Überschneidet sich mit einem anderen Eintrag desselben Tages (${andere.von}–${andere.bis}).`,
      });
    }
  }

  return konflikte;
}
