// Aus app/api/time-entries/bulk-apply/route.ts herausgezogen (Betrieb.md
// Punkt 4) — wird jetzt auch vom Alt-Import gebraucht, der nur eine
// Stundenzahl kennt und daraus von/bis/Pause ableiten muss.

// Start 08:00, 30min Pause ab 6h Tagesstunden — liefert von/bis für "arbeit"-Einträge
export function buildArbeitszeit(hours: number): { von: string; bis: string; pauseMin: number } {
  const pauseMin = hours >= 6 ? 30 : 0;
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
