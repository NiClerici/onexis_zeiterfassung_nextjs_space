export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { AccessError } from "@/lib/access";
import { requireDeveloper } from "@/lib/dev-access";
import { changeOrgPlan, DevActionError } from "@/lib/dev-actions";
import { logError } from "@/lib/error-log";

// Ersetzt "npx tsx --require dotenv/config scripts/set-plan.ts <slug> <plan>"
// — bisher der einzige Weg ausser direktem SQL (siehe scripts/set-plan.ts).
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  try {
    const { email } = await requireDeveloper();
    const body = await req?.json?.().catch(() => ({}));
    const plan = body?.plan;
    if (!plan || typeof plan !== "string") {
      return NextResponse.json({ error: "plan erforderlich" }, { status: 400 });
    }

    const updated = await changeOrgPlan(params.slug, plan, email);
    return NextResponse.json({ success: true, plan: updated.plan, trialEndsAt: updated.trialEndsAt });
  } catch (error: any) {
    // requireDeveloper() liefert 404 statt 403 für nicht gelistete
    // E-Mails (lib/dev-access.ts) — Existenz von /api/dev nicht bestätigen.
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof DevActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST dev/orgs/[slug]/plan error:", error);
    await logError("POST /api/dev/orgs/[slug]/plan", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
