// Aus app/api/time-entries/bulk-apply/route.ts herausgezogen (Betrieb.md
// Punkt 4) — wird jetzt auch vom Alt-Import gebraucht, der nur eine
// Stundenzahl kennt und daraus von/bis/Pause ableiten muss.

// Mindestpause nach Art. 15 ArG — der höchste erreichte Schwellenwert gilt,
// die Stufen summieren sich nicht. Einzige Quelle für diese Staffel: sowohl
// die automatische Pausenberechnung (buildArbeitszeit) als auch die
// Compliance-Warnung (lib/compliance.ts) leiten sich hiervon ab. Vorher
// standen hier "30 Min. ab 6h" und dort die ArG-Staffel — ein Eintrag
// zwischen 5.5h und 6h bekam damit 0 Min. Pause zugewiesen und wurde
// anschliessend von der App selbst beanstandet.
export function mindestPauseMin(nettoStunden: number): number {
  if (nettoStunden > 9) return 60;
  if (nettoStunden > 7) return 30;
  if (nettoStunden > 5.5) return 15;
  return 0;
}

export interface BuildArbeitszeitOptions {
  // Startzeit "HH:MM" statt fix 08:00 — Tagesdialog (components/
  // day-entry-dialog.tsx) nutzt das, damit der Wechsel in den Stunden-Modus
  // und zurück die tatsächlich eingetragene Startzeit einer Zeile behält,
  // statt sie stumm auf 08:00 zurückzusetzen (gemeldeter Bug: "wechselt man
  // zu Stunden, resettet sich die Zeit"). bulk-apply und der Alt-Import
  // rufen buildArbeitszeit() weiterhin ohne opts auf und bleiben dadurch
  // bit-genau beim bisherigen Verhalten (Start 08:00).
  startVon?: string;
  // Manuell gesetzte Pause statt des 0-Minuten-Defaults — derselbe Grund
  // wie bei startVon: ein Nutzer, der schon 60 Min. Pause eingetragen
  // hatte, soll beim Wechsel in den Stunden-Modus und zurück nicht
  // stillschweigend auf 0 zurückgesetzt werden.
  pauseMin?: number;
}

// Start 08:00 (bzw. opts.startVon), Pause standardmässig 0 Minuten (bzw.
// opts.pauseMin) — liefert von/bis für "arbeit"-Einträge. `geklemmt` zeigt
// an, ob das Ende auf 23:59 begrenzt wurde (Aufrufer können das dem Nutzer
// anzeigen statt die Kürzung stillschweigend zu übernehmen).
//
// Bewusst KEINE automatische Pausenvorbelegung nach der ArG-Staffel mehr
// (Bugfix "neue Zeile bekommt eine Pause, die niemand erfasst hat"): eine
// erfundene Pause verzerrte die Bis-Zeit, ohne dass sie je manuell
// eingetragen wurde. mindestPauseMin() bleibt unverändert bestehen — sie
// wird weiterhin von lib/compliance.ts für die (nicht-blockierende) Warnung
// "Pause zu kurz" gebraucht, sobald ein Tag über 5.5h Nettoarbeit ohne
// ausreichende Pause hat. Wer eine Pause will, trägt sie jetzt bewusst ein.
export function buildArbeitszeit(
  hours: number,
  opts: BuildArbeitszeitOptions = {}
): { von: string; bis: string; pauseMin: number; geklemmt: boolean } {
  const pauseMin = opts.pauseMin ?? 0;
  const startVon = opts.startVon ?? "08:00";
  const [startH, startM] = startVon.split(":").map(Number);
  const startMinutes = (Number.isFinite(startH) ? startH : 8) * 60 + (Number.isFinite(startM) ? startM : 0);
  const rawEndMinutes = startMinutes + Math.round(hours * 60) + pauseMin;
  const endMinutes = Math.min(23 * 60 + 59, rawEndMinutes);
  const bh = Math.floor(endMinutes / 60);
  const bm = endMinutes % 60;
  return {
    von: startVon,
    bis: `${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`,
    pauseMin,
    geklemmt: rawEndMinutes > 23 * 60 + 59,
  };
}
