export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";

export async function GET() {
  try {
    const { orgId } = await requireOrg();

    // Kunden gehören der Organisation, nicht dem einzelnen Mitarbeitenden —
    // alle Mitglieder sehen dieselbe Kundenliste (MIGRATION.md Punkt 3).
    const customers = await prisma.customer.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ customers: customers ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { name, billable } = body ?? {};

    const trimmedName = name?.trim?.();
    if (!trimmedName) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { orgId, name: trimmedName } });
    if (existing) return NextResponse.json({ error: "Kunde existiert bereits" }, { status: 409 });

    const customer = await prisma.customer.create({
      data: { userId, orgId, name: trimmedName, billable: billable !== undefined ? Boolean(billable) : true },
    });

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, name, billable } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trimmedName = name?.trim?.();
    if (trimmedName && trimmedName !== existing.name) {
      const duplicate = await prisma.customer.findFirst({ where: { orgId, name: trimmedName } });
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
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.customer.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
