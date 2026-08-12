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

    if (!year || !month) return NextResponse.json({ customerHours: [] });

    const hours = await prisma.customerHour.findMany({
      where: { userId, year, month },
      orderBy: { customerName: "asc" },
    });

    return NextResponse.json({ customerHours: hours ?? [] });
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
    const { year, month, items } = body ?? {};

    if (!year || !month) return NextResponse.json({ error: "Missing year/month" }, { status: 400 });

    // Delete existing for this month
    await prisma.customerHour.deleteMany({ where: { userId, year, month } });

    // Create new entries
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.customerName?.trim?.() && (item?.hours ?? 0) > 0) {
          await prisma.customerHour.create({
            data: { userId, year, month, customerName: item.customerName.trim(), hours: item.hours },
          });
        }
      }
    }

    const updated = await prisma.customerHour.findMany({ where: { userId, year, month } });
    return NextResponse.json({ customerHours: updated ?? [] });
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
    const { id, customerName, hours } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customerHour.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.customerHour.update({
      where: { id },
      data: {
        customerName: customerName?.trim?.() ?? existing.customerName,
        hours: typeof hours === "number" ? hours : existing.hours,
      },
    });

    return NextResponse.json({ customerHour: updated });
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

    const existing = await prisma.customerHour.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.customerHour.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
