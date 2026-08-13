export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { getClientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { hashToken } from "@/lib/token";

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { token, newPassword } = body ?? {};
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Ungültiger Link" }, { status: 400 });
    }

    const ip = getClientIp(req);
    // Der Token selbst ist 32 zufällige Bytes (praktisch nicht erratbar) —
    // das Rate-Limit hier ist eine zusätzliche Schutzschicht, keine primäre.
    if (await isRateLimited("reset-password", "", ip, { onlyFailures: false })) {
      return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429 });
    }
    await recordAttempt("reset-password", "", ip, true);

    const passwordCheck = checkPasswordPolicy(newPassword);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "Link ungültig oder abgelaufen" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword, mustSetPassword: false },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Alle anderen noch offenen Reset-Links für diesen Nutzer entwerten —
      // sonst bliebe ein zweiter, älterer Link nach einem erneuten Request
      // weiterhin gültig.
      prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null, id: { not: resetToken.id } },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("reset-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
