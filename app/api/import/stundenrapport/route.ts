export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import {
  parseStundenrapportWorkbookAllSheets,
  parseStundenrapportCsv,
  type ImportedProjektRow,
  type ImportRowError,
} from "@/lib/import-stundenrapport";

// Import der alten ONEXIS-Stundenrapporte — siehe lib/import-stundenrapport.ts
// fürs Parsing. Anders als /api/import/timesheet (Blatt "Tageszeiten", eine
// Zeile pro Tag) legt dieser Import bei Bedarf Kunde/Projekte selbst an,
// weil das Ziel genau dafür da ist: Altbestände dieses Formats einmalig
// migrieren. Jede Person importiert nur für sich selbst (requireOrg, keine
// targetUserId), gleiches Muster wie /api/import/timesheet.
//
// Ein Aufruf kann MEHRERE Dateien enthalten (formData.getAll("file")), und
// jede .xlsx-Datei kann ihrerseits MEHRERE Blätter haben (typisch: ein
// Kunde, ein Blatt pro Monat, siehe lib/import-stundenrapport.ts). Jedes
// Blatt bzw. jede .csv-Datei wird als eigener "Block" unabhängig geparst
// (eigener Kopfblock, eigene Detailzeilen) — Kunden/Projekte werden aber nur
// EINMAL pro distinktem Namen über alle Blöcke hinweg angelegt, nicht pro
// Block, sonst entstünde z.B. "Swissgrid" fünfmal bei einem 5-Monats-
// Workbook.
interface RawBlock {
  fileName: string;
  sheetName: string | null;
  customerName: string | null;
  rows: ImportedProjektRow[];
  errors: ImportRowError[];
}

interface BlockResult {
  fileName: string;
  sheetName: string | null;
  customerName: string | null;
  customerIsNew: boolean;
  newProjects: string[];
  totalRows: number;
  imported: number;
  skippedExisting: number;
  skippedLocked: number;
  dateFrom: string | null;
  dateTo: string | null;
  errors: ImportRowError[];
}

async function fileToBlocks(file: File): Promise<RawBlock[]> {
  const fileName = file.name || "Datei";
  const isCsv = /\.csv$/i.test(fileName) || file.type === "text/csv";
  const buf = Buffer.from(await file.arrayBuffer());

  if (isCsv) {
    const parsed = parseStundenrapportCsv(buf.toString("latin1"));
    return [{ fileName, sheetName: null, customerName: parsed.customerName, rows: parsed.rows, errors: parsed.errors }];
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf);
  } catch {
    // Kein gültiges .xlsx — evtl. eine .csv ohne (oder mit falscher)
    // Endung/Content-Type. Als Fallback als latin1-Text versuchen, statt
    // einfach abzulehnen.
    const parsed = parseStundenrapportCsv(buf.toString("latin1"));
    return [{ fileName, sheetName: null, customerName: parsed.customerName, rows: parsed.rows, errors: parsed.errors }];
  }

  const sheets = parseStundenrapportWorkbookAllSheets(workbook);
  if (sheets.length === 0) {
    return [{
      fileName, sheetName: null, customerName: null, rows: [],
      errors: [{ rowNumber: 0, message: 'Keine verwertbare Tabelle mit "Datum"/"Std" gefunden.' }],
    }];
  }
  return sheets.map(({ sheetName, parsed }) => ({
    fileName, sheetName, customerName: parsed.customerName, rows: parsed.rows, errors: parsed.errors,
  }));
}

export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const formData = await req.formData().catch(() => null);
    const files = (formData?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
    const mode = String(formData?.get("mode") ?? "preview") === "commit" ? "commit" : "preview";
    // Kunde aus dem UI-Vorschlag/der Bestätigung — überschreibt den aus JEDEM
    // Block gelesenen Vorschlag. Passend für den Regelfall (ein Workbook/
    // mehrere Dateien, alle für denselben Kunden); ohne Override behält
    // jeder Block seinen eigenen Kopfblock-Kundennamen, funktioniert also
    // auch bei gemischten Kunden in einem Batch.
    const customerNameOverride = String(formData?.get("customerName") ?? "").trim() || null;

    if (files.length === 0) {
      return NextResponse.json({ error: "Keine Datei erhalten" }, { status: 400 });
    }

    const rawBlocks: RawBlock[] = [];
    for (const file of files) {
      rawBlocks.push(...(await fileToBlocks(file)));
    }

    const blocks = rawBlocks.map((b) => ({ ...b, customerName: customerNameOverride ?? b.customerName }));

    // ---- Kunden: einmal pro distinktem Namen über alle Blöcke auflösen/anlegen ----
    const neededCustomerNames = new Map<string, string>(); // lowercase -> erste gesehene Original-Schreibweise
    for (const b of blocks) {
      if (!b.customerName) continue;
      const lower = b.customerName.toLowerCase();
      if (!neededCustomerNames.has(lower)) neededCustomerNames.set(lower, b.customerName);
    }

    const existingCustomers = await prisma.customer.findMany({ where: { orgId }, select: { id: true, name: true, billable: true } });
    const customerByLower = new Map(existingCustomers.map((c) => [c.name.trim().toLowerCase(), c]));
    const customerIsNewByLower = new Map<string, boolean>();

    for (const [lower, originalName] of neededCustomerNames) {
      if (customerByLower.has(lower)) {
        customerIsNewByLower.set(lower, false);
        continue;
      }
      customerIsNewByLower.set(lower, true);
      if (mode === "commit") {
        const created = await prisma.customer.create({ data: { orgId, name: originalName } });
        customerByLower.set(lower, created);
      }
    }

    function customerFor(block: { customerName: string | null }) {
      if (!block.customerName) return null;
      return customerByLower.get(block.customerName.toLowerCase()) ?? null;
    }

    // ---- Projekte: einmal pro distinktem (Kunde, Name) über alle Blöcke auflösen/anlegen ----
    const resolvedCustomerIds = [...customerByLower.values()].map((c) => c.id);
    const existingProjects = resolvedCustomerIds.length > 0
      ? await prisma.project.findMany({ where: { orgId, customerId: { in: resolvedCustomerIds } }, select: { id: true, name: true, customerId: true } })
      : [];
    const projectByKey = new Map<string, string>(); // `${customerId}|${nameLower}` -> projectId
    for (const p of existingProjects) projectByKey.set(`${p.customerId}|${p.name.trim().toLowerCase()}`, p.id);

    const neededProjects = new Map<string, { customerId: string; name: string }>();
    for (const b of blocks) {
      const customer = customerFor(b);
      if (!customer) continue; // neuer Kunde im Preview (noch keine echte customerId) oder Block ohne Kunde
      for (const row of b.rows) {
        const key = `${customer.id}|${row.projektName.toLowerCase()}`;
        if (!projectByKey.has(key) && !neededProjects.has(key)) {
          neededProjects.set(key, { customerId: customer.id, name: row.projektName });
        }
      }
    }
    if (mode === "commit") {
      for (const { customerId, name } of neededProjects.values()) {
        const created = await prisma.project.create({ data: { orgId, customerId, name } });
        projectByKey.set(`${customerId}|${name.toLowerCase()}`, created.id);
      }
    }

    // "Neu" bezogen auf den Stand VOR diesem Import-Lauf (existingProjects),
    // nicht auf projectByKey (das enthält nach dem Commit-Block oben auch
    // die gerade frisch angelegten) — sonst wäre newProjects im commit immer
    // leer. Kommt ein neues Projekt in mehreren Blöcken vor (z.B. "Admin" in
    // sowohl April- als auch Mai-Blatt), wird es nur beim ERSTEN Block als
    // neu gemeldet — sonst sähe die Vorschau so aus, als würde dasselbe
    // Projekt zweimal angelegt.
    const claimedAsNew = new Set<string>(); // `${customerId}|${nameLower}`, brandneue Kunden ohne id: `new:${customerNameLower}|${nameLower}`
    function newProjectNamesFor(block: { customerName: string | null; rows: ImportedProjektRow[] }): string[] {
      const names = [...new Set(block.rows.map((r) => r.projektName))];
      const customer = customerFor(block);
      const result: string[] = [];
      for (const name of names) {
        const nameLower = name.toLowerCase();
        if (!customer) {
          // Brandneuer Kunde (noch keine echte id, nur im Preview möglich) —
          // pro Kundenname statt pro id dedupliziert.
          const claimKey = `new:${block.customerName!.toLowerCase()}|${nameLower}`;
          if (claimedAsNew.has(claimKey)) continue;
          claimedAsNew.add(claimKey);
          result.push(name);
          continue;
        }
        const preExists = existingProjects.some((p) => p.customerId === customer.id && p.name.trim().toLowerCase() === nameLower);
        if (preExists) continue;
        const claimKey = `${customer.id}|${nameLower}`;
        if (claimedAsNew.has(claimKey)) continue;
        claimedAsNew.add(claimKey);
        result.push(name);
      }
      return result;
    }

    // ---- Zeilen über alle Blöcke: Dedup + Monatssperren, dann ggf. schreiben ----
    const allRows: Array<{ blockIndex: number; row: ImportedProjektRow }> = [];
    blocks.forEach((b, i) => {
      if (!b.customerName) return; // Block-Fehler unten separat gemeldet
      for (const row of b.rows) allRows.push({ blockIndex: i, row });
    });

    let existingKeys = new Set<string>();
    let lockedYearMonths = new Set<string>();
    if (allRows.length > 0) {
      const sortedDates = allRows.map((r) => r.row.date).sort();
      const dateFrom = sortedDates[0];
      const dateTo = sortedDates[sortedDates.length - 1];

      // Dedup pro ZEILE (Datum + Projekt + Stunden + Task), nicht pro Tag —
      // ein Tag darf mehrere Projektzeilen haben, die alle einzeln importiert
      // werden sollen; nur eine exakt schon vorhandene Zeile wird
      // übersprungen (macht den Import wiederholbar, ohne echte
      // Zweit-Projekte am selben Tag zu blockieren). Gilt über ALLE Blöcke
      // hinweg — dieselbe Zeile aus zwei verschiedenen hochgeladenen Dateien
      // wird nur einmal importiert.
      const existingEntries = await prisma.timeEntry.findMany({
        where: {
          userId, orgId, deletedAt: null, type: "arbeit",
          date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T00:00:00Z`) },
          projectId: { not: null },
        },
        select: { date: true, projectId: true, hours: true, notiz: true },
      });
      existingKeys = new Set(
        existingEntries.map((e) => `${e.date.toISOString().slice(0, 10)}|${e.projectId}|${e.hours}|${e.notiz ?? ""}`)
      );

      if (role === "member") {
        const yearMonths = new Set(allRows.map((r) => r.row.date.slice(0, 7)));
        const locks = await prisma.monthLock.findMany({
          where: {
            orgId, userId,
            OR: [...yearMonths].map((ym) => { const [y, m] = ym.split("-").map(Number); return { year: y, month: m }; }),
          },
          select: { year: true, month: true },
        });
        lockedYearMonths = new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, "0")}`));
      }
    }

    const results: BlockResult[] = blocks.map((b) => {
      const dates = b.rows.map((r) => r.date).sort();
      return {
        fileName: b.fileName,
        sheetName: b.sheetName,
        customerName: b.customerName,
        customerIsNew: b.customerName ? (customerIsNewByLower.get(b.customerName.toLowerCase()) ?? false) : false,
        newProjects: newProjectNamesFor(b),
        totalRows: b.rows.length,
        imported: 0,
        skippedExisting: 0,
        skippedLocked: 0,
        dateFrom: dates[0] ?? null,
        dateTo: dates[dates.length - 1] ?? null,
        errors: b.customerName
          ? b.errors
          : [...b.errors, { rowNumber: 0, message: 'Kein Kundenname gefunden — bitte "Kunde:" in der Datei prüfen oder im Formular angeben.' }],
      };
    });

    const toCreate: Array<{ blockIndex: number; row: ImportedProjektRow; projectId: string | null; customerId: string | null }> = [];
    for (const { blockIndex, row } of allRows) {
      const block = blocks[blockIndex];
      const customer = customerFor(block);
      const projectId = customer ? projectByKey.get(`${customer.id}|${row.projektName.toLowerCase()}`) ?? null : null;
      const key = `${row.date}|${projectId}|${row.hours}|${row.task ?? ""}`;
      if (projectId && existingKeys.has(key)) { results[blockIndex].skippedExisting++; continue; }
      if (lockedYearMonths.has(row.date.slice(0, 7))) { results[blockIndex].skippedLocked++; continue; }
      results[blockIndex].imported++;
      toCreate.push({ blockIndex, row, projectId, customerId: customer?.id ?? null });
    }

    if (mode === "commit" && toCreate.length > 0) {
      await prisma.timeEntry.createMany({
        data: toCreate.map(({ row, projectId, customerId }) => {
          const customer = customerId ? [...customerByLower.values()].find((c) => c.id === customerId) : undefined;
          return {
            userId, orgId, date: new Date(`${row.date}T00:00:00Z`), type: "arbeit",
            hours: row.hours, notiz: row.task, projectId, customerId,
            billable: customer?.billable ?? false,
            // Migrierte Projekt-/Kundenzuordnung, keine neu erfasste Arbeitszeit
            // — zählt bewusst nicht zusätzlich zu Soll/Ist, falls der Tag schon
            // eine "echte" Arbeitszeit-Zeile hat (siehe TimeEntry.countsAsWorktime
            // in prisma/schema.prisma). Sobald jemand die Zeile aktiv im
            // Tagesdialog speichert, setzt PUT /api/time-entries das wieder auf true.
            countsAsWorktime: false,
          };
        }),
      });
    }

    return NextResponse.json({
      mode,
      blocks: results,
      totalRows: results.reduce((s, r) => s + r.totalRows, 0),
      totalImported: results.reduce((s, r) => s + r.imported, 0),
      totalSkippedExisting: results.reduce((s, r) => s + r.skippedExisting, 0),
      totalSkippedLocked: results.reduce((s, r) => s + r.skippedLocked, 0),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST import/stundenrapport error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
