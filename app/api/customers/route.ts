export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { logError } from "@/lib/error-log";
import { ownCustomersWhere } from "@/lib/visibility";
import { assertMayDelete, countCustomerReferences, referenceCountsMessage } from "@/lib/entity-deletion";

export async function GET() {
  try {
    const { userId, orgId, role } = await requireOrg();

    // Kunden gehören der Organisation, nicht dem einzelnen Mitarbeitenden
    // (MIGRATION.md Punkt 3) — manager/admin/owner sehen deshalb weiterhin
    // alle. Ein normales Mitglied sieht dagegen nur Kunden, bei denen es
    // selbst schon Stunden erfasst hat (Tageseintrag oder monatliche
    // Kundenstunden) ODER die es selbst angelegt hat (Customer.createdBy,
    // lib/visibility.ts ownCustomersWhere — dasselbe Muster wie bei
    // Projekten), damit z.B. Gabriel nicht Nicos Kundenportfolio sieht und
    // umgekehrt, ein frisch angelegter Kunde aber sofort nutzbar ist.
    if (role === "manager" || role === "admin" || role === "owner") {
      const customers = await prisma.customer.findMany({
        where: { orgId },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({ customers: customers ?? [] });
    }

    const ownFilter = await ownCustomersWhere(orgId, userId);
    const customers = await prisma.customer.findMany({
      where: { orgId, ...ownFilter },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ customers: customers ?? [] });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("GET /api/customers", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

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

    // createdBy macht diesen Kunden für die erstellende Person sofort
    // sichtbar (siehe ownCustomersWhere) — ohne das Feld war ein frisch
    // angelegter, noch nie bebuchter Kunde eine Sackgasse (REVIEW_LOOP.md).
    const customer = await prisma.customer.create({
      data: { orgId, name: trimmedName, hourlyRate: parsedRate, createdBy: userId },
    });

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("POST /api/customers", error);
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
    await logError("PUT /api/customers", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.customer.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // owner/admin dürfen jeden Kunden löschen, sonst nur die Person, die ihn
    // selbst angelegt hat (REVIEW_LOOP.md, Audit-Fund KRITISCH).
    assertMayDelete(role, existing.createdBy, userId);

    // Referenzsperre gilt für JEDE Rolle — verhindert genau den Fall aus dem
    // Audit, in dem ein versehentlicher Klick in der Profilseite Zeiteinträge
    // und von Hand rekonstruierte CustomerMonth-Werte unwiederbringlich
    // mitgerissen hat.
    const refs = await countCustomerReferences(orgId, id);
    if (refs.total > 0) {
      return NextResponse.json({ error: referenceCountsMessage("Kunde", refs) }, { status: 409 });
    }

    await prisma.customer.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("DELETE /api/customers", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
