export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/token";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { getClientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";

async function loadValidInvitation(token: string) {
  const tokenHash = hashToken(token);
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash }, include: { org: true } });
  if (!invitation || invitation.usedAt || invitation.expiresAt.getTime() < Date.now()) return null;
  return invitation;
}

// Öffentlich (unauthenticated) — liefert eine Vorschau für die Einladungs-
// Annahmeseite, ohne Seiteneffekte. Kein Token im Klartext in der DB, aber
// der übergebene Klartext-Token selbst ist 32 zufällige Bytes und damit
// praktisch nicht erratbar — GET hier verrät nichts Zusätzliches.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token) return NextResponse.json({ error: "Ungültiger Link" }, { status: 400 });

    const invitation = await loadValidInvitation(token);
    if (!invitation) return NextResponse.json({ error: "Link ungültig oder abgelaufen" }, { status: 400 });

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });

    return NextResponse.json({
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.org.name,
      accountExists: Boolean(existingUser),
    });
  } catch (error: any) {
    console.error("GET invitations/accept error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { token, firstName, lastName, password } = body ?? {};
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Ungültiger Link" }, { status: 400 });
    }

    const ip = getClientIp(req);
    if (await isRateLimited("invitation-accept", "", ip, { onlyFailures: false })) {
      return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429 });
    }
    await recordAttempt("invitation-accept", "", ip, true);

    const invitation = await loadValidInvitation(token);
    if (!invitation) return NextResponse.json({ error: "Link ungültig oder abgelaufen" }, { status: 400 });

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });

    // Mensch existiert schon (z.B. Mitglied einer anderen Organisation) —
    // nur die Membership ergänzen, kein neues Passwort nötig. Datenmodell aus
    // Punkt 3 sieht das ausdrücklich vor ("ein Mensch kann später in zwei
    // Organisationen sein").
    if (existingUser) {
      const alreadyMember = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId: invitation.orgId, userId: existingUser.id } },
      });
      if (alreadyMember) {
        // Einladung trotzdem entwerten, damit der Link nicht wiederverwendbar bleibt.
        await prisma.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
        return NextResponse.json({ success: true, accountExists: true });
      }

      await prisma.$transaction([
        prisma.membership.create({
          data: {
            orgId: invitation.orgId,
            userId: existingUser.id,
            role: invitation.role,
            entryDate: new Date(),
          },
        }),
        prisma.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } }),
      ]);
      return NextResponse.json({ success: true, accountExists: true });
    }

    // Neue Person: Passwort setzen, User + Membership anlegen.
    if (!firstName?.trim?.() || !lastName?.trim?.()) {
      return NextResponse.json({ error: "Vor- und Nachname erforderlich" }, { status: 400 });
    }
    const passwordCheck = checkPasswordPolicy(password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          password: hashedPassword,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          mustSetPassword: false,
          language: "de",
        },
      });
      await tx.membership.create({
        data: { orgId: invitation.orgId, userId: user.id, role: invitation.role, entryDate: new Date() },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
    });

    return NextResponse.json({ success: true, accountExists: false });
  } catch (error: any) {
    console.error("POST invitations/accept error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
