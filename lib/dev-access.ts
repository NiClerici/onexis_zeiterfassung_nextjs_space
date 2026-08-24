// Zugriffshelfer für die Developer-Übersicht /dev — die einzige Sicht der App,
// die BEWUSST nicht über orgId gescopet ist (lib/access.ts requireOrg()), weil
// sie den Betreiber über alle Mandanten hinweg informiert.
//
// Warum eine ENV-Allowlist und kein "developer"-Wert in Membership.role:
// eine Rolle hängt immer an genau einer Organisation. Die Plattform-Sicht ist
// aber gerade org-übergreifend — ein org-gebundenes Flag wäre die falsche
// Achse und würde ausserdem bedeuten, dass ein Org-Owner sich das Recht per
// /admin/team selbst zuschieben könnte.
//
// Warum die Prüfung NICHT in middleware.ts stattfindet: Next.js ersetzt
// process.env in der Edge-Runtime beim BUILD, nicht zur Laufzeit. Die App
// bekommt ihre Umgebung aber erst über docker-compose beim Start — die
// Allowlist wäre in der Middleware also leer bzw. auf den Build-Wert
// eingefroren (fail-closed, aber unbrauchbar). Die Middleware kümmert sich
// deshalb nur um "eingeloggt ja/nein", die eigentliche Allowlist prüft
// requireDeveloper() serverseitig in der Node-Runtime.

import { requireSession, AccessError } from "@/lib/access";

// Zerlegt "a@x.ch, B@Y.ch" in ["a@x.ch", "b@y.ch"]. Leere Einträge (doppelte
// Kommas, Komma am Ende) fallen raus.
export function parseDeveloperEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

// Fail-closed: ohne gesetzte (oder mit leerer) DEVELOPER_EMAILS kommt niemand
// rein. Verglichen wird auf Gleichheit, nicht auf "enthält" — sonst käme
// "xnicclerici@gmail.com" bei einem Eintrag "nicclerici@gmail.com" durch.
export function isDeveloperEmail(
  email: string | null | undefined,
  raw: string | null | undefined = process.env.DEVELOPER_EMAILS
): boolean {
  const allowed = parseDeveloperEmails(raw);
  if (allowed.length === 0) return false;
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return allowed.includes(normalized);
}

export interface DeveloperContext {
  userId: string;
  email: string;
}

// Wirft 404 statt 403, wenn die Session zwar gültig, die E-Mail aber nicht auf
// der Allowlist ist: ein 403 würde bestätigen, dass es unter /dev überhaupt
// etwas gibt. Ohne Session bleibt es bei 401 (requireSession()), damit sich
// der normale Login-Redirect wie bei jeder anderen Seite verhält.
export async function requireDeveloper(): Promise<DeveloperContext> {
  const session = await requireSession();
  const userId = (session.user as any)?.id;
  const email = (session.user as any)?.email;
  if (!userId || !isDeveloperEmail(email)) throw new AccessError(404, "Not Found");
  return { userId, email };
}
