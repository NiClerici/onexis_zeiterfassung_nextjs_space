// Abstraktion für Plan-/Nutzerlimiten-/Trial-Logik (MIGRATION.md Punkt 12).
// Implementierung vorerst rein manuell (keine Zahlungsanbieter-Anbindung)
// — das Interface existiert trotzdem schon jetzt, damit ein späterer
// echter Billing-Anbieter (Stripe o.ä.) nur eine neue Implementierung
// dieses Interfaces braucht, ohne Aufrufer-Code (middleware.ts,
// /api/invitations) anzufassen.
//
// Die reinen Regeln (isTrialExpired, PLAN_LIMITS) leben in
// lib/billing-rules.ts, nicht hier — diese Datei importiert Prisma und
// darf deshalb nie von middleware.ts (Edge-Runtime) oder einer
// "use client"-Komponente importiert werden (Prisma Client würde sonst
// ins Browser-Bundle gezogen). Re-exportiert sie trotzdem für Aufrufer,
// die ohnehin schon serverseitig sind (z.B. API-Routen).

import { prisma } from "@/lib/db";
import { isTrialExpired, PLAN_LIMITS, type Plan } from "@/lib/billing-rules";

export { isTrialExpired, PLAN_LIMITS, type Plan };

export interface OrgBillingInfo {
  plan: Plan;
  trialEndsAt: Date | null;
}

export interface UserLimitCheck {
  withinLimit: boolean;
  currentCount: number;
  maxUsers: number | null;
}

export interface BillingProvider {
  getOrgBillingInfo(orgId: string): Promise<OrgBillingInfo>;
  isReadOnly(info: OrgBillingInfo): boolean;
  checkUserLimit(orgId: string): Promise<UserLimitCheck>;
}

class ManualBillingProvider implements BillingProvider {
  async getOrgBillingInfo(orgId: string): Promise<OrgBillingInfo> {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    return { plan: org.plan as Plan, trialEndsAt: org.trialEndsAt };
  }

  isReadOnly(info: OrgBillingInfo): boolean {
    return isTrialExpired(info.plan, info.trialEndsAt);
  }

  async checkUserLimit(orgId: string): Promise<UserLimitCheck> {
    const info = await this.getOrgBillingInfo(orgId);
    const maxUsers = PLAN_LIMITS[info.plan]?.maxUsers ?? null;
    // Nur aktive Mitgliedschaften zählen fürs Limit — deaktivierte (Punkt
    // 4c) belegen keinen "Platz" mehr.
    const currentCount = await prisma.membership.count({ where: { orgId, status: "aktiv" } });
    return { withinLimit: maxUsers === null || currentCount < maxUsers, currentCount, maxUsers };
  }
}

export const billing: BillingProvider = new ManualBillingProvider();
