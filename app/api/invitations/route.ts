export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { hashToken, generateToken } from "@/lib/token";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { billing } from "@/lib/billing";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage
const INVITABLE_ROLES = ["admin", "manager", "member"]; // owner wird nie eingeladen

// Nur admin/owner dürfen einladen und die Einladungsliste sehen — sie ist
// Teil der Mitgliederverwaltung, nicht des allgemeinen Team-Überblicks
// (Punkt 8 gibt manager dort eine eigene, engere Sicht).
export async function GET() {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const invitations = await prisma.invitation.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    return NextResponse.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        status: i.usedAt ? "angenommen" : i.expiresAt.getTime() < now ? "abgelaufen" : "ausstehend",
      })),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET invitations error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId, userId, role: actingRole } = await requireOrg();
    requireRole(actingRole, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const email = (body?.email ?? "").trim().toLowerCase();
    const role = body?.role ?? "member";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Ungültige E-Mail" }, { status: 400 });
    }
    if (!INVITABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: "Ungültige Rolle" }, { status: 400 });
    }

    // Schon Mitglied dieser Organisation?
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId, userId: existingUser.id } },
      });
      if (existingMembership) {
        return NextResponse.json({ error: "Diese Person ist bereits Mitglied der Organisation" }, { status: 409 });
      }
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return NextResponse.json({ error: "Organisation nicht gefunden" }, { status: 404 });

    // Nutzerlimit des Plans (MIGRATION.md Punkt 12, lib/billing.ts) — bewusst
    // beim Einladen geprüft, nicht erst bei der Annahme: verhindert, dass
    // mehr offene Einladungen verschickt werden, als der Plan noch Plätze
    // hat. Vereinfachung: mehrere gleichzeitig offene Einladungen könnten
    // theoretisch in Summe noch über das Limit hinaus angenommen werden
    // (keine zweite Prüfung beim Annehmen) — für die vorerst rein manuelle
    // Implementierung bewusst nicht weiter verschärft.
    const limitCheck = await billing.checkUserLimit(orgId);
    if (!limitCheck.withinLimit) {
      return NextResponse.json(
        { error: `Nutzerlimit erreicht (${limitCheck.currentCount}/${limitCheck.maxUsers} für den ${org.plan}-Plan). Bitte Plan upgraden.` },
        { status: 403 }
      );
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    await prisma.$transaction([
      // Vorherige offene Einladungen an dieselbe E-Mail in dieser Organisation
      // entwerten — sonst blieben mehrere gültige Links parallel im Umlauf.
      prisma.invitation.updateMany({
        where: { orgId, email, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.invitation.create({
        data: { orgId, email, role, tokenHash, invitedByUserId: userId, expiresAt },
      }),
    ]);

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const inviteUrl = `${baseUrl}/invite?token=${rawToken}`;
    await sendMail({
      to: email,
      subject: `Einladung zu ${org.name} — ONEXIS Zeiterfassung`,
      text:
        `Du wurdest eingeladen, der Organisation "${org.name}" auf ONEXIS Zeiterfassung beizutreten.\n\n` +
        `Der folgende Link ist 7 Tage gültig und kann nur einmal verwendet werden:\n\n${inviteUrl}\n\n` +
        `Falls du das nicht erwartet hast, kannst du diese E-Mail ignorieren.`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST invitations error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.invitation.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.invitation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE invitations error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
