export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";

export async function GET() {
  try {
    const { userId, orgId, role } = await requireOrg();

    // Kunden gehören der Organisation, nicht dem einzelnen Mitarbeitenden
    // (MIGRATION.md Punkt 3) — manager/admin/owner sehen deshalb weiterhin
    // alle. Ein normales Mitglied sieht dagegen nur Kunden, bei denen es
    // selbst schon Stunden erfasst hat (Tageseintrag oder monatliche
    // Kundenstunden), damit z.B. Gabriel nicht Nicos Kundenportfolio sieht
    // und umgekehrt. Bekannte Einschränkung: ein frisch angelegter, noch nie
    // bebuchter Kunde taucht in der eigenen Liste erst nach dem ersten
    // Eintrag auf.
    if (role === "manager" || role === "admin" || role === "owner") {
      const customers = await prisma.customer.findMany({
        where: { orgId },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({ customers: customers ?? [] });
    }

    const [fromEntries, fromMonths] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { userId, orgId, deletedAt: null, customerId: { not: null } },
        select: { customerId: true },
        distinct: ["customerId"],
      }),
      prisma.customerMonth.findMany({
        where: { userId, orgId },
        select: { customerId: true },
        distinct: ["customerId"],
      }),
    ]);
    const visibleIds = Array.from(
      new Set([...fromEntries.map((e) => e.customerId), ...fromMonths.map((m) => m.customerId)].filter((id): id is string => !!id))
    );
    if (visibleIds.length === 0) return NextResponse.json({ customers: [] });

    const customers = await prisma.customer.findMany({
      where: { orgId, id: { in: visibleIds } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ customers: customers ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { name, hourlyRate } = body ?? {};

    const trimmedName = name?.trim?.();
    if (!trimmedName) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { orgId, name: trimmedName } });
    if (existing) return NextResponse.json({ error: "Kunde existiert bereits" }, { status: 409 });

    const parsedRate = hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "" ? Number(hourlyRate) : null;
    if (parsedRate !== null && (isNaN(parsedRate) || parsedRate < 0)) {
      return NextResponse.json({ error: "Ungültiger Stundensatz" }, { status: 400 });
    }

    const customer = await prisma.customer.create({
      data: { orgId, name: trimmedName, hourlyRate: parsedRate },
    });

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, name, hourlyRate } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trimmedName = name?.trim?.();
    if (trimmedName && trimmedName !== existing.name) {
      const duplicate = await prisma.customer.findFirst({ where: { orgId, name: trimmedName } });
      if (duplicate) return NextResponse.json({ error: "Kunde existiert bereits" }, { status: 409 });
    }

    let parsedRate: number | null | undefined = undefined;
    if (hourlyRate !== undefined) {
      parsedRate = hourlyRate === null || hourlyRate === "" ? null : Number(hourlyRate);
      if (parsedRate !== null && (isNaN(parsedRate) || parsedRate < 0)) {
        return NextResponse.json({ error: "Ungültiger Stundensatz" }, { status: 400 });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: trimmedName || existing.name,
        hourlyRate: parsedRate !== undefined ? parsedRate : existing.hourlyRate,
      },
    });

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
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
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
