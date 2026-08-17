export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { generateHolidaysForYear } from "@/lib/holidays";

function parseDateYMD(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// Jedes Org-Mitglied darf die Feiertagsliste lesen (wird für Kalender/Export/
// Analytics gebraucht); nur admin/owner dürfen sie ändern (siehe POST/DELETE).
export async function GET(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const url = new URL(req.url);
    const yearParam = url?.searchParams?.get?.("year");
    const year = yearParam ? parseInt(yearParam) : null;

    const holidays = await prisma.holiday.findMany({
      where: year
        ? { orgId, date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }
        : { orgId },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({
      holidays: holidays.map((h) => ({
        id: h.id,
        date: h.date.toISOString().split("T")[0],
        name: h.name,
        canton: h.canton,
        halfDay: h.halfDay,
      })),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET holidays error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Zwei Modi: { generateYear, canton? } erzeugt den Schweizer Basissatz (+
// optional kantonale Feiertage) für ein Jahr aus lib/holidays.ts; alles
// andere legt einen einzelnen, manuell erfassten Feiertag an ("ergänzbar",
// MIGRATION.md Punkt 6c).
export async function POST(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));

    if (body?.generateYear !== undefined) {
      const year = parseInt(body.generateYear);
      if (!year || year < 2000 || year > 2100) {
        return NextResponse.json({ error: "Ungültiges Jahr" }, { status: 400 });
      }
      const canton = typeof body?.canton === "string" && body.canton.trim() ? body.canton.trim().toUpperCase() : null;
      const defs = generateHolidaysForYear(year, canton);

      const result = await prisma.holiday.createMany({
        data: defs.map((d) => ({ orgId, date: new Date(`${d.date}T00:00:00.000Z`), name: d.name, canton: d.canton, halfDay: d.halfDay })),
        skipDuplicates: true,
      });

      return NextResponse.json({ success: true, created: result.count, total: defs.length });
    }

    const { date, name, halfDay, canton } = body ?? {};
    const parsedDate = parseDateYMD(date);
    if (!parsedDate) return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });
    }

    const holiday = await prisma.holiday.create({
      data: {
        orgId,
        date: parsedDate,
        name: name.trim(),
        canton: typeof canton === "string" && canton.trim() ? canton.trim().toUpperCase() : null,
        halfDay: Boolean(halfDay),
      },
    });

    return NextResponse.json({ holiday });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Unique-Constraint (orgId, date, name) — derselbe Feiertag existiert bereits.
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Dieser Feiertag existiert bereits" }, { status: 409 });
    }
    console.error("POST holidays error:", error);
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

    const existing = await prisma.holiday.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.holiday.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE holidays error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
