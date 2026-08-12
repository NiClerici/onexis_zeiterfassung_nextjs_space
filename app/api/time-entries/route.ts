export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const url = new URL(req.url);
    const year = parseInt(url?.searchParams?.get?.("year") ?? "0");
    const month = parseInt(url?.searchParams?.get?.("month") ?? "0");

    if (!year || !month) return NextResponse.json({ entries: [] });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const entries = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({
      entries: entries?.map?.((e: any) => ({
        id: e?.id,
        date: e?.date?.toISOString?.()?.split?.("T")?.[0] ?? "",
        hours: e?.hours ?? 0,
        type: e?.type ?? "work",
      })) ?? [],
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const VALID_TYPES = ["work", "vacation", "holiday"];

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { date, hours, type } = body ?? {};

    if (!date || isNaN(new Date(date).getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (type && !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const clampedHours = Math.max(0, Math.min(24, Number(hours) || 0));

    const existing = await prisma.timeEntry.findFirst({ where: { userId, date: new Date(date) } });
    const entry = existing
      ? await prisma.timeEntry.update({
          where: { id: existing.id },
          data: { hours: clampedHours, type: type ?? "work" },
        })
      : await prisma.timeEntry.create({
          data: { userId, date: new Date(date), hours: clampedHours, type: type ?? "work" },
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
    const { id, date, hours, type } = body ?? {};

    if (date && isNaN(new Date(date).getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (type && !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const clampedHours = Math.max(0, Math.min(24, Number(hours) || 0));

    if (id) {
      const entry = await prisma.timeEntry.update({
        where: { id, userId },
        data: { hours: clampedHours, type: type ?? "work" },
      });
      return NextResponse.json({ entry });
    }

    // Fallback to upsert by date
    const existing = await prisma.timeEntry.findFirst({ where: { userId, date: new Date(date) } });
    const entry = existing
      ? await prisma.timeEntry.update({
          where: { id: existing.id },
          data: { hours: clampedHours, type: type ?? "work" },
        })
      : await prisma.timeEntry.create({
          data: { userId, date: new Date(date), hours: clampedHours, type: type ?? "work" },
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

    await prisma.timeEntry.delete({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
