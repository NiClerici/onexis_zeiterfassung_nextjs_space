export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, assertMonthEditable, AccessError } from "@/lib/access";
import { stundenAusEintrag } from "@/lib/calc";

// Gleiches Muster wie app/api/pensum-changes/route.ts:17-25 — owner/admin
// dürfen den Monat einer anderen Person lesen/schreiben, member nur den
// eigenen.
async function resolveTargetUserId(orgId: string, callerUserId: string, callerRole: string, requestedUserId: unknown): Promise<string> {
  const targetUserId = typeof requestedUserId === "string" && requestedUserId ? requestedUserId : callerUserId;
  if (targetUserId !== callerUserId) {
    requireRole(callerRole as any, ["owner", "admin"]);
    const targetMembership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: targetUserId } } });
    if (!targetMembership) throw new AccessError(404, "Membership not found");
  }
  return targetUserId;
}

function parseYearMonth(year: unknown, month: unknown): { year: number; month: number } {
  const y = parseInt(String(year), 10);
  const m = parseInt(String(month), 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) throw new AccessError(400, "Ungültiges Jahr");
  if (!Number.isFinite(m) || m < 1 || m > 12) throw new AccessError(400, "Ungültiger Monat");
  return { year: y, month: m };
}

export async function GET(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();
    const url = new URL(req.url);
    const { year, month } = parseYearMonth(url.searchParams.get("year"), url.searchParams.get("month"));
    const targetUserId = await resolveTargetUserId(orgId, userId, role, url.searchParams.get("userId"));

    const rows = await prisma.customerMonth.findMany({
      where: { orgId, userId: targetUserId, year, month },
      orderBy: [{ customerId: "asc" }, { projectId: "asc" }],
    });

    // Erfasste Arbeitszeit desselben Monats, für den Abgleich in der
    // Oberfläche ("120h erfasst, davon 95h Kunden zugeordnet"). tagesSoll
    // spielt für typ="arbeit" keine Rolle (siehe lib/calc.ts), 0 reicht.
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const workEntries = await prisma.timeEntry.findMany({
      where: { orgId, userId: targetUserId, deletedAt: null, type: "arbeit", date: { gte: monthStart, lte: monthEnd } },
    });
    const arbeitsstunden = workEntries.reduce(
      (s, e) => s + stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0),
      0
    );

    return NextResponse.json({ rows, arbeitsstunden: Math.round(arbeitsstunden * 100) / 100 });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET customer-months error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

// Ersetzt alle Zeilen eines Monats auf einmal (statt einzelner POST/DELETE)
// — passt zur Bedienung "Monat ausfüllen, speichern" (Plan, Abschnitt
// "Erfassung (neu)").
export async function PUT(req: Request) {
  try {
    const { userId, orgId, role } = await requireOrg();
    const body = await req?.json?.().catch(() => ({}));
    const { year, month } = parseYearMonth(body?.year, body?.month);
    const targetUserId = await resolveTargetUserId(orgId, userId, role, body?.userId);

    await assertMonthEditable(orgId, targetUserId, role, new Date(Date.UTC(year, month - 1, 1)));

    const rowsIn = Array.isArray(body?.rows) ? body.rows : [];
    if (rowsIn.length > 200) {
      return NextResponse.json({ error: "Zu viele Zeilen" }, { status: 400 });
    }

    // Kunden/Projekte gehören wirklich zu dieser Organisation, sonst könnte
    // eine fremde customerId untergeschoben werden.
    const customerIds = [...new Set(rowsIn.map((r: any) => r?.customerId).filter(Boolean))];
    const projectIds = [...new Set(rowsIn.map((r: any) => r?.projectId).filter(Boolean))];
    const [orgCustomers, orgProjects] = await Promise.all([
      customerIds.length ? prisma.customer.findMany({ where: { orgId, id: { in: customerIds as string[] } } }) : Promise.resolve([]),
      projectIds.length ? prisma.project.findMany({ where: { orgId, id: { in: projectIds as string[] } } }) : Promise.resolve([]),
    ]);
    const customerSet = new Set(orgCustomers.map((c) => c.id));
    const projectByCustomer = new Map(orgProjects.map((p) => [p.id, p.customerId]));

    const parsedRows: { customerId: string; projectId: string | null; hours: number }[] = [];
    // Innerhalb einer PUT-Anfrage darf dieselbe Kombination Kunde+Projekt
    // nicht doppelt vorkommen — @@unique gibt es in CustomerMonth bewusst
    // nicht (Prisma-NULL-Semantik), also muss die Route das prüfen.
    const seen = new Set<string>();
    for (const r of rowsIn) {
      const customerId = r?.customerId;
      const projectId = r?.projectId || null;
      const hours = Math.round(parseFloat(r?.hours) * 100) / 100;
      if (typeof customerId !== "string" || !customerSet.has(customerId)) {
        return NextResponse.json({ error: "Ungültiger Kunde" }, { status: 400 });
      }
      if (projectId !== null && projectByCustomer.get(projectId) !== customerId) {
        return NextResponse.json({ error: "Projekt gehört nicht zu diesem Kunden" }, { status: 400 });
      }
      if (!Number.isFinite(hours) || hours < 0 || hours > 800) {
        return NextResponse.json({ error: "Ungültige Stundenzahl (0–800)" }, { status: 400 });
      }
      if (hours === 0) continue; // Nullzeilen nicht speichern
      const key = `${customerId}:${projectId ?? ""}`;
      if (seen.has(key)) {
        return NextResponse.json({ error: "Kunde/Projekt doppelt in derselben Anfrage" }, { status: 400 });
      }
      seen.add(key);
      parsedRows.push({ customerId, projectId, hours });
    }

    await prisma.$transaction([
      prisma.customerMonth.deleteMany({ where: { orgId, userId: targetUserId, year, month } }),
      ...parsedRows.map((r) =>
        prisma.customerMonth.create({
          data: { orgId, userId: targetUserId, year, month, customerId: r.customerId, projectId: r.projectId, hours: r.hours },
        })
      ),
    ]);

    const rows = await prisma.customerMonth.findMany({
      where: { orgId, userId: targetUserId, year, month },
      orderBy: [{ customerId: "asc" }, { projectId: "asc" }],
    });
    return NextResponse.json({ rows });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PUT customer-months error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
