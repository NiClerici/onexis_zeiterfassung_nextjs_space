// Rate-Limiting für /api/auth/* in der DB (Tabelle LoginAttempt), nicht im
// Speicher — die App läuft potenziell mehrfach (mehrere Next.js-Instanzen
// hinter einem Load Balancer), ein In-Memory-Zähler wäre pro Instanz getrennt
// und damit wirkungslos.
//
// Regel: max. 10 Fehlversuche pro E-Mail UND pro IP in einem rollierenden
// 15-Minuten-Fenster. Sobald einer der beiden Zähler die Grenze erreicht,
// bleibt die Sperre bestehen, bis genug Versuche aus dem Fenster gefallen
// sind — kein separates "gesperrt bis"-Feld nötig.

import { prisma } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export type RateLimitAction = "login" | "forgot-password" | "reset-password" | "invitation-accept";

// Liest die Client-IP aus den üblichen Reverse-Proxy-Headern (x-forwarded-for,
// x-real-ip). Ohne Proxy davor (z.B. `next dev` ohne Caddy) liefern beide
// nichts — dann fällt die IP-Bucket auf "unknown" zurück und der Schutz wirkt
// in diesem Fall nur noch über die E-Mail-Bucket. Für den Produktivbetrieb
// hinter dem in Punkt 11 geplanten Caddy-Reverse-Proxy ist x-forwarded-for
// gesetzt.
export function getClientIp(req: { headers?: Headers | Record<string, string | string[] | undefined> } | null | undefined): string {
  const headers = req?.headers;
  if (!headers) return "unknown";
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers)?.get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const v = (headers as Record<string, string | string[] | undefined>)?.[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const forwarded = get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  const real = get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// onlyFailures=true (Default, passt für "login"): erfolgreiche Versuche lösen
// keine Sperre aus. Für "forgot-password"/"reset-password" gibt es kein
// richtig/falsch — dort zählt jeder Versuch, sonst wäre Fluten mit gültigen
// E-Mails ungebremst möglich.
export async function isRateLimited(
  action: RateLimitAction,
  email: string,
  ip: string,
  opts?: { onlyFailures?: boolean }
): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const onlyFailures = opts?.onlyFailures ?? true;
  const successFilter = onlyFailures ? { success: false } : {};

  const [byEmail, byIp] = await Promise.all([
    email
      ? prisma.loginAttempt.count({ where: { action, email, createdAt: { gte: since }, ...successFilter } })
      : Promise.resolve(0),
    prisma.loginAttempt.count({ where: { action, ip, createdAt: { gte: since }, ...successFilter } }),
  ]);

  return byEmail >= MAX_ATTEMPTS || byIp >= MAX_ATTEMPTS;
}

export async function recordAttempt(action: RateLimitAction, email: string, ip: string, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { action, email: email ?? "", ip, success } });
}
