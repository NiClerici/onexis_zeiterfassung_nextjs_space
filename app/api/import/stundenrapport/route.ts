export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { parseStundenrapportWorkbook, parseStundenrapportCsv, type ImportedProjektRow, type ParsedStundenrapport } from "@/lib/import-stundenrapport";

// Import der alten ONEXIS-Stundenrapporte (ein Kunde/Monat pro Datei,
// mehrere Projektzeilen pro Tag möglich) — siehe lib/import-stundenrapport.ts
// für das Parsing. Anders als /api/import/timesheet (Blatt "Tageszeiten",
// eine Zeile pro Tag) legt dieser Import bei Bedarf Kunde/Projekte selbst an,
// weil das Ziel genau dafür da ist: Altbestände dieses Formats einmalig
// migrieren. Jede Person importiert nur für sich selbst (requireOrg, keine
// targetUserId), gleiches Muster wie /api/import/timesheet.
export async function POST(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    const mode = String(formData?.get("mode") ?? "preview") === "commit" ? "commit" : "preview";
    // Kunde aus dem UI-Vorschlag/der Bestätigung — überschreibt den aus der
    // Datei gelesenen Vorschlag, falls die Person ihn korrigiert hat.
    const customerNameOverride = String(formData?.get("customerName") ?? "").trim() || null;

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Keine Datei erhalten" }, { status: 400 });
    }

    const fileName = (file as any)?.name ? String((file as any).name) : "";
    const isCsv = /\.csv$/i.test(fileName) || file.type === "text/csv";

    const buf = Buffer.from(await file.arrayBuffer());
    let parsed: ParsedStundenrapport | undefined;
    if (isCsv) {
      parsed = parseStundenrapportCsv(buf.toString("latin1"));
    } else {
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(buf);
      } catch {
        // Kein gültiges .xlsx — evtl. eine .csv ohne (oder mit falscher)
        // Endung/Content-Type. Als Fallback als latin1-Text versuchen, statt
        // einfach abzulehnen.
        parsed = parseStundenrapportCsv(buf.toString("latin1"));
      }
      if (!parsed) parsed = parseStundenrapportWorkbook(workbook);
    }

    const customerName = customerNameOverride ?? parsed.customerName;
    if (!customerName) {
      return NextResponse.json({
        mode, errors: [{ rowNumber: 0, message: 'Kein Kundenname gefunden — bitte "Kunde:" in der Datei prüfen oder im Formular angeben.' }],
        totalRows: parsed.rows.length,
      });
    }

    // Kunde case-insensitiv gegen bestehende Kunden der Organisation
    // abgleichen — sonst neu anlegen (anders als der "Tageszeiten"-Import,
    // der einen unbekannten Kunden bewusst als Fehler meldet: hier IST das
    // Anlegen der Zweck der Migration, siehe Kommentar oben).
    const existingCustomers = await prisma.customer.findMany({ where: { orgId }, select: { id: true, name: true, billable: true } });
    let customer = existingCustomers.find((c) => c.name.trim().toLowerCase() === customerName.toLowerCase()) ?? null;
    const customerIsNew = !customer;
    if (!customer && mode === "commit") {
      customer = await prisma.customer.create({ data: { orgId, name: customerName } });
    }

    // Projekte: distinkte normalisierte Namen aus den Zeilen. Ohne
    // bestehenden (oder gerade angelegten) Kunden kann kein Projekt
    // abgeglichen werden — im preview-Modus für einen neuen Kunden gelten
    // deshalb alle Projekte als neu.
    const distinctProjectNames = [...new Set(parsed.rows.map((r) => r.projektName))];
    const existingProjects = customer
      ? await prisma.project.findMany({ where: { orgId, customerId: customer.id }, select: { id: true, name: true } })
      : [];
    const projectByName = new Map<string, string>(); // normalisierter Name (lowercase) -> projectId
    for (const p of existingProjects) projectByName.set(p.name.trim().toLowerCase(), p.id);

    const newProjectNames = distinctProjectNames.filter((n) => !projectByName.has(n.toLowerCase()));

    if (mode === "commit" && customer) {
      for (const name of newProjectNames) {
        const project = await prisma.project.create({ data: { orgId, customerId: customer.id, name } });
        projectByName.set(name.toLowerCase(), project.id);
      }
    }

    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    let skippedExisting = 0;
    let skippedLocked = 0;
    const toCreate: Array<ImportedProjektRow & { projectId: string | null; customerId: string | null }> = [];

    if (parsed.rows.length > 0) {
      const sortedDates = [...parsed.rows.map((r) => r.date)].sort();
      dateFrom = sortedDates[0];
      dateTo = sortedDates[sortedDates.length - 1];

      // Dedup pro ZEILE (Datum + Projekt + Stunden + Task), nicht pro Tag —
      // ein Tag darf mehrere Projektzeilen haben, die alle einzeln importiert
      // werden sollen; nur eine exakt schon vorhandene Zeile wird
      // übersprungen (macht den Import wiederholbar, ohne echte
      // Zweit-Projekte am selben Tag zu blockieren).
      const existingEntries = await prisma.timeEntry.findMany({
        where: {
          userId, orgId, deletedAt: null, type: "arbeit",
          date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T00:00:00Z`) },
          projectId: { not: null },
        },
        select: { date: true, projectId: true, hours: true, notiz: true },
      });
      const existingKeys = new Set(
        existingEntries.map((e) => `${e.date.toISOString().slice(0, 10)}|${e.projectId}|${e.hours}|${e.notiz ?? ""}`)
      );

      let lockedYearMonths = new Set<string>();
      if (role === "member") {
        const yearMonths = new Set(parsed.rows.map((r) => r.date.slice(0, 7)));
        const locks = await prisma.monthLock.findMany({
          where: {
            orgId, userId,
            OR: [...yearMonths].map((ym) => { const [y, m] = ym.split("-").map(Number); return { year: y, month: m }; }),
          },
          select: { year: true, month: true },
        });
        lockedYearMonths = new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, "0")}`));
      }

      for (const row of parsed.rows) {
        const projectId = projectByName.get(row.projektName.toLowerCase()) ?? null;
        const key = `${row.date}|${projectId}|${row.hours}|${row.task ?? ""}`;
        if (projectId && existingKeys.has(key)) { skippedExisting++; continue; }
        if (lockedYearMonths.has(row.date.slice(0, 7))) { skippedLocked++; continue; }
        toCreate.push({ ...row, projectId, customerId: customer?.id ?? null });
      }

      if (mode === "commit" && toCreate.length > 0) {
        await prisma.timeEntry.createMany({
          data: toCreate.map((r) => ({
            userId, orgId, date: new Date(`${r.date}T00:00:00Z`), type: "arbeit",
            hours: r.hours, notiz: r.task, projectId: r.projectId, customerId: r.customerId,
            billable: customer?.billable ?? false,
          })),
        });
      }
    }

    return NextResponse.json({
      mode,
      customerName,
      customerIsNew,
      newProjects: newProjectNames,
      imported: toCreate.length,
      skippedExisting,
      skippedLocked,
      totalRows: parsed.rows.length,
      dateFrom,
      dateTo,
      errors: parsed.errors,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("POST import/stundenrapport error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
