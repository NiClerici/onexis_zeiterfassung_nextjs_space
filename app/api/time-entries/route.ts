export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { EINTRAG_TYPEN, type EintragTyp } from "@/lib/calc";

function isValidType(type: unknown): type is EintragTyp {
  return typeof type === "string" && (EINTRAG_TYPEN as readonly string[]).includes(type);
}

// Nimmt nur "YYYY-MM-DD" (führender Teil, Rest wird ignoriert) und baut UTC-Mitternacht.
// new Date(date) auf einem vollen ISO-Datetime ohne Offset würde lokal statt UTC
// interpretiert und könnte auf einem Server mit TZ≠UTC den Tag verschieben.
function parseDateYMD(s: unknown): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const url = new URL(req.url);
    const year = parseInt(url?.searchParams?.get?.("year") ?? "0");
    const month = parseInt(url?.searchParams?.get?.("month") ?? "0");

    if (!year || !month) return NextResponse.json({ entries: [] });

    // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
    // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC den letzten Tag der Periode abschneiden.
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));

    const entries = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: [{ date: "asc" }, { von: "asc" }],
    });

    return NextResponse.json({
      entries: entries?.map?.((e: any) => ({
        id: e?.id,
        date: e?.date?.toISOString?.()?.split?.("T")?.[0] ?? "",
        type: e?.type ?? "arbeit",
        von: e?.von ?? null,
        bis: e?.bis ?? null,
        pauseMin: e?.pauseMin ?? 0,
        projekt: e?.projekt ?? null,
        notiz: e?.notiz ?? null,
        customerId: e?.customerId ?? null,
        hours: e?.hours ?? null,
      })) ?? [],
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { date, type, von, bis, pauseMin, projekt, notiz, customerId, hours } = body ?? {};

    const parsedDate = parseDateYMD(date);
    if (!parsedDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!isValidType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, userId } });
      if (!customer) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
    }

    const isArbeit = type === "arbeit";
    const clampedPause = Math.max(0, Math.min(1440, Number(pauseMin) || 0));
    const clampedHours = hours != null && hours !== "" ? Math.max(0, Math.min(24, Number(hours))) : null;

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        date: parsedDate,
        type,
        von: isArbeit ? (von || null) : null,
        bis: isArbeit ? (bis || null) : null,
        pauseMin: isArbeit ? clampedPause : 0,
        projekt: projekt?.trim?.() || null,
        notiz: notiz?.trim?.() || null,
        customerId: customerId || null,
        hours: clampedHours,
      },
    });

    return NextResponse.json({ entry });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { id, date, type, von, bis, pauseMin, projekt, notiz, customerId, hours } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let parsedDate: Date | undefined;
    if (date) {
      const p = parseDateYMD(date);
      if (!p) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      parsedDate = p;
    }
    if (type !== undefined && !isValidType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, userId } });
      if (!customer) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
    }

    const nextType: EintragTyp = isValidType(type) ? type : (existing.type as EintragTyp);
    const isArbeit = nextType === "arbeit";
    const clampedHours =
      hours !== undefined ? (hours === null || hours === "" ? null : Math.max(0, Math.min(24, Number(hours)))) : undefined;

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        date: parsedDate,
        type: nextType,
        von: isArbeit ? (von !== undefined ? von || null : existing.von) : null,
        bis: isArbeit ? (bis !== undefined ? bis || null : existing.bis) : null,
        pauseMin: isArbeit
          ? pauseMin !== undefined
            ? Math.max(0, Math.min(1440, Number(pauseMin) || 0))
            : existing.pauseMin
          : 0,
        projekt: projekt !== undefined ? projekt?.trim?.() || null : undefined,
        notiz: notiz !== undefined ? notiz?.trim?.() || null : undefined,
        customerId: customerId !== undefined ? customerId || null : undefined,
        hours: clampedHours,
      },
    });

    return NextResponse.json({ entry });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.timeEntry.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
