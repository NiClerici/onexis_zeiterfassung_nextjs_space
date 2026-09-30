// Eine Farbe pro Eintragstyp, für die ganze App — eine Absenzfarbe bedeutet
// überall dasselbe (HARDENING.md C1). Vorher als TYPE_DOT_COLOR im Kalender
// und TYPE_CELL_COLOR in der Absenzenübersicht unabhängig voneinander
// gepflegt; seit der einheitlichen Team-Übersicht (Teamleiter-Wunsch,
// app/(app)/team/page.tsx) braucht eine dritte Stelle dieselbe Zuordnung —
// ab hier eine einzige Quelle statt einer dritten Kopie, die wieder
// auseinanderlaufen könnte.
export const TYPE_COLOR: Record<string, string> = {
  arbeit: "bg-green-500",
  ferien: "bg-sky-400",
  feiertag: "bg-purple-400",
  krank: "bg-red-400",
  militaer: "bg-orange-400",
  unbezahlt: "bg-gray-400",
};
