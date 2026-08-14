// Reine, Prisma-freie Plan-/Trial-Regeln (MIGRATION.md Punkt 12) —
// bewusst von lib/billing.ts (ManualBillingProvider, importiert Prisma)
// getrennt, damit sie an zwei Stellen sicher importierbar bleiben, die
// KEIN Prisma vertragen:
//   - middleware.ts läuft in der Next.js Edge-Runtime, die Prisma nicht
//     unterstützt.
//   - app/(app)/layout.tsx ist eine "use client"-Komponente — ein Import
//     aus lib/billing.ts würde Prisma Client (Node-only) ins
//     Browser-Bundle ziehen.
// Beide importieren deshalb ausschliesslich aus dieser Datei, nie aus
// lib/billing.ts direkt.

export type Plan = "trial" | "starter" | "pro";

// Nutzerlimiten je Plan — bewusste Platzhalter-Werte für die manuelle
// Implementierung, keine reale Preisgestaltung. null = unbegrenzt.
export const PLAN_LIMITS: Record<Plan, { maxUsers: number | null }> = {
  trial: { maxUsers: 5 },
  starter: { maxUsers: 10 },
  pro: { maxUsers: 50 },
};

// Trial ist read-only, sobald trialEndsAt in der Vergangenheit liegt.
// Bereits bezahlte Pläne (starter/pro) sind nie automatisch read-only,
// unabhängig vom (dann irrelevanten) trialEndsAt-Wert.
export function isTrialExpired(plan: string | null | undefined, trialEndsAt: Date | string | null | undefined): boolean {
  if (plan !== "trial") return false;
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() < Date.now();
}
