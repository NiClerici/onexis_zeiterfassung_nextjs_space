export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, AccessError } from "@/lib/access";
import { parseYearMonthFromUrl } from "@/lib/export-helpers";
import { stundenAusEintrag } from "@/lib/calc";
import { logError } from "@/lib/error-log";
import { ownProjectsWhere } from "@/lib/visibility";
import { renderStundenrapportPdf } from "@/lib/pdf-stundenrapport";

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Dateinamen dürfen keine Leerzeichen enthalten (Vorlagenstil:
// "ONEXIS_Stundenabbrechnung_April-26_NClerici.pdf").
function fileSafeName(name: string): string {
  return name.replace(/[\\/?*[\]:"<>|]/g, " ").trim().replace(/\s+/g, "-");
}

const NO_PROJECT_KEY = "__ohne-projekt__";
const NO_PROJECT_LABEL = "(ohne Projekt)";

// Export als PDF (ersetzt den früheren ExcelJS-Export vollständig, siehe
// lib/pdf-stundenrapport.ts) — ein Kunde und ein Monat pro Datei: oben ein
// Projektkatalog, darunter die Tages-/Projektzeilen. Weiterhin AM Layout des
// alten ONEXIS-Stundenrapports orientiert (Kopf mit Person/Monat/Kunde,
// Katalog, Detail, Stunden-Total) — bewusst NICHT mehr enthalten: die Spalte
// "Betrag ohne MwSt" und die Zeile "Total (o. MwSt)" (Nutzerwunsch), sowie
// Katalogzeilen mit 0.00 Std (Bugfix "falsche Projekte" — ein eigenes
// Projekt aus einem früheren Monat oder ohne jede Buchung gehört nicht in
// den Rapport EINES Monats). Datenquelle sind die Tageseinträge (TimeEntry
// mit Projekt/Kunde), die direkt im Kalender erfasst werden.
export async function GET(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();
    const url = new URL(req.url);
    const { year, month } = parseYearMonthFromUrl(url);
    const customerId = url.searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ error: "customerId fehlt" }, { status: 400 });
    }

    const [customer, membership, logo] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, orgId } }),
      prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { user: true, org: true } }),
      prisma.organizationLogo.findUnique({ where: { orgId } }),
    ]);
    if (!customer) return NextResponse.json({ error: "Kunde nicht gefunden" }, { status: 404 });
    if (!membership) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));

    // Katalog nur mit EIGENEN Projekten (lib/visibility.ts, gleiche Regel
    // wie GET /api/projects für "member") — der Rapport ist ein persönliches
    // Dokument, deshalb gilt der Filter für jede Rolle, auch für
    // owner/admin/manager. Ohne ihn stünden Projekte von Kolleg:innen meist
    // mit 0.00 h im Katalog (Bug: "sehe Projekte der anderen Mitarbeiter").
    const ownFilter = await ownProjectsWhere(orgId, userId);
    const [entries, activeProjects] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { userId, orgId, type: "arbeit", deletedAt: null, customerId: customer.id, date: { gte: monthStart, lte: monthEnd } },
        include: { project: { select: { id: true, name: true, externalRef: true } } },
        orderBy: { date: "asc" },
      }),
      prisma.project.findMany({ where: { orgId, customerId: customer.id, active: true, ...ownFilter }, orderBy: { name: "asc" } }),
    ]);

    const kuerzel = membership.kuerzel ?? "";
    const personName = `${membership.user.firstName} ${membership.user.lastName}, ${membership.org.name}`;

    const rows = entries.map((e) => ({
      date: e.date,
      kuerzel,
      projectId: e.project?.id ?? null,
      projektName: e.project?.name ?? NO_PROJECT_LABEL,
      task: e.notiz ?? "",
      hours: round2(stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0)),
    }));

    // Stunden je Projekt (bzw. "ohne Projekt") für den Katalogblock —
    // dieselbe Zuordnung, die auch die Detailzeilen tragen, damit
    // Kopfsumme und Detailsumme nie auseinanderlaufen.
    const hoursByKey = new Map<string, number>();
    for (const r of rows) {
      const key = r.projectId ?? NO_PROJECT_KEY;
      hoursByKey.set(key, (hoursByKey.get(key) ?? 0) + r.hours);
    }

    // Katalog = eigene Projekte des Kunden UND Projekte, auf die im
    // Exportmonat tatsächlich gebucht wurde. Nur Projekte mit hours > 0
    // erscheinen (Filter unten) — ein eigenes Projekt aus einem früheren
    // Monat oder ganz ohne Buchung ist für DIESEN Monatsrapport keine
    // richtige Information, sondern Rauschen (Bugfix "falsche Projekte").
    const catalogByKey = new Map<string, { label: string; sortKey: string }>();
    for (const p of activeProjects) {
      catalogByKey.set(p.id, {
        label: p.externalRef ? `${p.externalRef} | ${p.name}` : p.name,
        sortKey: p.name,
      });
    }
    for (const e of entries) {
      if (e.project && !catalogByKey.has(e.project.id)) {
        catalogByKey.set(e.project.id, {
          label: e.project.externalRef ? `${e.project.externalRef} | ${e.project.name}` : e.project.name,
          sortKey: e.project.name,
        });
      }
    }
    const catalogRows = [...catalogByKey.entries()]
      .map(([key, v]) => ({ key, label: v.label, sortKey: v.sortKey, hours: hoursByKey.get(key) ?? 0 }));
    if (hoursByKey.has(NO_PROJECT_KEY)) {
      catalogRows.push({ key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL, sortKey: NO_PROJECT_LABEL, hours: hoursByKey.get(NO_PROJECT_KEY) ?? 0 });
    }
    const filteredCatalogRows = catalogRows
      .filter((c) => c.hours > 0)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((c) => ({ label: c.label, hours: c.hours }));

    const buffer = await renderStundenrapportPdf({
      personName,
      monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
      customerName: customer.name,
      catalogRows: filteredCatalogRows,
      detailRows: rows.map((r) => ({ date: r.date, kuerzel: r.kuerzel, projektName: r.projektName, task: r.task, hours: r.hours })),
      logo: logo ? { data: Buffer.from(logo.data), mimeType: logo.mimeType } : undefined,
    });

    const orgPrefix = fileSafeName(membership.org.name.split(/\s+/)[0] ?? "Export");
    const monthSlug = `${MONTH_NAMES[month - 1]}-${String(year % 100).padStart(2, "0")}`;
    const initials = `${membership.user.firstName?.[0] ?? ""}${membership.user.lastName ?? ""}`;
    const fileName = `${orgPrefix}_Stundenabbrechnung_${monthSlug}_${fileSafeName(customer.name)}_${fileSafeName(initials)}.pdf`;

    return new Response(buffer as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET export/stundenrapport error:", error);
    await logError("GET /api/export/stundenrapport", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
