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

    const payouts = await prisma.overtimePayout.findMany({
      where: { userId },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({ payouts });
  } catch (error: any) {
    console.error("GET overtime-payouts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req.json();
    const { date, hours, note } = body;

    if (!date || !hours || typeof hours !== "number" || hours <= 0) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const payout = await prisma.overtimePayout.create({
      data: {
        userId,
        date: new Date(date),
        hours: Math.max(0, Math.min(9999, hours)),
        note: note?.trim() || null,
      },
    });

    return NextResponse.json({ payout });
  } catch (error: any) {
    console.error("POST overtime-payouts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req.json();
    const { id } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Verify ownership
    const existing = await prisma.overtimePayout.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.overtimePayout.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE overtime-payouts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
