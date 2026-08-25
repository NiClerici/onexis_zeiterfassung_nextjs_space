export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EINTRAG_TYPEN, type EintragTyp } from "@/lib/calc";
import { requireOrg, assertMonthEditable, AccessError } from "@/lib/access";
import { diffTimeEntryFields } from "@/lib/audit";
import { logError } from "@/lib/error-log";
import { pruefeEintragKonflikte, type VergleichbarerEintrag } from "@/lib/entry-overlap";

function isValidType(type: unknown): type is EintragTyp {
  return typeof type === "string" && (EINTRAG_TYPEN as readonly string[]).includes(type);
}

// "HH:MM", 00:00–23:59 — dieselbe Prüfung, die vorher fehlte und wodurch ein
// Wert wie "8" oder "25:00" ungefiltert bis in stundenAusEintrag() (lib/
// calc.ts) durchlief und dort split(":").map(Number) zu NaN machte, das sich
// danach durch Monatssummen, Überzeit-Berechnung und Exporte frisst.
function isValidTimeString(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Eine "arbeit"-Zeile ist gültig, wenn entweder BEIDE Zeiten ein valides
// HH:MM sind (der Normalfall — jede Zeile, die über den Tagesdialog
// gespeichert wird) ODER beide null sind und stattdessen eine Stundenzahl
// vorliegt (das reine hours-Format des Stundenrapport-Imports, siehe
// TimeEntry.countsAsWorktime in prisma/schema.prisma und
// stundenAusEintrag() in lib/calc.ts, die für diesen Fall auf `hours`
// zurückfällt). Jede andere Kombination — fehlende, halb gesetzte oder
// falsch formatierte Zeiten — war vorher speicherbar und ergab über
// stundenAusEintrag() stumm 0h oder NaN; das ist jetzt ein 400.
function arbeitszeitIstGueltig(von: string | null, bis: string | null, hours: number | null): boolean {
  if (isValidTimeString(von) && isValidTimeString(bis)) return true;
  if (von == null && bis == null && hours != null) return true;
  return false;
}

// Netto-Minuten (bis − von − Pause, Mitternachts-Konvention wie
// stundenAusEintrag() in lib/calc.ts). null nur, wenn von/bis fehlen.
function nettoMinuten(von: string, bis: string, pauseMin: number): number {
  const [vh, vm] = von.split(":").map(Number);
  const [bh, bm] = bis.split(":").map(Number);
  let bisMin = bh * 60 + bm;
  const vonMin = vh * 60 + vm;
  if (bisMin < vonMin) bisMin += 24 * 60;
  return bisMin - vonMin - pauseMin;
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

// Löst customerId/projectId auf. Ein Projekt gehört immer zu genau einem
// Kunden (Project.customerId ist required) — ist projectId gesetzt, gewinnt
// dessen customerId gegenüber einer abweichend mitgeschickten customerId,
// damit die beiden Felder nie auseinanderlaufen.
async function resolveProjectAndCustomer(
  orgId: string,
  projectId: unknown,
  customerId: unknown
): Promise<{ projectId: string | null; customerId: string | null } | { error: string }> {
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId as string, orgId } });
    if (!project) return { error: "Invalid project" };
    return { projectId: project.id, customerId: project.customerId };
  }
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId as string, orgId } });
    if (!customer) return { error: "Invalid customer" };
    return { projectId: null, customerId: customer.id };
  }
  return { projectId: null, customerId: null };
}

// Alle anderen (nicht gelöschten) Zeilen desselben Kalendertags, als Basis
// für pruefeEintragKonflikte() (lib/entry-overlap.ts). excludeId schliesst
// bei PUT die eigene Zeile aus, damit sie nicht gegen sich selbst geprüft
// wird — bei POST (neue Zeile) ist excludeId immer undefined.
async function loadOtherEntriesOfDay(
  orgId: string,
  userId: string,
  date: Date,
  excludeId?: string
): Promise<VergleichbarerEintrag[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { userId, orgId, deletedAt: null, date, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, type: true, von: true, bis: true, pauseMin: true, hours: true, countsAsWorktime: true },
  });
  return rows.map((r) => ({
    id: r.id,
    typ: r.type as EintragTyp,
    von: r.von,
    bis: r.bis,
    pauseMin: r.pauseMin,
    hours: r.hours,
    countsAsWorktime: r.countsAsWorktime,
  }));
}

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
    const clampedHours = hours != null && hours !== "" ? Math.max(0, Math.min(24, Number(hours))) : null;
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
    const clampedHours =
      hours !== undefined ? (hours === null || hours === "" ? null : Math.max(0, Math.min(24, Number(hours)))) : undefined;

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
