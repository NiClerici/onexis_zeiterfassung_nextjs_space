// Gemeinsamer "YYYY-MM-DD"-Parser für Request-Bodies. Nimmt nur den führenden
// Datumsteil (Rest wird ignoriert) und baut UTC-Mitternacht — new Date(s) auf
// einem vollen ISO-Datetime ohne Offset würde lokal statt UTC interpretiert
// und könnte auf einem Server mit TZ≠UTC den Tag verschieben.
//
// Validiert zusätzlich den Kalendertag: new Date(Date.UTC(y, m, 32)) würde
// sonst klaglos auf den 1. des Folgemonats überlaufen und ein Tippfehler wie
// "2026-02-30" landet unbemerkt als 02.03.2026 in der Datenbank.
//
// Extrahiert aus app/api/time-entries/route.ts (dort bislang die einzige
// Fassung, die diese Validierung tatsächlich vornimmt — Kopien in
// app/api/holidays, app/api/absence-requests und
// app/api/time-entries/bulk-vacation validieren den Kalendertag NICHT und
// wurden hier bewusst nicht mit angefasst, siehe REVIEW_LOOP.md "Danach").
export function parseDateYMD(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}
