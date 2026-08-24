// Admin-Aktionen der Developer-Übersicht (/dev) — ersetzt die bisherigen
// SSH-Handgriffe scripts/set-plan.ts und direktes SQL für Passwort-Resets
// (BETRIEB.md Punkt 5: ohne SMTP kommt ein Nutzer, der sein Passwort
// vergisst, sonst gar nicht mehr rein).
//
// Jede Funktion hier verändert fremde Mandantendaten ohne deren Zutun —
// deshalb schreibt jede Aktion, ausnahmslos, eine DevAction-Zeile
// (prisma/schema.prisma). Die aufrufenden API-Routen (app/api/dev/**)
// prüfen requireDeveloper() VOR jedem Aufruf hier; diese Funktionen selbst
// prüfen keine Berechtigung, sie kapseln nur die Fachlogik.

import { prisma } from "@/lib/db";
import { hashToken, generateToken } from "@/lib/token";
import { PLAN_LIMITS, type Plan } from "@/lib/billing-rules";

export class DevActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const VALID_PLANS = Object.keys(PLAN_LIMITS) as Plan[];

async function recordDevAction(performedBy: string, action: string, targetType: string, targetId: string, detail?: string) {
  await prisma.devAction.create({ data: { performedBy, action, targetType, targetId, detail: detail ?? null } });
}

// --- Plan wechseln -----------------------------------------------------
// 1:1 die Logik aus scripts/set-plan.ts, jetzt aus der App heraus aufrufbar
// statt nur per "npx tsx --require dotenv/config scripts/set-plan.ts".
//
// Wichtig (siehe scripts/set-plan.ts, dortiger Kommentar): das JWT eines
// eingeloggten Nutzers trägt plan/trialEndsAt bis zu einer Stunde nach
// (lib/auth-options.ts, PLAN_TTL_MS) bzw. bis zum nächsten Login/Logout —
// der Trial-Banner beim betroffenen Nutzer verschwindet nach einem
// Planwechsel also nicht zwingend sofort. Die aufrufende Route zeigt
// diesen Hinweis an, hier nur die reine Fachlogik.
export async function changeOrgPlan(orgSlug: string, newPlan: string, performedBy: string) {
  if (!VALID_PLANS.includes(newPlan as Plan)) {
    throw new DevActionError(400, `Ungültiger Plan "${newPlan}". Erlaubt: ${VALID_PLANS.join(", ")}`);
  }
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new DevActionError(404, `Keine Organisation mit Slug "${orgSlug}" gefunden.`);

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { plan: newPlan, trialEndsAt: newPlan === "trial" ? org.trialEndsAt : null },
  });

  await recordDevAction(performedBy, "plan.change", "organization", org.id, `${org.plan} -> ${newPlan}`);
  return updated;
}

// --- Trial verlängern ---------------------------------------------------
// Nur für Organisationen, die aktuell auf "trial" stehen — ein bezahlter
// Plan hat kein trialEndsAt, das eine Verlängerung sinnvoll verändern
// könnte (isTrialExpired() in lib/billing-rules.ts ignoriert das Feld dort
// ohnehin). Verlängert ab dem SPÄTEREN von "jetzt" und dem bisherigen
// trialEndsAt — bei einem bereits abgelaufenen Trial zählen die Tage sonst
// ab einem Datum in der Vergangenheit und der Trial bliebe abgelaufen.
export async function extendOrgTrial(orgSlug: string, days: number, performedBy: string) {
  if (!Number.isFinite(days) || days <= 0) {
    throw new DevActionError(400, "days muss eine positive Zahl sein.");
  }
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new DevActionError(404, `Keine Organisation mit Slug "${orgSlug}" gefunden.`);
  if (org.plan !== "trial") {
    throw new DevActionError(409, `Organisation "${org.name}" ist nicht im Trial (aktueller Plan: ${org.plan}).`);
  }

  const now = Date.now();
  const base = org.trialEndsAt && org.trialEndsAt.getTime() > now ? org.trialEndsAt.getTime() : now;
  const newTrialEndsAt = new Date(base + days * 24 * 60 * 60 * 1000);

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { trialEndsAt: newTrialEndsAt },
  });

  await recordDevAction(
    performedBy,
    "trial.extend",
    "organization",
    org.id,
    `+${days}d (${org.trialEndsAt?.toISOString() ?? "kein Datum"} -> ${newTrialEndsAt.toISOString()})`
  );
  return updated;
}

// --- Passwort-Reset-Link erzeugen ---------------------------------------
// Exakt das Muster aus app/api/auth/forgot-password/route.ts, hier aber
// AUTHENTIFIZIERT (nur requireDeveloper()) statt öffentlich — deshalb
// bewusst KEINE generische Antwort und KEIN Rate-Limit nötig: das
// Enumerations-Risiko der öffentlichen Route (lib/mail.ts-Kommentar,
// "Nicht für /api/auth/forgot-password") gilt hier nicht, der Aufrufer ist
// bereits als Betreiber authentifiziert.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 Minuten, wie forgot-password

export async function createDevPasswordResetLink(userId: string, performedBy: string, baseUrl: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new DevActionError(404, "Nutzer nicht gefunden.");

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  await recordDevAction(performedBy, "password-reset-link", "user", user.id, user.email);
  return `${baseUrl}/reset-password?token=${rawToken}`;
}
