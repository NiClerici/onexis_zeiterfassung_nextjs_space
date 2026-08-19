// Setzt den Plan einer Organisation (MIGRATION.md Punkt 12). Es gibt dafür
// bewusst keine UI (lib/billing.ts ist eine reine manuelle Implementierung,
// kein echter Zahlungsanbieter) — dieses Script ist der einzige Weg, ausser
// direktem SQL.
//
// Nutzung:
//   npx tsx --require dotenv/config scripts/set-plan.ts <org-slug> <trial|starter|pro>
//
// Bei einem bezahlten Plan (starter/pro) wird trialEndsAt zusätzlich auf
// null gesetzt — isTrialExpired() in lib/billing-rules.ts greift ohnehin nur
// bei plan === "trial", aber ein stehen gebliebenes Datum wäre irreführend.
//
// Wichtig: das JWT eines eingeloggten Nutzers trägt plan/trialEndsAt bis zu
// einer Stunde nach (lib/auth-options.ts, jwt-Callback validiert stündlich
// gegen die DB) bzw. bis zum nächsten Login/Logout — der Banner in
// app/(app)/layout.tsx verschwindet also nicht zwingend sofort.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VALID_PLANS = ["trial", "starter", "pro"] as const;
type Plan = (typeof VALID_PLANS)[number];

async function main() {
  const [slug, planArg] = process.argv.slice(2);

  if (!slug || !planArg) {
    console.error("Nutzung: npx tsx --require dotenv/config scripts/set-plan.ts <org-slug> <trial|starter|pro>");
    process.exit(1);
  }

  if (!VALID_PLANS.includes(planArg as Plan)) {
    console.error(`Ungültiger Plan "${planArg}". Erlaubt: ${VALID_PLANS.join(", ")}`);
    process.exit(1);
  }
  const plan = planArg as Plan;

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    console.error(`Keine Organisation mit slug "${slug}" gefunden.`);
    process.exit(1);
  }

  console.log(`Vorher: ${org.name} (${org.slug}) — plan=${org.plan}, trialEndsAt=${org.trialEndsAt?.toISOString() ?? "null"}`);

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: {
      plan,
      trialEndsAt: plan === "trial" ? org.trialEndsAt : null,
    },
  });

  console.log(`Nachher: ${updated.name} (${updated.slug}) — plan=${updated.plan}, trialEndsAt=${updated.trialEndsAt?.toISOString() ?? "null"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
