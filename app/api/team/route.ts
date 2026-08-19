export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, listVisibleUserIds, AccessError } from "@/lib/access";
import { teamKennzahlen, feriensaldo, pensumAt, type HolidayInput, type TeamMemberInput } from "@/lib/calc";
import { buildProfil, mapChanges, mapEintraege, parseExportRange } from "@/lib/export-helpers";
import { monthsInRange, sumCustomerHoursByUser } from "@/lib/customer-months";

export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, userId, role } = ctx;
    requireRole(role, ["owner", "admin", "manager"]);

    const url = new URL(req.url);
    const { startDate, endDate } = parseExportRange(url);
    const heute = new Date();

    // Manager sieht nur sich selbst + direkt unterstellte Mitglieder,
    // admin/owner sehen die ganze Organisation — siehe listVisibleUserIds().
    const visibleUserIds = await listVisibleUserIds(ctx);
    const visibilityFilter = visibleUserIds ? { userId: { in: visibleUserIds } } : {};

    // Nur Mitgliedschaften, die im gewählten Zeitraum mindestens einen Tag
    // aktiv waren — dieselbe Logik wie im Lohnexport (Punkt 7), damit ein
    // während des Zeitraums ausgetretenes Mitglied nicht fehlt.
    const memberships = await prisma.membership.findMany({
      where: {
        orgId,
        AND: [{ entryDate: { lte: endDate }, OR: [{ exitDate: null }, { exitDate: { gte: startDate } }] }, visibilityFilter],
      },
      include: { org: true, user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    });

    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
    const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

    const teamMembers: TeamMemberInput[] = [];
    const feriensaldoByUser: Record<string, { anspruch: number; bezogen: number; geplant: number; offen: number }> = {};
    // Zum Periodenende (endDate) gültiges Pensum für die Tabellenspalte —
    // NICHT membership.pensum (der heute aktuelle Wert), sonst zeigt eine
    // Abfrage für einen vergangenen Monat ein Pensum, das erst später in
    // Kraft trat (Bugfix: April 2026 zeigte "80%", obwohl der Wechsel von
    // 60% auf 80% erst per September 2026 galt). pensumAt() ist dieselbe
    // Auflösung, die sollStundenTag()/Soll unten schon korrekt verwendet.
    const pensumByUser: Record<string, number> = {};

    // Fünf Queries für ALLE sichtbaren Personen statt einer je Person
    // (HARDENING.md B4). Vorher lief die Schleife unten pro Mitglied einmal
    // durch und setzte dort ihre Queries ab: bei 60 Mitgliedern 300+ statt 5
    // Queries, in 60 nacheinander abgearbeiteten Runden. Die Berechnung
    // selbst ist unverändert — nur das Laden ist gebündelt und wird unten
    // in-memory nach userId zugeordnet.
    const alleUserIds = memberships.map((m) => m.userId);
    const jahrStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
    const jahrEnde = new Date(Date.UTC(startDate.getUTCFullYear(), 11, 31));
    const monate = monthsInRange(startDate, endDate);
    const [alleChanges, alleEntries, allePayouts, alleFerien, alleCustomerMonths, kundenstundenByUser] = await Promise.all([
      prisma.pensumChange.findMany({ where: { userId: { in: alleUserIds }, orgId }, orderBy: { effectiveFrom: "asc" } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
      prisma.overtimePayout.findMany({ where: { userId: { in: alleUserIds }, orgId, date: { gte: startDate, lte: endDate } } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, type: "ferien", date: { gte: jahrStart, lte: jahrEnde } } }),
      // Nur noch für die Kunden-/Projekt-Umsatzsicht unten (customers[]/
      // projects[]) — die zeigt weiterhin ausschliesslich Monate, die über
      // die alte monatliche Kundenstunden-Erfassung liefen. Seit dem
      // Nachtrag "Projektstunden pro Tag" entstehen hier keine neuen Zeilen
      // mehr; eine Umstellung dieser Sicht auf TimeEntry-Projektstunden
      // (inkl. Stundensatz/Budget je Projekt) ist ein eigenes, noch
      // ausstehendes Stück Arbeit.
      monate.length === 0
        ? Promise.resolve([])
        : prisma.customerMonth.findMany({
            where: { orgId, userId: { in: alleUserIds }, OR: monate.map((mo) => ({ year: mo.year, month: mo.month })) },
            include: { customer: { select: { name: true, billable: true, hourlyRate: true } }, project: { select: { name: true, hourlyRate: true, budgetHours: true } } },
          }),
      // Kundenstunden für kennzahlen().verrechnungsgrad je Person — neu aus
      // TimeEntry berechnet, mit Fallback auf CustomerMonth für noch nicht
      // nacherfasste Monate (lib/customer-months.ts).
      sumCustomerHoursByUser({ orgId, userIds: alleUserIds, from: startDate, to: endDate }),
    ]);

    // Gruppierung erhält die Reihenfolge der Query — für pensumChange ist das
    // das `orderBy: effectiveFrom asc` von oben, auf das sich pensumAt bei
    // zwei Änderungen am selben Tag verlässt (HARDENING.md A2).
    function nachUser<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const liste = map.get(row.userId);
        if (liste) liste.push(row);
        else map.set(row.userId, [row]);
      }
      return map;
    }
    const changesByUser = nachUser(alleChanges);
    const entriesByUser = nachUser(alleEntries);
    const payoutsByUser = nachUser(allePayouts);
    const ferienByUser = nachUser(alleFerien);

    for (const m of memberships) {
      const profil = buildProfil(m);
      const pensumChangesRaw = changesByUser.get(m.userId) ?? [];
      const entries = entriesByUser.get(m.userId) ?? [];
      const payoutsRaw = payoutsByUser.get(m.userId) ?? [];
      const ferienRaw = ferienByUser.get(m.userId) ?? [];
      const changes = mapChanges(pensumChangesRaw);
      const eintraege = mapEintraege(entries);
      const payouts = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));
      const name = `${m.user.firstName} ${m.user.lastName}`;

      teamMembers.push({ userId: m.userId, name, profil, changes, eintraege, payouts, kundenstunden: kundenstundenByUser.get(m.userId) ?? 0 });

      const fs = feriensaldo({ jahr: startDate.getUTCFullYear(), heute, profil, changes, holidays, eintraege: mapEintraege(ferienRaw) });
      feriensaldoByUser[m.userId] = fs;
      pensumByUser[m.userId] = pensumAt(endDate, profil, changes).pensum;
    }

    const result = teamKennzahlen({ from: startDate, to: endDate, heute, holidays, members: teamMembers });
    const membersWithFerien = result.members.map((m) => ({ ...m, pensum: pensumByUser[m.userId], feriensaldo: feriensaldoByUser[m.userId] }));

    // Kunden-/Projektsicht: dieselben CustomerMonth-Zeilen wie oben, hier
    // nach Kunde bzw. Projekt statt nach Person aggregiert — über alle
    // sichtbaren Mitglieder hinweg (bei manager: nur das eigene Team).
    // Zeilen ohne projectId zählen zum Kunden direkt, Zeilen mit projectId
    // zusätzlich zu ihrem Projekt.
    const projectAgg = new Map<string, { name: string; customerName: string; customerId: string; hourlyRate: number | null; budgetHours: number | null; stunden: number }>();
    const customerAgg = new Map<string, { name: string; hourlyRate: number | null; stunden: number }>();
    for (const cm of alleCustomerMonths) {
      const cur = customerAgg.get(cm.customerId) ?? { name: cm.customer.name, hourlyRate: cm.customer.hourlyRate, stunden: 0 };
      cur.stunden += cm.hours;
      customerAgg.set(cm.customerId, cur);

      if (cm.projectId && cm.project) {
        const p = projectAgg.get(cm.projectId) ?? {
          name: cm.project.name,
          customerName: cm.customer.name,
          customerId: cm.customerId,
          hourlyRate: cm.project.hourlyRate,
          budgetHours: cm.project.budgetHours,
          stunden: 0,
        };
        p.stunden += cm.hours;
        projectAgg.set(cm.projectId, p);
      }
    }
    const projects = Array.from(projectAgg.entries()).map(([id, p]) => {
      const stunden = Math.round(p.stunden * 100) / 100;
      // Fallback-Kette wie zuvor: eigener Stundensatz des Projekts, sonst
      // der des Kunden, sonst 0.
      const rate = p.hourlyRate ?? customerAgg.get(p.customerId)?.hourlyRate ?? 0;
      return {
        id,
        name: p.name,
        customerName: p.customerName,
        hourlyRate: rate,
        budgetHours: p.budgetHours,
        stunden,
        umsatz: Math.round(stunden * rate * 100) / 100,
        ueberzogen: p.budgetHours != null && stunden > p.budgetHours,
      };
    });
    const customers = Array.from(customerAgg.entries()).map(([id, c]) => {
      const stunden = Math.round(c.stunden * 100) / 100;
      return { id, name: c.name, hourlyRate: c.hourlyRate, stunden, umsatz: Math.round(stunden * (c.hourlyRate ?? 0) * 100) / 100 };
    });

    return NextResponse.json({
      members: membersWithFerien,
      totals: result.totals,
      customers,
      projects,
      // Zeigt der Oberfläche, ob [startDate,endDate] nicht exakt auf
      // Monatsgrenzen liegt — dann sind Kundenstunden/Umsatz nur eine
      // Annäherung (volle überlappende Monate gezählt), siehe
      // lib/customer-months.ts.
      kundenstundenUnscharf: monate.length > 0 && !(isMonthStart(startDate) && isMonthEnd(endDate)),
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET team error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

function isMonthStart(d: Date): boolean {
  return d.getUTCDate() === 1;
}
function isMonthEnd(d: Date): boolean {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCDate() === 1;
}
