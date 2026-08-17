export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, listVisibleUserIds, AccessError } from "@/lib/access";
import { teamKennzahlen, feriensaldo, wochenUebersicht, montagDerWoche, stundenAusEintrag, type HolidayInput, type TeamMemberInput } from "@/lib/calc";
import { buildProfil, mapChanges, mapEintraege, parseExportRange } from "@/lib/export-helpers";

// Wie weit die Auslastungsprognose ("geplante Auslastung der kommenden
// Wochen", MIGRATION.md Punkt 8) nach vorne schaut — bewusst UNABHÄNGIG vom
// gewählten Berichtszeitraum (type/year/month), da die Prognose immer ab der
// aktuellen Woche in die Zukunft blickt, während der Berichtszeitraum
// typischerweise ein vergangener/laufender Monat/Quartal ist. 8 Wochen ist
// eine dokumentierte, aber willkürliche Wahl (rund zwei Monate) — kein
// Gesetzeswert wie bei den ArG-Konstanten, einfach ein sinnvoller
// Planungshorizont.
const FORECAST_WEEKS = 8;

export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    const { orgId, userId, role } = ctx;
    requireRole(role, ["owner", "admin", "manager"]);

    const url = new URL(req.url);
    const { startDate, endDate } = parseExportRange(url);
    const heute = new Date();

    const forecastStart = montagDerWoche(heute);
    const forecastEnd = new Date(forecastStart.getTime() + (FORECAST_WEEKS * 7 - 1) * 24 * 60 * 60 * 1000);

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

    // Ein Entries-Fetch pro Person deckt sowohl den Berichtszeitraum als
    // auch das Prognosefenster ab — kennzahlen()/wochenUebersicht() filtern
    // beide intern auf ihr jeweils übergebenes [from,to], überzählige
        // Zeilen aus dem jeweils anderen Fenster stören nicht.
    const queryStart = startDate.getTime() < forecastStart.getTime() ? startDate : forecastStart;
    const queryEnd = endDate.getTime() > forecastEnd.getTime() ? endDate : forecastEnd;

    const teamMembers: TeamMemberInput[] = [];
    const heatmap: Array<{ userId: string; name: string; weeks: Array<{ montag: string; verrechnungsgrad: number; arbeitsstunden: number }> }> = [];
    const forecast: Array<{ userId: string; name: string; weeks: Array<{ montag: string; auslastung: number; geplantStunden: number; sollStunden: number }> }> = [];
    const feriensaldoByUser: Record<string, { anspruch: number; bezogen: number; geplant: number; offen: number }> = {};
    // Aktuelles (nicht historisches) Pensum für die Tabellenspalte — gleiche
    // Wahl wie im Lohnexport (Punkt 7): die Tabelle zeigt den heute gültigen
    // Vertragswert, nicht die historische Basis, die buildProfil() intern
    // für sollStundenTag/pensumAt braucht.
    const pensumByUser: Record<string, number> = {};
    // Für die Kunden-/Projektsicht: alle "arbeit"-Einträge der sichtbaren
    // Mitglieder im Berichtszeitraum, projekt-/kundenbezogen aggregiert.
    const projectHours = new Map<string, number>();
    const customerHoursDirekt = new Map<string, number>(); // ohne projectId, nur customerId

    // Vier Queries für ALLE sichtbaren Personen statt vier je Person
    // (HARDENING.md B4). Vorher lief die Schleife unten pro Mitglied einmal
    // durch und setzte dort ihre Queries ab: bei 60 Mitgliedern 243 statt 3
    // Queries, in 60 nacheinander abgearbeiteten Runden. Die Berechnung
    // selbst ist unverändert — nur das Laden ist gebündelt und wird unten
    // in-memory nach userId zugeordnet.
    const alleUserIds = memberships.map((m) => m.userId);
    const jahrStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
    const jahrEnde = new Date(Date.UTC(startDate.getUTCFullYear(), 11, 31));
    const [alleChanges, alleEntries, allePayouts, alleFerien] = await Promise.all([
      prisma.pensumChange.findMany({ where: { userId: { in: alleUserIds }, orgId }, orderBy: { effectiveFrom: "asc" } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, date: { gte: queryStart, lte: queryEnd } } }),
      prisma.overtimePayout.findMany({ where: { userId: { in: alleUserIds }, orgId, date: { gte: startDate, lte: endDate } } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, type: "ferien", date: { gte: jahrStart, lte: jahrEnde } } }),
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

      teamMembers.push({ userId: m.userId, name, profil, changes, eintraege, payouts });

      const fs = feriensaldo({ jahr: startDate.getUTCFullYear(), heute, profil, changes, holidays, eintraege: mapEintraege(ferienRaw) });
      feriensaldoByUser[m.userId] = fs;
      pensumByUser[m.userId] = m.pensum;

      const heatmapWochen = wochenUebersicht(eintraege, profil, changes, holidays, startDate, endDate);
      heatmap.push({
        userId: m.userId,
        name,
        weeks: heatmapWochen.map((w) => ({ montag: w.montag, verrechnungsgrad: w.verrechnungsgrad, arbeitsstunden: w.arbeitsstunden })),
      });

      const forecastWochen = wochenUebersicht(eintraege, profil, changes, holidays, forecastStart, forecastEnd);
      forecast.push({
        userId: m.userId,
        name,
        weeks: forecastWochen.map((w) => ({ montag: w.montag, auslastung: w.auslastung, geplantStunden: w.arbeitsstunden, sollStunden: w.sollStunden })),
      });

      for (const e of entries) {
        if (e.type !== "arbeit") continue;
        if (e.date.getTime() < startDate.getTime() || e.date.getTime() > endDate.getTime()) continue;
        // sollStundenDesTages ist für typ="arbeit" irrelevant, siehe wochenUebersicht oben.
        const stunden = stundenAusEintrag({ typ: "arbeit", von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, 0);
        if (e.projectId) {
          projectHours.set(e.projectId, (projectHours.get(e.projectId) ?? 0) + stunden);
        } else if (e.customerId) {
          customerHoursDirekt.set(e.customerId, (customerHoursDirekt.get(e.customerId) ?? 0) + stunden);
        }
      }
    }

    const result = teamKennzahlen({ from: startDate, to: endDate, heute, holidays, members: teamMembers });
    const membersWithFerien = result.members.map((m) => ({ ...m, pensum: pensumByUser[m.userId], feriensaldo: feriensaldoByUser[m.userId] }));

    // Kunden-/Projektsicht (MIGRATION.md Punkt 8, dritter Bullet) — nur
    // Stunden der SICHTBAREN Mitglieder (bei manager: nur das eigene Team),
    // Projekte/Kunden selbst sind org-weite Stammdaten.
    const [projectsRaw, customersRaw] = await Promise.all([
      prisma.project.findMany({ where: { orgId, active: true }, include: { customer: { select: { name: true, hourlyRate: true } } } }),
      prisma.customer.findMany({ where: { orgId } }),
    ]);
    const projects = projectsRaw.map((p) => {
      const stunden = Math.round((projectHours.get(p.id) ?? 0) * 100) / 100;
      const rate = p.hourlyRate ?? p.customer.hourlyRate ?? 0;
      return {
        id: p.id,
        name: p.name,
        customerName: p.customer.name,
        hourlyRate: rate,
        budgetHours: p.budgetHours,
        stunden,
        umsatz: Math.round(stunden * rate * 100) / 100,
        ueberzogen: p.budgetHours != null && stunden > p.budgetHours,
      };
    });
    const customers = customersRaw.map((c) => {
      const direktStunden = customerHoursDirekt.get(c.id) ?? 0;
      // Nach customerId matchen, nicht nach Name — auch wenn der Name laut
      // Schema (@@unique([orgId,name])) org-weit eindeutig ist, ist die ID
      // der direktere, weniger fehleranfällige Schlüssel.
      const projektStunden = projectsRaw.filter((p) => p.customerId === c.id).reduce((s, p) => s + (projectHours.get(p.id) ?? 0), 0);
      const stunden = Math.round((direktStunden + projektStunden) * 100) / 100;
      return { id: c.id, name: c.name, hourlyRate: c.hourlyRate, stunden, umsatz: Math.round(stunden * (c.hourlyRate ?? 0) * 100) / 100 };
    });

    return NextResponse.json({
      members: membersWithFerien,
      totals: result.totals,
      heatmap,
      forecast,
      customers,
      projects,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET team error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
