export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { EintragTyp } from "@/lib/calc";
import { requireOrg, assertMonthEditable, AccessError } from "@/lib/access";
import { diffTimeEntryFields } from "@/lib/audit";
import { logError } from "@/lib/error-log";
import { pruefeEintragKonflikte, type VergleichbarerEintrag } from "@/lib/entry-overlap";
import { parseDateYMD } from "@/lib/dates";
import { isValidType, arbeitszeitIstGueltig, INVALID_HOURS, nettoMinuten, parseHours } from "@/lib/time-entry-validation";
import { resolveProjectAndCustomer, loadOtherEntriesOfDay } from "@/lib/time-entries";

export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const url = new URL(req.url);
    const year = parseInt(url?.searchParams?.get?.("year") ?? "0");
    const month = parseInt(url?.searchParams?.get?.("month") ?? "0");

    if (!year || !month) return NextResponse.json({ entries: [] });

    // UTC-Grenzen: @db.Date-Werte werden anhand des UTC-Kalendertags gespeichert/verglichen.
    // Lokale Date-Konstruktoren würden in Zeitzonen ≠ UTC den letzten Tag der Periode abschneiden.
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));

    const entries = await prisma.timeEntry.findMany({
      where: { userId, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } },
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
        notiz: e?.notiz ?? null,
        customerId: e?.customerId ?? null,
        projectId: e?.projectId ?? null,
        hours: e?.hours ?? null,
        countsAsWorktime: e?.countsAsWorktime ?? true,
      })) ?? [],
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("GET /api/time-entries", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { date, type, von, bis, pauseMin, notiz, customerId, projectId, hours } = body ?? {};

    const parsedDate = parseDateYMD(date);
    if (!parsedDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!isValidType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    await assertMonthEditable(orgId, userId, role, parsedDate);

    const resolved = await resolveProjectAndCustomer(orgId, projectId, customerId);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

    const isArbeit = type === "arbeit";
    const clampedPause = Math.max(0, Math.min(1440, Number(pauseMin) || 0));
    const parsedHours = parseHours(hours);
    if (parsedHours === INVALID_HOURS) {
      return NextResponse.json({ error: "Ungültige Stundenzahl" }, { status: 400 });
    }
    const clampedHours = parsedHours;
    const nextVon = isArbeit ? (von || null) : null;
    const nextBis = isArbeit ? (bis || null) : null;
    // Arbeitszeit ohne gültige Von/Bis und ohne Stundenzahl wurde bisher
    // stillschweigend als 0h gespeichert (stundenAusEintrag() in lib/calc.ts
    // fällt auf hours ?? 0 zurück) bzw. ein kaputtes Zeitformat wie "25:00"
    // vergiftete alle darauf aufbauenden Summen mit NaN — beides jetzt ein
    // harter 400 statt eines stillen Datenfehlers. Reine hours-Zeilen (kein
    // von/bis, siehe arbeitszeitIstGueltig) bleiben erlaubt, das ist das
    // Format des Stundenrapport-Imports.
    if (isArbeit && !arbeitszeitIstGueltig(nextVon, nextBis, clampedHours)) {
      return NextResponse.json({ error: "Von/Bis (Format HH:MM) oder eine Stundenzahl sind für Arbeitszeit erforderlich" }, { status: 400 });
    }
    if (isArbeit && nextVon && nextBis && nettoMinuten(nextVon, nextBis, clampedPause) < 0) {
      return NextResponse.json({ error: "Pause ist länger als die eingetragene Zeitspanne" }, { status: 400 });
    }

    const kandidat: VergleichbarerEintrag = {
      typ: type,
      von: nextVon,
      bis: nextBis,
      pauseMin: isArbeit ? clampedPause : 0,
      hours: clampedHours,
    };
    const andereDesTages = await loadOtherEntriesOfDay(orgId, userId, parsedDate, undefined);
    const konflikte = pruefeEintragKonflikte(kandidat, andereDesTages);
    const blockierend = konflikte.filter((k) => k.art !== "ueberlappung");
    if (blockierend.length > 0) {
      return NextResponse.json({ error: blockierend[0].message }, { status: 409 });
    }

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        orgId,
        date: parsedDate,
        type,
        von: nextVon,
        bis: nextBis,
        pauseMin: isArbeit ? clampedPause : 0,
        notiz: notiz?.trim?.() || null,
        customerId: resolved.customerId,
        projectId: resolved.projectId,
        hours: clampedHours,
      },
    });

    const warnings = konflikte.filter((k) => k.art === "ueberlappung").map((k) => k.message);
    return NextResponse.json({ entry, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("POST /api/time-entries", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id, date, type, von, bis, pauseMin, notiz, customerId, projectId, hours } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId, orgId, deletedAt: null } });
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
    // Sowohl der bisherige als auch ein neu gesetzter Monat müssen entsperrt
    // sein — sonst liesse sich eine gesperrte Zeile durch Verschieben des
    // Datums umgehen, oder ein Eintrag unbemerkt in einen gesperrten Monat
    // hinein verschieben (MIGRATION.md Punkt 6e).
    await assertMonthEditable(orgId, userId, role, existing.date);
    if (parsedDate) await assertMonthEditable(orgId, userId, role, parsedDate);

    // projectId/customerId nur neu auflösen, wenn mindestens eines der beiden
    // Felder im Request mitkommt — sonst bleiben beide unangetastet.
    let nextCustomerId: string | null | undefined = undefined;
    let nextProjectId: string | null | undefined = undefined;
    if (projectId !== undefined || customerId !== undefined) {
      const resolved = await resolveProjectAndCustomer(orgId, projectId, customerId);
      if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
      nextCustomerId = resolved.customerId;
      nextProjectId = resolved.projectId;
    }

    const nextType: EintragTyp = isValidType(type) ? type : (existing.type as EintragTyp);
    const isArbeit = nextType === "arbeit";
    const parsedHours = hours !== undefined ? parseHours(hours) : undefined;
    if (parsedHours === INVALID_HOURS) {
      return NextResponse.json({ error: "Ungültige Stundenzahl" }, { status: 400 });
    }
    const clampedHours = parsedHours;

    const nextVon = isArbeit ? (von !== undefined ? von || null : existing.von) : null;
    const nextBis = isArbeit ? (bis !== undefined ? bis || null : existing.bis) : null;
    const nextPauseMin = isArbeit
      ? pauseMin !== undefined
        ? Math.max(0, Math.min(1440, Number(pauseMin) || 0))
        : existing.pauseMin
      : 0;
    const nextHoursForValidation = clampedHours !== undefined ? clampedHours : existing.hours;
    // Dieselbe Pflicht- und Formatprüfung wie POST — auch beim Bearbeiten
    // darf eine "arbeit"-Zeile nicht ohne oder mit kaputten Von/Bis UND ohne
    // Stundenzahl landen. Reine hours-Zeilen aus dem Stundenrapport-Import
    // (existing.von/bis bereits null, siehe TimeEntry.countsAsWorktime)
    // bleiben beim reinen "Graduieren" (Speichern ohne von/bis-Änderung,
    // siehe countsAsWorktime unten) unverändert gültig.
    if (isArbeit && !arbeitszeitIstGueltig(nextVon, nextBis, nextHoursForValidation)) {
      return NextResponse.json({ error: "Von/Bis (Format HH:MM) oder eine Stundenzahl sind für Arbeitszeit erforderlich" }, { status: 400 });
    }
    if (isArbeit && nextVon && nextBis && nettoMinuten(nextVon, nextBis, nextPauseMin) < 0) {
      return NextResponse.json({ error: "Pause ist länger als die eingetragene Zeitspanne" }, { status: 400 });
    }

    // Vollständig aufgelöster Zielzustand — Basis sowohl für das Update als
    // auch für den Feld-Diff gegen "existing" (MIGRATION.md Punkt 6b). Felder,
    // die nicht mitgeschickt wurden, fallen auf den bestehenden Wert zurück,
    // damit der Diff nur tatsächliche Änderungen sieht, keine Prisma-"undefined
    // heisst unverändert"-Semantik.
    const nextState = {
      date: parsedDate ?? existing.date,
      type: nextType,
      von: nextVon,
      bis: nextBis,
      pauseMin: nextPauseMin,
      notiz: notiz !== undefined ? notiz?.trim?.() || null : existing.notiz,
      customerId: nextCustomerId !== undefined ? nextCustomerId : existing.customerId,
      projectId: nextProjectId !== undefined ? nextProjectId : existing.projectId,
      hours: clampedHours !== undefined ? clampedHours : existing.hours,
      // "Graduierung": jedes aktive Speichern über den Tagesdialog macht die
      // Zeile zu echter Arbeitszeit, unabhängig vom bisherigen Wert — nur der
      // Stundenrapport-Import setzt countsAsWorktime bewusst auf false (siehe
      // TimeEntry.countsAsWorktime in prisma/schema.prisma). Ein Mensch, der
      // die Zeile im Kalender öffnet und speichert, bestätigt sie damit als
      // reale Arbeitszeit.
      countsAsWorktime: true,
    };

    const kandidat: VergleichbarerEintrag = {
      id,
      typ: nextState.type,
      von: nextState.von,
      bis: nextState.bis,
      pauseMin: nextState.pauseMin,
      hours: nextState.hours,
    };
    const andereDesTages = await loadOtherEntriesOfDay(orgId, userId, nextState.date, id);
    const konflikte = pruefeEintragKonflikte(kandidat, andereDesTages);
    const blockierend = konflikte.filter((k) => k.art !== "ueberlappung");
    if (blockierend.length > 0) {
      return NextResponse.json({ error: blockierend[0].message }, { status: 409 });
    }

    const changes = diffTimeEntryFields(existing, nextState);

    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.timeEntry.update({ where: { id }, data: nextState });
      if (changes.length > 0) {
        await tx.timeEntryAudit.createMany({
          data: changes.map((c) => ({ entryId: id, orgId, changedBy: userId, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
        });
      }
      return updated;
    });

    const warnings = konflikte.filter((k) => k.art === "ueberlappung").map((k) => k.message);
    return NextResponse.json({ entry, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("PUT /api/time-entries", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await prisma.timeEntry.findFirst({ where: { id, userId, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertMonthEditable(orgId, userId, role, existing.date);

    // Soft-Delete statt Hard-Delete (MIGRATION.md Punkt 6b) — die gesetzliche
    // Aufbewahrungspflicht von 5 Jahren verlangt, dass gelöschte Einträge
    // rekonstruierbar bleiben.
    const deletedAt = new Date();
    await prisma.$transaction([
      prisma.timeEntry.update({ where: { id }, data: { deletedAt } }),
      prisma.timeEntryAudit.create({
        data: { entryId: id, orgId, changedBy: userId, field: "deletedAt", oldValue: null, newValue: deletedAt.toISOString() },
      }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("DELETE /api/time-entries", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
