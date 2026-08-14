export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { createAbsenceEntries } from "@/lib/absence-entries";

function parseDateYMD(s: string): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1]);
  const mo = parseInt(m[2]);
  const d = parseInt(m[3]);
  if (!y || !mo || !d) return null;
  // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
  // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC auf den falschen Tag verschieben.
  return new Date(Date.UTC(y, mo - 1, d));
}

export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const fromStr = body?.fromDate ?? "";
    const toStr = body?.toDate ?? "";
    const overwriteExisting = Boolean(body?.overwriteExisting ?? false);

    const fromDate = parseDateYMD(fromStr);
    const toDate = parseDateYMD(toStr);
    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }
    if (toDate < fromDate) {
      return NextResponse.json({ error: "Enddatum liegt vor Startdatum" }, { status: 400 });
    }

    const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 366) {
      return NextResponse.json({ error: "Zeitraum zu gross (max. 366 Tage)" }, { status: 400 });
    }

    // Gesperrte Monate für member read-only (MIGRATION.md Punkt 6e) — als
    // Set vorab geladen und an die gemeinsame Kernlogik (lib/absence-
    // entries.ts, MIGRATION.md Punkt 9) übergeben, die diese Tage wie einen
    // Feiertag behandelt (übersprungen statt den ganzen Aufruf abzulehnen).
    const lockedMonths = role === "member"
      ? new Set(
          (await prisma.monthLock.findMany({ where: { orgId, userId }, select: { year: true, month: true } }))
            .map((l) => `${l.year}-${l.month}`)
        )
      : new Set<string>();
    const skipDates = new Set<string>();
    if (lockedMonths.size > 0) {
      const current = new Date(fromDate);
      while (current <= toDate) {
        if (lockedMonths.has(`${current.getUTCFullYear()}-${current.getUTCMonth() + 1}`)) {
          skipDates.add(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`);
        }
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    let result;
    try {
      result = await createAbsenceEntries({ orgId, userId, changedBy: userId, fromDate, toDate, type: "ferien", overwriteExisting, skipDates });
    } catch (e: any) {
      if (e?.message === "Membership not found") return NextResponse.json({ error: "Membership not found" }, { status: 404 });
      throw e;
    }

    return NextResponse.json({
      success: true,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      totalDays: diffDays,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("bulk-vacation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
