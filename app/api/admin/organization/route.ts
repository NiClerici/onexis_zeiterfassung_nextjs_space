export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { logError } from "@/lib/error-log";

// Minimale Org-Stammdaten für die /admin/legal-Seite (MIGRATION.md
// Punkt 12) — u.a. für die Tippen-zum-Bestätigen-Löschbestätigung, ohne
// dafür den vollen (teuren) Organisationsexport laden zu müssen.
export async function GET() {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return NextResponse.json({ error: "Organisation nicht gefunden" }, { status: 404 });

    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      trialEndsAt: org.trialEndsAt,
      warnPauseZuKurz: org.warnPauseZuKurz,
      warnSonntagsarbeit: org.warnSonntagsarbeit,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET organization error:", error);
    await logError("GET /api/admin/organization", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Org-weite Ein-/Ausschalter für die nicht-blockierenden ArG-Warnungen im
// Kalender (lib/compliance.ts ComplianceOptions) — analog zu PUT
// /api/admin/team, nur owner/admin dürfen das ändern.
export async function PUT(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const { warnPauseZuKurz, warnSonntagsarbeit } = body ?? {};

    const updateData: any = {};
    if (warnPauseZuKurz !== undefined) {
      if (typeof warnPauseZuKurz !== "boolean") return NextResponse.json({ error: "Ungültiger Wert für warnPauseZuKurz" }, { status: 400 });
      updateData.warnPauseZuKurz = warnPauseZuKurz;
    }
    if (warnSonntagsarbeit !== undefined) {
      if (typeof warnSonntagsarbeit !== "boolean") return NextResponse.json({ error: "Ungültiger Wert für warnSonntagsarbeit" }, { status: 400 });
      updateData.warnSonntagsarbeit = warnSonntagsarbeit;
    }

    if (Object.keys(updateData).length === 0) return NextResponse.json({ error: "Keine Änderung übergeben" }, { status: 400 });

    await prisma.organization.update({ where: { id: orgId }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PUT organization error:", error);
    await logError("PUT /api/admin/organization", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Vollständige Löschung einer Organisation auf Knopfdruck (MIGRATION.md
// Punkt 12) — die schwerwiegendste Aktion in dieser App, deshalb strenger
// als alle übrigen admin-Aktionen: nur owner (nicht admin), und nur mit
// exakter Bestätigung des Organisationsnamens (Tippen-zum-Bestätigen,
// serverseitig geprüft, nicht nur clientseitig).
//
// Die meisten Modelle haben eine kaskadierende Relation auf Organization
// (Membership, TimeEntry, Customer, Project, PensumChange,
// OvertimePayout, Invitation, Holiday, MonthLock, AbsenceRequest) und
// werden von Prisma automatisch mitgelöscht. TimeEntryAudit und
// MonthLockAudit haben BEWUSST keine Relation (siehe deren Modell-
// Kommentare in schema.prisma — der Audit-Trail soll auch ein gelöschtes
// TimeEntry/einen gelöschten Account überleben) und müssen deshalb hier
// explizit mitgelöscht werden, sonst blieben verwaiste Zeilen mit
// personenbezogenen Daten (changedBy, alte/neue Feldwerte) zurück — bei
// einer vollständigen Löschung wäre das falsch.
export async function DELETE(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner"]);

    const body = await req?.json?.().catch(() => ({}));
    const { confirmName } = body ?? {};

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return NextResponse.json({ error: "Organisation nicht gefunden" }, { status: 404 });

    if (confirmName !== org.name) {
      return NextResponse.json({ error: "Bestätigungsname stimmt nicht überein" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.timeEntryAudit.deleteMany({ where: { orgId } }),
      prisma.monthLockAudit.deleteMany({ where: { orgId } }),
      prisma.organization.delete({ where: { id: orgId } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE organization error:", error);
    await logError("DELETE /api/admin/organization", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
