export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, assertMonthEditable, AccessError } from "@/lib/access";
import { diffTimeEntryFields } from "@/lib/audit";
import { logError } from "@/lib/error-log";
import { pruefeEintragKonflikte, type VergleichbarerEintrag } from "@/lib/entry-overlap";
import { parseDateYMD } from "@/lib/dates";
import { isValidType, arbeitszeitIstGueltig, INVALID_HOURS, nettoMinuten, parseHours } from "@/lib/time-entry-validation";
import { resolveProjectAndCustomer } from "@/lib/time-entries";

const MAX_ROWS_PER_DAY = 50;

interface IncomingRow {
  id?: string;
  type: unknown;
  von: unknown;
  bis: unknown;
  pauseMin: unknown;
  notiz: unknown;
  customerId: unknown;
  projectId: unknown;
  hours: unknown;
}

interface ResolvedRow {
  id: string | null;
  type: string;
  von: string | null;
  bis: string | null;
  pauseMin: number;
  notiz: string | null;
  customerId: string | null;
  projectId: string | null;
  hours: number | null;
}

// Ersetzt alle Zeilen EINES Tages auf einmal (statt einzelner POST/PUT/DELETE
// pro Zeile, siehe app/api/time-entries/route.ts) — components/day-
// entry-dialog.tsx hat dafür nur noch einen Speichern-Button pro Tag statt
// einen pro Zeile, weil das Ändern einer Zeile (z.B. Bis-Zeit) über
// lib/day-shift.ts automatisch die Folgezeiten desselben Tages verschiebt;
// die mussten bisher alle einzeln nachgetragen und gespeichert werden.
//
// Vorbild ist PUT /api/customer-months (app/api/customer-months/route.ts),
// das denselben Ansatz "ganzen Block in einer Transaktion ersetzen" schon
// fährt. Anders als dort reicht hier kein Delete+Recreate: TimeEntry braucht
// stabile ids für den Audit-Trail (Feld-Diff je Zeile) und Soft-Delete statt
// Hard-Delete (gesetzliche Aufbewahrungspflicht, siehe DELETE unten in
// app/api/time-entries/route.ts).
export async function PUT(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const parsedDate = parseDateYMD(body?.date);
    if (!parsedDate) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    await assertMonthEditable(orgId, userId, role, parsedDate);

    const rowsIn: IncomingRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rowsIn.length > MAX_ROWS_PER_DAY) {
      return NextResponse.json({ error: "Zu viele Zeilen" }, { status: 400 });
    }

    // Jede Zeile einzeln validieren und auflösen (Projekt/Kunde), bevor
    // irgendetwas geschrieben wird — ein Fehler in Zeile 3 darf Zeile 1 und 2
    // nicht schon in der DB landen lassen.
    const resolvedRows: ResolvedRow[] = [];
    for (let i = 0; i < rowsIn.length; i++) {
      const r = rowsIn[i];
      if (!isValidType(r?.type)) {
        return NextResponse.json({ error: `Zeile ${i + 1}: ungültiger Typ` }, { status: 400 });
      }
      const isArbeit = r.type === "arbeit";
      const resolved = await resolveProjectAndCustomer(orgId, r.projectId, r.customerId);
      if ("error" in resolved) {
        return NextResponse.json({ error: `Zeile ${i + 1}: ${resolved.error}` }, { status: 400 });
      }

      const von = isArbeit ? ((r.von as string) || null) : null;
      const bis = isArbeit ? ((r.bis as string) || null) : null;
      const pauseMin = isArbeit ? Math.max(0, Math.min(1440, Number(r.pauseMin) || 0)) : 0;
      const parsedHours = parseHours(r.hours);
      if (parsedHours === INVALID_HOURS) {
        return NextResponse.json({ error: `Zeile ${i + 1}: ungültige Stundenzahl` }, { status: 400 });
      }

      if (isArbeit && !arbeitszeitIstGueltig(von, bis, parsedHours)) {
        return NextResponse.json(
          { error: `Zeile ${i + 1}: Von/Bis (Format HH:MM) oder eine Stundenzahl sind für Arbeitszeit erforderlich` },
          { status: 400 }
        );
      }
      if (isArbeit && von && bis && nettoMinuten(von, bis, pauseMin) < 0) {
        return NextResponse.json({ error: `Zeile ${i + 1}: Pause ist länger als die eingetragene Zeitspanne` }, { status: 400 });
      }

      resolvedRows.push({
        id: typeof r.id === "string" ? r.id : null,
        type: r.type,
        von,
        bis,
        pauseMin,
        notiz: (r.notiz as string)?.trim?.() || null,
        customerId: resolved.customerId,
        projectId: resolved.projectId,
        hours: parsedHours,
      });
    }

    // Konfliktprüfung jede Zeile gegen ALLE anderen Zeilen DIESES Payloads
    // (nicht gegen den DB-Stand) — der eigentliche Gewinn gegenüber
    // sequenziellem Einzelspeichern: dort prüft der Server jede Zeile gegen
    // die noch alten Nachbarzeiten und meldet Überschneidungen, die es im
    // Endzustand gar nicht gibt.
    const vergleichbar: VergleichbarerEintrag[] = resolvedRows.map((r) => ({
      id: r.id,
      typ: r.type as VergleichbarerEintrag["typ"],
      von: r.von,
      bis: r.bis,
      pauseMin: r.pauseMin,
      hours: r.hours,
    }));
    const alleWarnungen: string[] = [];
    for (let i = 0; i < resolvedRows.length; i++) {
      const andere = vergleichbar.filter((_, j) => j !== i);
      const konflikte = pruefeEintragKonflikte(vergleichbar[i], andere);
      const blockierend = konflikte.filter((k) => k.art !== "ueberlappung");
      if (blockierend.length > 0) {
        return NextResponse.json({ error: `Zeile ${i + 1}: ${blockierend[0].message}` }, { status: 409 });
      }
      alleWarnungen.push(...konflikte.filter((k) => k.art === "ueberlappung").map((k) => k.message));
    }

    const existing = await prisma.timeEntry.findMany({ where: { orgId, userId, date: parsedDate, deletedAt: null } });
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const keepIds = new Set(resolvedRows.filter((r) => r.id).map((r) => r.id as string));

    for (const r of resolvedRows) {
      if (r.id && !existingById.has(r.id)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const savedEntries = await prisma.$transaction(async (tx) => {
      const result: Awaited<ReturnType<typeof tx.timeEntry.create>>[] = [];

      for (const r of resolvedRows) {
        if (r.id) {
          const before = existingById.get(r.id)!;
          const nextState = {
            date: parsedDate,
            type: r.type,
            von: r.von,
            bis: r.bis,
            pauseMin: r.pauseMin,
            notiz: r.notiz,
            customerId: r.customerId,
            projectId: r.projectId,
            hours: r.hours,
            // Anders als beim Einzel-PUT (app/api/time-entries/route.ts) wird
            // hier NICHT jede Zeile pauschal graduiert: der Tagesdialog
            // schickt immer den ganzen Tag mit, auch unangetastete Zeilen.
            // Würde jede Zeile automatisch countsAsWorktime=true bekommen,
            // würde ein Speichern EINER geänderten Zeile eine unberührte
            // Import-Zeile (siehe TimeEntry.countsAsWorktime in
            // prisma/schema.prisma) unbemerkt zu echter Arbeitszeit machen
            // und die Monatssumme verfälschen. Nur tatsächlich geänderte
            // Zeilen graduieren.
            countsAsWorktime: before.countsAsWorktime,
          };
          const changes = diffTimeEntryFields(before, nextState);
          const graduiert = !before.countsAsWorktime && changes.length > 0;
          const finalState = graduiert ? { ...nextState, countsAsWorktime: true } : nextState;
          if (graduiert) changes.push({ field: "countsAsWorktime", oldValue: "false", newValue: "true" });

          const updated = await tx.timeEntry.update({ where: { id: r.id }, data: finalState });
          if (changes.length > 0) {
            await tx.timeEntryAudit.createMany({
              data: changes.map((c) => ({ entryId: r.id as string, orgId, changedBy: userId, field: c.field, oldValue: c.oldValue, newValue: c.newValue })),
            });
          }
          result.push(updated);
        } else {
          const created = await tx.timeEntry.create({
            data: {
              userId,
              orgId,
              date: parsedDate,
              type: r.type,
              von: r.von,
              bis: r.bis,
              pauseMin: r.pauseMin,
              notiz: r.notiz,
              customerId: r.customerId,
              projectId: r.projectId,
              hours: r.hours,
            },
          });
          result.push(created);
        }
      }

      // Bestehende Zeilen, die im Payload nicht mehr vorkommen, sind im
      // Dialog gelöscht worden — Soft-Delete + Audit, exakt wie DELETE in
      // app/api/time-entries/route.ts (gesetzliche Aufbewahrungspflicht).
      const toDelete = existing.filter((e) => !keepIds.has(e.id));
      for (const e of toDelete) {
        const deletedAt = new Date();
        await tx.timeEntry.update({ where: { id: e.id }, data: { deletedAt } });
        await tx.timeEntryAudit.create({
          data: { entryId: e.id, orgId, changedBy: userId, field: "deletedAt", oldValue: null, newValue: deletedAt.toISOString() },
        });
      }

      return result;
    });

    const entries = savedEntries.map((e) => ({
      id: e.id,
      date: e.date.toISOString().split("T")[0],
      type: e.type,
      von: e.von,
      bis: e.bis,
      pauseMin: e.pauseMin,
      notiz: e.notiz,
      customerId: e.customerId,
      projectId: e.projectId,
      hours: e.hours,
      countsAsWorktime: e.countsAsWorktime,
    }));

    return NextResponse.json({ entries, ...(alleWarnungen.length > 0 ? { warnings: alleWarnungen } : {}) });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    await logError("PUT /api/time-entries/day", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
