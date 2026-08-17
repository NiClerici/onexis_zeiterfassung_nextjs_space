export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, listVisibleUserIds, AccessError } from "@/lib/access";
import { parseExportRange } from "@/lib/export-helpers";
import { groupAbsenceRanges, type AbsenceEntry } from "@/lib/absence-ranges";

// Ab welchem Anteil GLEICHZEITIG abwesender, sichtbarer Mitglieder ein Tag
// als Warnung markiert wird (MIGRATION.md Punkt 9: "Warnung bei zu vielen
// gleichzeitig Abwesenden"). Dokumentierte, aber willkürliche Praxis-
// Schwelle — kein Gesetzeswert, analog zu den ArG-Praxis-Konstanten in 6d
// und dem Prognosefenster in Punkt 8. Ein Anteil statt einer festen Zahl,
// damit die Schwelle für ein 5-köpfiges Team genauso sinnvoll greift wie
// für ein 50-köpfiges.
const WARNING_THRESHOLD = 0.3;

// Absolute Untergrenze zusätzlich zum Anteil (HARDENING.md C7a): ohne sie
// löst in einem 3er-Team bereits EINE einzelne abwesende Person die
// 30%-Schwelle aus — die Warnung ist dann bedeutungslos, weil sie an
// (fast) jedem Tag mit irgendeiner Absenz aufleuchtet. Eine einzelne
// abwesende Person ist nie eine Warnung, egal wie klein das Team ist.
const WARNING_MIN_ABSENT = 2;

const ABSENCE_TYPES = ["ferien", "krank", "militaer", "unbezahlt"];

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function alleTageZwischen(start: Date, ende: Date): string[] {
  const tage: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= ende.getTime()) {
    tage.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return tage;
}

// Team-Kalender mit Abwesenheiten (MIGRATION.md Punkt 9, letzter Satz).
// Raster statt Datumsliste (HARDENING.md C7c) — Personen als Zeilen, Tage
// als Spalten, dasselbe Muster wie die Teamsicht-Heatmap (MIGRATION.md
// Punkt 8, app/api/team/route.ts): eine Ferienwoche einer Person belegt
// fünf schmale Zellen in EINER Zeile statt fünf volle Listenzeilen.
// `ranges` (lib/absence-ranges.ts, C7b) liefert zusätzlich eine
// zusammengefasste Textform ("13.–17.07. · Ferien · 5 Tage") für eine
// kompakte Übersicht neben dem Raster.
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
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
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

    const days = alleTageZwischen(startDate, endDate);

    // Pro Tag: Liste der abwesenden Personen — für die Warnschwelle je Tag.
    const absentByDay = new Map<string, Array<{ userId: string; name: string; type: string }>>();
    // Pro Person: dichte Zell-Liste über ALLE Tage des Zeitraums, ausgerichtet
    // auf `days` — genau das Muster von heatmap[].weeks in app/api/team/route.ts.
    const cellsByUser = new Map<string, Map<string, string>>();
    for (const m of memberships) cellsByUser.set(m.userId, new Map());

    for (const e of entries) {
      const key = dateKey(new Date(e.date));
      if (!absentByDay.has(key)) absentByDay.set(key, []);
      absentByDay.get(key)!.push({ userId: e.userId, name: nameByUserId.get(e.userId) ?? "?", type: e.type });
      cellsByUser.get(e.userId)?.set(key, e.type);
    }

    const dayWarning: Record<string, boolean> = {};
    for (const day of days) {
      const absent = absentByDay.get(day) ?? [];
      dayWarning[day] = teamSize > 0 && absent.length >= WARNING_MIN_ABSENT && absent.length / teamSize >= WARNING_THRESHOLD;
    }

    const members = memberships.map((m) => {
      const cells = cellsByUser.get(m.userId)!;
      return {
        userId: m.userId,
        name: nameByUserId.get(m.userId) ?? "?",
        days: days.map((d) => ({ date: d, type: cells.get(d) ?? null })),
      };
    });

    const rangeEntries: AbsenceEntry[] = entries.map((e) => ({
      userId: e.userId,
      name: nameByUserId.get(e.userId) ?? "?",
      date: dateKey(new Date(e.date)),
      type: e.type,
    }));
    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId, date: { gte: startDate, lte: endDate } } });
    const holidayDates = new Set(holidaysRaw.map((h) => dateKey(new Date(h.date))));
    const ranges = groupAbsenceRanges(rangeEntries, holidayDates);

    return NextResponse.json({
      days,
      members,
      ranges,
      dayWarning,
      teamSize,
      warningThreshold: WARNING_THRESHOLD,
      warningMinAbsent: WARNING_MIN_ABSENT,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET absences/calendar error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
