export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, canSeeUser, AccessError } from "@/lib/access";
import { logError } from "@/lib/error-log";

function parseYearMonth(body: any): { userId: string; year: number; month: number } | null {
  const userId = body?.userId;
  const year = parseInt(body?.year, 10);
  const month = parseInt(body?.month, 10);
  if (!userId || typeof userId !== "string") return null;
  if (!year || year < 2000 || year > 2100) return null;
  if (!month || month < 1 || month > 12) return null;
  return { userId, year, month };
}

// Jedes Org-Mitglied darf den eigenen Sperrstatus lesen (Kalender-Anzeige);
// ein fremdes userId nur, wer laut canSeeUser darauf zugreifen darf.
// Sperren/Entsperren bleibt admin/owner vorbehalten (POST/DELETE unten).
export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, userId: ownUserId } = ctx;

    const url = new URL(req.url);
    const targetUserId = url?.searchParams?.get?.("userId") || ownUserId;
    const yearParam = url?.searchParams?.get?.("year");
    const year = yearParam ? parseInt(yearParam, 10) : null;

    if (targetUserId !== ownUserId && !(await canSeeUser(ctx, targetUserId))) {
      throw new AccessError(403, "Forbidden");
    }

    const locks = await prisma.monthLock.findMany({
      where: { orgId, userId: targetUserId, ...(year ? { year } : {}) },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    return NextResponse.json({
      locks: locks.map((l) => ({
        id: l.id,
        userId: l.userId,
        year: l.year,
        month: l.month,
        lockedAt: l.lockedAt.toISOString(),
        lockedBy: l.lockedBy,
      })),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET month-locks error:", error);
    await logError("GET /api/month-locks", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Sperrt einen Monat für einen Nutzer. Idempotent: ist der Monat bereits
// gesperrt, wird die bestehende Zeile zurückgegeben statt eine zweite
// MonthLockAudit-"locked"-Zeile zu erzeugen.
export async function POST(req: Request) {
  try {
    const { orgId, userId: actorId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const parsed = parseYearMonth(body);
    if (!parsed) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
    const { userId, year, month } = parsed;

    const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const existing = await prisma.monthLock.findUnique({
      where: { orgId_userId_year_month: { orgId, userId, year, month } },
    });
    if (existing) return NextResponse.json({ lock: existing, alreadyLocked: true });

    const [lock] = await prisma.$transaction([
      prisma.monthLock.create({ data: { orgId, userId, year, month, lockedBy: actorId } }),
      prisma.monthLockAudit.create({ data: { orgId, userId, year, month, action: "locked", performedBy: actorId } }),
    ]);

    return NextResponse.json({ lock });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST month-locks error:", error);
    await logError("POST /api/month-locks", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Entsperrt einen Monat — löscht die MonthLock-Zeile, behält den Vorgang
// aber unveränderlich in MonthLockAudit (MIGRATION.md Punkt 6e: "was im
// Audit-Trail landet").
export async function DELETE(req: Request) {
  try {
    const { orgId, userId: actorId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const parsed = parseYearMonth(body);
    if (!parsed) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
    const { userId, year, month } = parsed;

    const existing = await prisma.monthLock.findUnique({
      where: { orgId_userId_year_month: { orgId, userId, year, month } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction([
      prisma.monthLock.delete({ where: { id: existing.id } }),
      prisma.monthLockAudit.create({ data: { orgId, userId, year, month, action: "unlocked", performedBy: actorId } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE month-locks error:", error);
    await logError("DELETE /api/month-locks", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
