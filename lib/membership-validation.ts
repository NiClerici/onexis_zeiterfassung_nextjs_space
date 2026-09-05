// Bereichs- und Typprüfung für die Membership-Felder, die den Überstunden-
// und Ferienberechnungen zugrunde liegen (lib/calc.ts). Bisher wurden
// weeklyHours/pensum/vacationDays in PUT /api/profile und PUT /api/admin/team
// roh aus dem Request-Body übernommen (Audit-Fund HOCH, REVIEW_LOOP.md) —
// ein `pensum: -100` ging unverändert in die Datenbank und liess
// tagessollBasis() negative Sollstunden liefern, ein `weeklyHours: "vierzig"`
// endete als 500er statt eines 400ers auf einen reinen Eingabefehler.
//
// Bewusst 400 statt Klemmen (anders als die Standardwoche in derselben
// Route, die auf [0, 24] geklemmt wird): ein pensum von -100 ist ein
// Eingabefehler, keine Eingabe, die sich stillschweigend zurechtbiegen lässt.
export interface MembershipNumberFields {
  weeklyHours?: unknown;
  pensum?: unknown;
  vacationDays?: unknown;
}

export interface ValidatedMembershipNumbers {
  weeklyHours?: number;
  pensum?: number;
  vacationDays?: number;
}

export type MembershipNumberValidation =
  | { ok: true; values: ValidatedMembershipNumbers }
  | { ok: false; error: string };

const RANGES: Record<keyof MembershipNumberFields, { min: number; max: number; label: string }> = {
  weeklyHours: { min: 0, max: 80, label: "Wochenstunden" },
  pensum: { min: 0, max: 100, label: "Pensum" },
  vacationDays: { min: 0, max: 60, label: "Ferientage" },
};

export function validateMembershipNumbers(fields: MembershipNumberFields): MembershipNumberValidation {
  const values: ValidatedMembershipNumbers = {};
  for (const key of Object.keys(RANGES) as Array<keyof MembershipNumberFields>) {
    const raw = fields[key];
    if (raw === undefined) continue;
    const { min, max, label } = RANGES[key];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      return { ok: false, error: `${label} muss eine Zahl zwischen ${min} und ${max} sein` };
    }
    values[key] = n;
  }
  return { ok: true, values };
}
