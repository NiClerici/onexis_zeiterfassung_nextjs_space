export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { AccessError } from "@/lib/access";
import { requireDeveloper } from "@/lib/dev-access";
import { createDevPasswordResetLink, DevActionError } from "@/lib/dev-actions";
import { logError } from "@/lib/error-log";

// Löst BETRIEB.md Punkt 5 ("OPTIONAL: Passwort zurücksetzen ohne Mail"):
// ohne SMTP kommt ein Nutzer, der sein Passwort vergisst, sonst gar nicht
// mehr rein. Authentifiziert auf requireDeveloper() beschränkt — bewusst
// keine generische Antwort/Rate-Limit wie bei der öffentlichen
// forgot-password-Route nötig, siehe lib/dev-actions.ts.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { email } = await requireDeveloper();
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

    const resetUrl = await createDevPasswordResetLink(params.id, email, baseUrl);
    return NextResponse.json({ success: true, resetUrl });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof DevActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST dev/users/[id]/reset-link error:", error);
    await logError("POST /api/dev/users/[id]/reset-link", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
