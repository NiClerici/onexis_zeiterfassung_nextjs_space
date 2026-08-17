export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";

export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const payouts = await prisma.overtimePayout.findMany({
      where: { userId, orgId },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({ payouts });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET overtime-payouts error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req.json();
    const { date, hours, note } = body;

    if (!date || !hours || typeof hours !== "number" || hours <= 0) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const payout = await prisma.overtimePayout.create({
      data: {
        userId,
        orgId,
        date: new Date(date),
        hours: Math.max(0, Math.min(9999, hours)),
        note: note?.trim() || null,
      },
    });

    return NextResponse.json({ payout });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST overtime-payouts error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req.json();
    const { id } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.overtimePayout.findFirst({ where: { id, userId, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.overtimePayout.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE overtime-payouts error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
