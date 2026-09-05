// Verschiebt beim Ändern einer Arbeitszeit-Zeile im Tagesdialog
// (components/day-entry-dialog.tsx) automatisch die Von/Bis-Zeiten der
// FOLGENDEN Zeilen desselben Tages um dieselbe Differenz — reine
// Berechnungslogik, kein Prisma (gleiches Trennungsprinzip wie lib/calc.ts).
//
// Grund: vorher hatte jede Zeile ihren eigenen Speichern-Button. Wer bei
// mehreren Einträgen pro Tag die Bis-Zeit des ersten änderte, musste jede
// folgende Zeile von Hand nachziehen und einzeln speichern. Mit einem
// einzigen Tages-Speichern-Button (siehe app/api/time-entries/day/route.ts)
// muss dieses Nachrücken jetzt automatisch passieren, sonst würden sich
// Folgezeilen beim Speichern des ganzen Tages mit der geänderten Zeile
// überschneiden.

export interface ShiftRow {
  key: string;
  typ: string;
  von: string; // "HH:MM"
  bis: string; // "HH:MM"
  // Stunden-Modus (siehe DraftRow.hoursMode in day-entry-dialog.tsx): dort
  // leitet resolvedZeit() `bis` aus `von` + eingegebener Stundenzahl ab — ein
  // zusätzliches Verschieben von `bis` hier würde die eingegebene Stundenzahl
  // verfälschen, deshalb bleibt `bis` in diesem Modus unangetastet.
  hoursMode: boolean;
}

const MAX_MINUTES = 23 * 60 + 59;

function parseMin(zeit: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(zeit);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMin(min: number): string {
  const clamped = Math.max(0, Math.min(MAX_MINUTES, min));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface VerschiebeErgebnis<T> {
  rows: T[];
  // true, wenn mindestens eine Folgezeile bei 23:59 gekappt wurde, statt die
  // volle Differenz zu übernehmen — Aufrufer kann das dem Nutzer anzeigen
  // statt die Kürzung stillschweigend zu übernehmen (gleiches Muster wie
  // buildArbeitszeit() in lib/arbeitszeit.ts).
  geklemmt: boolean;
}

// `rows` muss bereits chronologisch sortiert sein (so wie DraftRow[] im
// Tagesdialog: neue Zeilen werden ans Ende angehängt, siehe addRow() dort).
// Verschiebt nur "arbeit"-Zeilen NACH `geaenderterKey`; alles davor und alle
// Absenzzeilen bleiben unangetastet. deltaMin === 0 gibt `rows` unverändert
// zurück (identische Referenz), damit kein unnötiges Neurendern entsteht.
export function verschiebeFolgezeilen<T extends ShiftRow>(
  rows: T[],
  geaenderterKey: string,
  deltaMin: number
): VerschiebeErgebnis<T> {
  if (deltaMin === 0) return { rows, geklemmt: false };

  const index = rows.findIndex((r) => r.key === geaenderterKey);
  if (index === -1) return { rows, geklemmt: false };

  let geklemmt = false;
  const nextRows = rows.map((row, i) => {
    if (i <= index || row.typ !== "arbeit") return row;

    const vonMin = parseMin(row.von);
    if (vonMin === null) return row;
    const rawVon = vonMin + deltaMin;
    if (rawVon > MAX_MINUTES || rawVon < 0) geklemmt = true;
    const nextVon = formatMin(rawVon);

    if (row.hoursMode) {
      return { ...row, von: nextVon };
    }

    const bisMin = parseMin(row.bis);
    if (bisMin === null) return { ...row, von: nextVon };
    const rawBis = bisMin + deltaMin;
    if (rawBis > MAX_MINUTES || rawBis < 0) geklemmt = true;
    return { ...row, von: nextVon, bis: formatMin(rawBis) };
  });

  return { rows: nextRows, geklemmt };
}
