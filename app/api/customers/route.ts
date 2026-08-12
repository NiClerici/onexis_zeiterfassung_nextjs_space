export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const customers = await prisma.customer.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ customers: customers ?? [] });
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
    const { name, billable } = body ?? {};

    const trimmedName = name?.trim?.();
    if (!trimmedName) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { userId, name: trimmedName } });
    if (existing) return NextResponse.json({ error: "Kunde existiert bereits" }, { status: 409 });

    const customer = await prisma.customer.create({
      data: { userId, name: trimmedName, billable: billable !== undefined ? Boolean(billable) : true },
    });

    return NextResponse.json({ customer });
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
    const { id, name, billable } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trimmedName = name?.trim?.();
    if (trimmedName && trimmedName !== existing.name) {
      const duplicate = await prisma.customer.findFirst({ where: { userId, name: trimmedName } });
      if (duplicate) return NextResponse.json({ error: "Kunde existiert bereits" }, { status: 409 });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: trimmedName || existing.name,
        billable: billable !== undefined ? Boolean(billable) : existing.billable,
      },
    });

    return NextResponse.json({ customer });
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

    const existing = await prisma.customer.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.customer.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
