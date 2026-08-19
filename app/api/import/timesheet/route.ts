export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { parseTimesheetWorkbook, parseCustomerMonthsWorkbook, type ImportedRow, type ImportedCustomerMonthRow } from "@/lib/import-timesheet";

// Import der Alt-Exporte (Betrieb.md Punkt 4) — jede Person importiert nur
// für sich selbst, nie für Dritte (deshalb keine targetUserId im Body, im
// Unterschied zu z.B. /api/pensum-changes). Zwei Modi über das Feld "mode":
// "preview" (Standard, schreibt nichts) und "commit" (schreibt, gleiche
// Konfliktprüfung wie preview — die Zahlen in der Antwort stimmen deshalb
// zwischen beiden Aufrufen überein, sofern sich in der Zwischenzeit nichts
// an den Daten geändert hat).
export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    const mode = String(formData?.get("mode") ?? "preview") === "commit" ? "commit" : "preview";

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Keine Datei erhalten" }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: "Datei konnte nicht gelesen werden — ist es eine gültige .xlsx-Datei?" }, { status: 400 });
    }

    const { rows, errors: timesheetErrors } = parseTimesheetWorkbook(workbook);
    const customerRefs = await prisma.customer.findMany({ where: { orgId }, select: { id: true, name: true } });
    const { rows: cmRows, errors: cmErrors } = parseCustomerMonthsWorkbook(workbook, customerRefs);

    const errors = [
      ...timesheetErrors.map((e) => ({ ...e, sheet: "Tageszeiten" as const })),
      ...cmErrors.map((e) => ({ ...e, sheet: "Kundenstunden" as const })),
    ];

    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    const toCreate: ImportedRow[] = [];
    let skippedExisting = 0;
    let skippedLocked = 0;

    if (rows.length > 0) {
      const sortedDates = [...rows.map((r) => r.date)].sort();
      dateFrom = sortedDates[0];
      dateTo = sortedDates[sortedDates.length - 1];

      // Vorhandene Einträge derselben Person im betroffenen Zeitraum — werden
      // übersprungen, nicht überschrieben (kein stilles Überschreiben erfasster
      // Zeiten).
      const existing = await prisma.timeEntry.findMany({
        where: { userId, orgId, deletedAt: null, date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T00:00:00Z`) } },
        select: { date: true },
      });
      const existingDates = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));

      // Gesperrte Monate — dieselbe Regel wie überall sonst (lib/access.ts,
      // assertMonthEditable): nur "member" ist betroffen, admin/manager/owner
      // dürfen auch in gesperrten Monaten importieren.
      let lockedYearMonths = new Set<string>();
      if (role === "member") {
        const yearMonths = new Set(rows.map((r) => r.date.slice(0, 7)));
        const locks = await prisma.monthLock.findMany({
          where: {
            orgId,
            userId,
            OR: [...yearMonths].map((ym) => {
              const [y, m] = ym.split("-").map(Number);
              return { year: y, month: m };
            }),
          },
          select: { year: true, month: true },
        });
        lockedYearMonths = new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, "0")}`));
      }

      for (const row of rows) {
        if (existingDates.has(row.date)) { skippedExisting++; continue; }
        if (lockedYearMonths.has(row.date.slice(0, 7))) { skippedLocked++; continue; }
        toCreate.push(row);
      }

      if (mode === "commit" && toCreate.length > 0) {
        await prisma.timeEntry.createMany({
          data: toCreate.map((r) => ({
            userId,
            orgId,
            date: new Date(`${r.date}T00:00:00Z`),
            type: r.type,
            von: r.von,
            bis: r.bis,
            pauseMin: r.pauseMin,
            hours: r.type === "arbeit" ? null : r.hours,
            notiz: r.notiz,
          })),
        });
      }
    }

    // Kundenstunden (CustomerMonth) — vorhandene Kombination aus
    // Jahr/Monat/Kunde wird übersprungen, nicht überschrieben, gesperrte
    // Monate respektiert (gleiche Regeln wie oben bei Tageszeiten).
    const cmToCreate: ImportedCustomerMonthRow[] = [];
    let cmSkippedExisting = 0;
    let cmSkippedLocked = 0;

    if (cmRows.length > 0) {
      const cmYearMonths = new Set(cmRows.map((r) => `${r.year}-${r.month}`));
      const existingCm = await prisma.customerMonth.findMany({
        where: { orgId, userId, OR: [...cmYearMonths].map((ym) => { const [y, m] = ym.split("-").map(Number); return { year: y, month: m }; }) },
        select: { year: true, month: true, customerId: true },
      });
      const existingCmKeys = new Set(existingCm.map((c) => `${c.year}-${c.month}-${c.customerId}`));

      let cmLockedYearMonths = new Set<string>();
      if (role === "member") {
        const locks = await prisma.monthLock.findMany({
          where: {
            orgId,
            userId,
            OR: [...cmYearMonths].map((ym) => { const [y, m] = ym.split("-").map(Number); return { year: y, month: m }; }),
          },
          select: { year: true, month: true },
        });
        cmLockedYearMonths = new Set(locks.map((l) => `${l.year}-${l.month}`));
      }

      for (const row of cmRows) {
        const key = `${row.year}-${row.month}-${row.customerId}`;
        if (existingCmKeys.has(key)) { cmSkippedExisting++; continue; }
        if (cmLockedYearMonths.has(`${row.year}-${row.month}`)) { cmSkippedLocked++; continue; }
        cmToCreate.push(row);
      }

      if (mode === "commit" && cmToCreate.length > 0) {
        await prisma.customerMonth.createMany({
          data: cmToCreate.map((r) => ({ orgId, userId, year: r.year, month: r.month, customerId: r.customerId, hours: r.hours })),
        });
      }
    }

    return NextResponse.json({
      mode,
      imported: toCreate.length,
      skippedExisting,
      skippedLocked,
      totalRows: rows.length,
      dateFrom,
      dateTo,
      importedCustomerMonths: cmToCreate.length,
      skippedExistingCustomerMonths: cmSkippedExisting,
      skippedLockedCustomerMonths: cmSkippedLocked,
      totalCustomerMonthRows: cmRows.length,
      errors,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST import/timesheet error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
