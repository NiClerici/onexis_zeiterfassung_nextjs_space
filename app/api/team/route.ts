export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, listVisibleUserIds, AccessError } from "@/lib/access";
import { teamKennzahlen, feriensaldo, pensumAt, type HolidayInput, type TeamMemberInput } from "@/lib/calc";
import { kumulierterSaldo, saldoSerie, type KumulierterSaldoResult, type SaldoSeriePunkt } from "@/lib/saldo";
import { buildProfil, mapChanges, mapEintraege, parseExportRange } from "@/lib/export-helpers";
import { monthsInRange, sumCustomerHoursByUser, customerHoursByUserAndCustomer, projectHoursByUserAndProject } from "@/lib/customer-months";
import { logError } from "@/lib/error-log";

// Lokale Kopie von lib/calc.ts toUTCDate() (dort nicht exportiert) —
// normalisiert Date/String auf UTC-Mitternacht, dieselbe Kopie wie in
// app/api/analytics/route.ts.
function toUTCDateLocal(input: Date | string): Date {
  if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(input);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

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

    const alleUserIds = memberships.map((m) => m.userId);
    const jahrStart = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
    const jahrEnde = new Date(Date.UTC(startDate.getUTCFullYear(), 11, 31));
    const monate = monthsInRange(startDate, endDate);

    // Team-Hub: ist der gewählte Zeitraum genau ein Kalendermonat? Nur dann
    // ergibt ein Monatsabschluss für diesen Zeitraum Sinn (MonthLock ist
    // monatsweise) — Grundlage für den "Monat für Team abschliessen"-Button
    // im Hub-Kopf und das monthLocked-Flag je Person.
    const isSingleMonth = isMonthStart(startDate) && isMonthEnd(endDate);
    const lockYear = startDate.getUTCFullYear();
    const lockMonth = startDate.getUTCMonth() + 1;

    // Frühester Punkt, ab dem irgendein sichtbares Mitglied einen kumulierten
    // Saldo braucht (Eintrittsdatum bzw. Start, nie später als der gewählte
    // Zeitraumbeginn) — EIN gebündelter Query für alle statt einem pro
    // Person (HARDENING.md B4-Muster, wie die übrigen Batch-Queries hier).
    const ownSaldoStartByUser = new Map<string, Date>();
    let saldoQueryStart = startDate;
    for (const m of memberships) {
      const s = toUTCDateLocal(m.startDate ?? m.entryDate);
      ownSaldoStartByUser.set(m.userId, s);
      if (s.getTime() < saldoQueryStart.getTime()) saldoQueryStart = s;
    }
    const needsWiderSaldoRange = saldoQueryStart.getTime() < startDate.getTime();

    const [
      alleChanges,
      alleEntries,
      allePayouts,
      alleFerien,
      kundenstundenByUser,
      kundenstundenByUserUndKunde,
      projektstundenByUserUndProjekt,
      monthLocksRaw,
      saldoEntriesRaw,
      saldoPayoutsRaw,
    ] = await Promise.all([
      prisma.pensumChange.findMany({ where: { userId: { in: alleUserIds }, orgId }, orderBy: { effectiveFrom: "asc" } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
      prisma.overtimePayout.findMany({ where: { userId: { in: alleUserIds }, orgId, date: { gte: startDate, lte: endDate } } }),
      prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, type: "ferien", date: { gte: jahrStart, lte: jahrEnde } } }),
      // Kundenstunden für kennzahlen().verrechnungsgrad je Person — neu aus
      // TimeEntry berechnet, mit Fallback auf CustomerMonth für noch nicht
      // nacherfasste Monate (lib/customer-months.ts).
      sumCustomerHoursByUser({ orgId, userIds: alleUserIds, from: startDate, to: endDate }),
      // Dieselbe Auflösung, hier nach Kunde statt nur als Gesamtsumme —
      // Grundlage für die customers[]-Tabelle unten UND für die
      // Kunden-Aufschlüsselung je Person (members[].kundenNachKunde). Vorher
      // zeigte customers[] ausschliesslich CustomerMonth-Migrationswerte;
      // täglich erfasste Kundenstunden (TimeEntry.customerId) fehlten dort
      // komplett, obwohl sie im Verrechnungsgrad oben schon mitzählen.
      customerHoursByUserAndCustomer({ orgId, userIds: alleUserIds, from: startDate, to: endDate }),
      // Projektsicht — jetzt aus TimeEntry.projectId (laufende Tageserfassung)
      // MIT Fallback auf CustomerMonth für migrierte Altmonate, analog zu
      // kundenstundenByUserUndKunde oben (lib/customer-months.ts). Vorher
      // zeigte projects[] ausschliesslich CustomerMonth-Zeilen; für aktuelle
      // Monate war die Tabelle dadurch leer oder veraltet.
      projectHoursByUserAndProject({ orgId, userIds: alleUserIds, from: startDate, to: endDate }),
      isSingleMonth
        ? prisma.monthLock.findMany({ where: { orgId, userId: { in: alleUserIds }, year: lockYear, month: lockMonth } })
        : Promise.resolve([]),
      // Kumulierter Saldo seit Eintritt (lib/saldo.ts) — bisher nur in
      // Analytics für die eigene Person verfügbar, hier gebündelt für alle
      // sichtbaren Mitglieder. Ohne Historie vor dem Zeitraum (kein
      // Mitglied ist vor startDate eingetreten) reichen die Periodendaten
      // (alleEntries/allePayouts oben), der Zusatz-Query entfällt dann.
      needsWiderSaldoRange
        ? prisma.timeEntry.findMany({ where: { userId: { in: alleUserIds }, orgId, deletedAt: null, date: { gte: saldoQueryStart, lte: endDate } } })
        : Promise.resolve([]),
      needsWiderSaldoRange
        ? prisma.overtimePayout.findMany({ where: { userId: { in: alleUserIds }, orgId, date: { gte: saldoQueryStart, lte: endDate } } })
        : Promise.resolve([]),
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
    const saldoEntriesByUser = needsWiderSaldoRange ? nachUser(saldoEntriesRaw) : entriesByUser;
    const saldoPayoutsByUser = needsWiderSaldoRange ? nachUser(saldoPayoutsRaw) : payoutsByUser;
    const lockedUserIds = new Set(monthLocksRaw.map((l) => l.userId));

    // Kundennamen/-sätze für alle Kunden, die irgendeiner sichtbaren Person
    // in kundenstundenByUserUndKunde zugeordnet sind — unabhängig davon, ob
    // dafür jemals eine CustomerMonth-Zeile existierte.
    const alleKundenIds = new Set<string>();
    for (const perCustomer of kundenstundenByUserUndKunde.values()) {
      for (const customerId of perCustomer.keys()) alleKundenIds.add(customerId);
    }
    const kundenMeta = alleKundenIds.size === 0
      ? []
      : await prisma.customer.findMany({ where: { id: { in: Array.from(alleKundenIds) } }, select: { id: true, name: true, hourlyRate: true } });
    const kundenMetaById = new Map(kundenMeta.map((c) => [c.id, c]));

    // Projektnamen/-sätze für alle Projekte, die irgendeiner sichtbaren
    // Person in projektstundenByUserUndProjekt zugeordnet sind.
    const alleProjektIds = new Set<string>();
    for (const perProjekt of projektstundenByUserUndProjekt.values()) {
      for (const projectId of perProjekt.keys()) alleProjektIds.add(projectId);
    }
    const projektMeta = alleProjektIds.size === 0
      ? []
      : await prisma.project.findMany({
          where: { id: { in: Array.from(alleProjektIds) } },
          select: { id: true, name: true, hourlyRate: true, budgetHours: true, customerId: true, customer: { select: { name: true, hourlyRate: true } } },
        });
    const projektMetaById = new Map(projektMeta.map((p) => [p.id, p]));

    const namenByUser = new Map(memberships.map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`]));

    const saldoKumuliertByUser: Record<string, KumulierterSaldoResult> = {};
    const saldoSerieByUser: Record<string, SaldoSeriePunkt[]> = {};

    for (const m of memberships) {
      const profil = buildProfil(m);
      const pensumChangesRaw = changesByUser.get(m.userId) ?? [];
      const entries = entriesByUser.get(m.userId) ?? [];
      const payoutsRaw = payoutsByUser.get(m.userId) ?? [];
      const ferienRaw = ferienByUser.get(m.userId) ?? [];
      const changes = mapChanges(pensumChangesRaw);
      const eintraege = mapEintraege(entries);
      const payouts = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));
      const name = namenByUser.get(m.userId) ?? "?";

      teamMembers.push({ userId: m.userId, name, profil, changes, eintraege, payouts, kundenstunden: kundenstundenByUser.get(m.userId) ?? 0 });

      const fs = feriensaldo({ jahr: startDate.getUTCFullYear(), heute, profil, changes, holidays, eintraege: mapEintraege(ferienRaw) });
      feriensaldoByUser[m.userId] = fs;
      pensumByUser[m.userId] = pensumAt(endDate, profil, changes).pensum;

      // Kumulierter Saldo seit Eintritt — Zeitkonto-Gesamtstand, unabhängig
      // vom gewählten Zeitraum (siehe lib/saldo.ts, bisher nur in Analytics
      // für die eigene Person verfügbar).
      const ownSaldoStart = ownSaldoStartByUser.get(m.userId) ?? startDate;
      const saldoEintraege = mapEintraege(saldoEntriesByUser.get(m.userId) ?? []);
      const saldoPayouts = (saldoPayoutsByUser.get(m.userId) ?? []).map((p) => ({ date: p.date, hours: p.hours }));
      saldoKumuliertByUser[m.userId] = kumulierterSaldo({ profil, changes, holidays, heute, since: ownSaldoStart, to: endDate, eintraege: saldoEintraege, payouts: saldoPayouts });

      // Saldo-Verlauf fürs Mini-Chart in der aufgeklappten Karte — bewusst
      // auf die letzten 12 Monate begrenzt (Monatsgranularität): der
      // kumulierte Gesamtstand steht bereits oben, das Chart soll nur den
      // jüngeren Trend zeigen, nicht die komplette Historie neu durchrechnen.
      // Der Startpunkt dieses Fensters wird deshalb bewusst als "0" gesetzt
      // (hasHistory: false), auch wenn davor schon ein Saldo bestand.
      const seriesWindowStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 11, 1));
      const chartSeriesStart = ownSaldoStart.getTime() > seriesWindowStart.getTime() ? ownSaldoStart : seriesWindowStart;
      const heuteUTC = toUTCDateLocal(heute);
      const seriesLast = endDate.getTime() < heuteUTC.getTime() ? endDate : heuteUTC;
      saldoSerieByUser[m.userId] = saldoSerie({
        profil, changes, holidays, heute,
        seriesStart: chartSeriesStart, periodStart: chartSeriesStart, endDate, seriesLast,
        hasHistory: false, granularity: "month",
        eintraege: saldoEintraege, payouts: saldoPayouts,
      });
    }

    const result = teamKennzahlen({ from: startDate, to: endDate, heute, holidays, members: teamMembers });
    const membersWithFerien = result.members.map((m) => {
      // Kunden-Aufschlüsselung dieser Person, absteigend nach Stunden —
      // dieselbe Auflösung wie in customers[] unten, nur pro Person statt
      // über alle sichtbaren Mitglieder summiert.
      const kundenNachKunde = Array.from(kundenstundenByUserUndKunde.get(m.userId)?.entries() ?? [])
        .map(([customerId, stunden]) => ({ customerId, name: kundenMetaById.get(customerId)?.name ?? "?", stunden: Math.round(stunden * 100) / 100 }))
        .filter((c) => c.stunden > 0)
        .sort((a, b) => b.stunden - a.stunden);
      return {
        ...m,
        pensum: pensumByUser[m.userId],
        feriensaldo: feriensaldoByUser[m.userId],
        kundenNachKunde,
        saldoKumuliert: saldoKumuliertByUser[m.userId],
        saldoSerie: saldoSerieByUser[m.userId],
        monthLocked: isSingleMonth ? lockedUserIds.has(m.userId) : null,
      };
    });

    // Kundensicht: aus TimeEntry (laufende Erfassung) + CustomerMonth-
    // Migration aufgelöst (lib/customer-months.ts customerHoursByUserAndCustomer,
    // dieselbe Regel wie kundenstundenByUser oben) — über alle sichtbaren
    // Mitglieder hinweg (bei manager: nur das eigene Team). nachPerson
    // schlüsselt dieselbe Summe zusätzlich pro Person auf (Kunden-Tab,
    // "wer hat wie viel auf diesen Kunden gebucht").
    const customerAgg = new Map<string, { name: string; hourlyRate: number | null; stunden: number; nachPerson: { userId: string; name: string; stunden: number }[] }>();
    for (const [uid, perCustomer] of kundenstundenByUserUndKunde) {
      for (const [customerId, stunden] of perCustomer) {
        if (stunden <= 0) continue;
        const meta = kundenMetaById.get(customerId);
        const cur = customerAgg.get(customerId) ?? { name: meta?.name ?? "?", hourlyRate: meta?.hourlyRate ?? null, stunden: 0, nachPerson: [] };
        cur.stunden += stunden;
        cur.nachPerson.push({ userId: uid, name: namenByUser.get(uid) ?? "?", stunden: Math.round(stunden * 100) / 100 });
        customerAgg.set(customerId, cur);
      }
    }

    // Projektsicht: aus TimeEntry.projectId + CustomerMonth-Fallback
    // (projektstundenByUserUndProjekt, siehe Query oben) — über alle
    // sichtbaren Mitglieder aggregiert.
    const projectAgg = new Map<string, number>();
    for (const perProjekt of projektstundenByUserUndProjekt.values()) {
      for (const [projectId, stunden] of perProjekt) {
        if (stunden <= 0) continue;
        projectAgg.set(projectId, (projectAgg.get(projectId) ?? 0) + stunden);
      }
    }
    const projects = Array.from(projectAgg.entries()).map(([id, rohStunden]) => {
      const meta = projektMetaById.get(id);
      const stunden = Math.round(rohStunden * 100) / 100;
      // Fallback-Kette wie zuvor: eigener Stundensatz des Projekts, sonst
      // der des Kunden, sonst 0.
      const rate = meta?.hourlyRate ?? meta?.customer?.hourlyRate ?? 0;
      const budgetHours = meta?.budgetHours ?? null;
      return {
        id,
        name: meta?.name ?? "?",
        customerName: meta?.customer?.name ?? "?",
        hourlyRate: rate,
        budgetHours,
        stunden,
        umsatz: Math.round(stunden * rate * 100) / 100,
        ueberzogen: budgetHours != null && stunden > budgetHours,
      };
    });
    const customers = Array.from(customerAgg.entries()).map(([id, c]) => {
      const stunden = Math.round(c.stunden * 100) / 100;
      return {
        id,
        name: c.name,
        hourlyRate: c.hourlyRate,
        stunden,
        umsatz: Math.round(stunden * (c.hourlyRate ?? 0) * 100) / 100,
        nachPerson: c.nachPerson.filter((p) => p.stunden > 0).sort((a, b) => b.stunden - a.stunden),
      };
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
      // Für den "Monat für Team abschliessen"-Button im Hub-Kopf: nur bei
      // einem exakten Kalendermonat gesetzt (siehe isSingleMonth oben).
      monthLock: isSingleMonth ? { year: lockYear, month: lockMonth } : null,
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET team error:", error);
    await logError("GET /api/team", error);
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
