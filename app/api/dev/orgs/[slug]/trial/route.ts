export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { AccessError } from "@/lib/access";
import { requireDeveloper } from "@/lib/dev-access";
import { extendOrgTrial, DevActionError } from "@/lib/dev-actions";
import { logError } from "@/lib/error-log";

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  try {
    const { email } = await requireDeveloper();
    const body = await req?.json?.().catch(() => ({}));
    const days = Number(body?.days);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: "days muss eine positive Zahl sein" }, { status: 400 });
    }

    const updated = await extendOrgTrial(params.slug, days, email);
    return NextResponse.json({ success: true, trialEndsAt: updated.trialEndsAt });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof DevActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST dev/orgs/[slug]/trial error:", error);
    await logError("POST /api/dev/orgs/[slug]/trial", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
