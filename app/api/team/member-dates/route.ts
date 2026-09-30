export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, assertCanManageMember, AccessError } from "@/lib/access";
import { parseDateYMD } from "@/lib/dates";
import { logError } from "@/lib/error-log";

// Eintrittsdatum ändern — bisher nur über die volle Mitgliederverwaltung
// (PUT /api/admin/team, owner/admin-only, dort auch Rolle/Status/
// Vorgesetzte Person/Pensum/Austrittsdatum). Diese schmalere Route erlaubt
// NUR das Eintrittsdatum und öffnet das dafür auch für manager, aber
// beschränkt auf ihr eigenes Team (assertCanManageMember, dieselbe Regel
// wie beim Monatsabschluss) — nie ein beliebiges Mitglied der Organisation,
// und nie Rolle/Status/Pensum/Austritt, die bleiben admin/owner-only in
// PUT /api/admin/team.
//
// Bewusst kein separates Startdatum-Eingabefeld mehr: nach aussen gibt es
// nur EIN Datum. buildProfil() (lib/export-helpers.ts effectiveEntryDate)
// UND die Sichtbarkeits-Filter (lib/access.ts membershipActiveInPeriod)
// lesen startDate, sofern gesetzt, sonst entryDate — und diese Route
// schreibt deshalb bei jeder Änderung BEIDE Spalten auf denselben Wert.
// Ohne das liefe man exakt in den Produktionsfund zurück: ein rein
// technisches entryDate, das vom echten, separat gepflegten startDate
// abweicht, je nachdem welches Feld gerade zuletzt angefasst wurde.
export async function PUT(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, role } = ctx;
    requireRole(role, ["owner", "admin", "manager"]);

    const body = await req?.json?.().catch(() => ({}));
    const targetUserId = body?.userId;
    if (!targetUserId || typeof targetUserId !== "string") {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    await assertCanManageMember(ctx, targetUserId);

    const target = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = parseDateYMD(body?.entryDate);
    if (!parsed) return NextResponse.json({ error: "Ungültiges Eintrittsdatum" }, { status: 400 });

    const updated = await prisma.membership.update({
      where: { id: target.id },
      data: { entryDate: parsed, startDate: parsed },
    });

    return NextResponse.json({ success: true, entryDate: updated.entryDate.toISOString(), startDate: updated.startDate?.toISOString() ?? null });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PUT team/member-dates error:", error);
    await logError("PUT /api/team/member-dates", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
