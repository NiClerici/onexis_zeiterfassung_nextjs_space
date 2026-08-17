export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { getClientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { hashToken, generateToken } from "@/lib/token";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 Minuten

// Immer dieselbe generische Antwort, unabhängig davon, ob die E-Mail
// existiert — sonst liesse sich über den Statuscode/Response-Inhalt
// enumerieren, welche E-Mail-Adressen registriert sind (genau die Lücke,
// die der alte /api/auth/forgot-code-Flow in Schritt 1 hatte).
//
// Bewusst eine FUNKTION, kein Modul-Singleton: eine NextResponse kapselt
// einen Web-Streams-Body, der nach dem ersten Versand verbraucht ist. Ein
// einmal erzeugtes Response-Objekt für mehrere Requests wiederzuverwenden
// liefert beim zweiten Aufruf einen leeren Body statt der JSON-Nachricht.
function genericResponse() {
  return NextResponse.json({
    success: true,
    message: "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen verschickt.",
  });
}

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const email = (body?.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "E-Mail erforderlich" }, { status: 400 });

    const ip = getClientIp(req);
    // Jeder Versuch zählt (kein richtig/falsch) — sonst liesse sich mit einer
    // bekannten E-Mail beliebig oft fluten.
    if (await isRateLimited("forgot-password", email, ip, { onlyFailures: false })) {
      // Auch bei Sperre generisch antworten, um nicht zu verraten, dass die
      // Sperre gerade an genau dieser E-Mail/IP hängt.
      return genericResponse();
    }
    await recordAttempt("forgot-password", email, ip, true);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      });

      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
      await sendMail({
        to: user.email,
        subject: "ONEXIS Zeiterfassung — Passwort zurücksetzen",
        text:
          `Hallo ${user.firstName},\n\n` +
          `Für dein Konto wurde ein Passwort-Reset angefordert. Der folgende Link ist ` +
          `60 Minuten gültig und kann nur einmal verwendet werden:\n\n${resetUrl}\n\n` +
          `Falls du das nicht warst, kannst du diese E-Mail ignorieren.`,
      });
    }

    return genericResponse();
  } catch (error: any) {
    console.error("forgot-password error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
