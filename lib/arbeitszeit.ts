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

// Start 08:00, Pause nach der ArG-Staffel — liefert von/bis für "arbeit"-Einträge
export function buildArbeitszeit(hours: number): { von: string; bis: string; pauseMin: number } {
  const pauseMin = mindestPauseMin(hours);
  const startMinutes = 8 * 60;
  const endMinutes = Math.min(23 * 60 + 59, startMinutes + Math.round(hours * 60) + pauseMin);
  const bh = Math.floor(endMinutes / 60);
  const bm = endMinutes % 60;
  return {
    von: "08:00",
    bis: `${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`,
    pauseMin,
  };
}
