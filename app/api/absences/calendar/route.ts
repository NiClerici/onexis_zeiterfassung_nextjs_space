export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, listVisibleUserIds, AccessError } from "@/lib/access";
import { parseExportRange } from "@/lib/export-helpers";

// Ab welchem Anteil GLEICHZEITIG abwesender, sichtbarer Mitglieder ein Tag
// als Warnung markiert wird (MIGRATION.md Punkt 9: "Warnung bei zu vielen
// gleichzeitig Abwesenden"). Dokumentierte, aber willkürliche Praxis-
// Schwelle — kein Gesetzeswert, analog zu den ArG-Praxis-Konstanten in 6d
// und dem Prognosefenster in Punkt 8. Ein Anteil statt einer festen Zahl,
// damit die Schwelle für ein 5-köpfiges Team genauso sinnvoll greift wie
// für ein 50-köpfiges.
const WARNING_THRESHOLD = 0.3;

const ABSENCE_TYPES = ["ferien", "krank", "militaer", "unbezahlt"];

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Team-Kalender mit Abwesenheiten (MIGRATION.md Punkt 9, letzter Satz) —
// bewusst eine TAGESLISTE statt eines vollen Monatsrasters: eine
// Listenansicht "wer ist wann abwesend" deckt den geforderten Zweck (auf
// einen Blick sehen, ob zu viele gleichzeitig fehlen) genauso ab wie ein
// Grid, ohne die Komplexität des persönlichen Kalenders (app/(app)/
// calendar/page.tsx) für eine Team-Übersicht zu duplizieren. Nur Tage MIT
// mindestens einer Abwesenheit werden zurückgegeben.
export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, role } = ctx;
    requireRole(role, ["owner", "admin", "manager"]);

    const url = new URL(req.url);
    const { startDate, endDate } = parseExportRange(url);

    const visibleUserIds = await listVisibleUserIds(ctx);
    const memberships = await prisma.membership.findMany({
      where: { orgId, status: "aktiv", ...(visibleUserIds ? { userId: { in: visibleUserIds } } : {}) },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    const nameByUserId = new Map(memberships.map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`]));
    const teamSize = memberships.length;

    const entries = await prisma.timeEntry.findMany({
      where: {
        orgId,
        deletedAt: null,
        type: { in: ABSENCE_TYPES },
        userId: { in: memberships.map((m) => m.userId) },
        date: { gte: startDate, lte: endDate },
      },
      select: { userId: true, date: true, type: true },
      orderBy: { date: "asc" },
    });

    const byDay = new Map<string, Array<{ userId: string; name: string; type: string }>>();
    for (const e of entries) {
      const key = dateKey(new Date(e.date));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push({ userId: e.userId, name: nameByUserId.get(e.userId) ?? "?", type: e.type });
    }

    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, absent]) => ({
        date,
        absent,
        // Auf Basis der TATSÄCHLICHEN Teamgrösse — bei teamSize=0 (kann bei
        // einem manager ohne Berichte vorkommen) keine Division durch 0.
        warning: teamSize > 0 && absent.length / teamSize >= WARNING_THRESHOLD,
      }));

    return NextResponse.json({ days, teamSize, warningThreshold: WARNING_THRESHOLD });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET absences/calendar error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
