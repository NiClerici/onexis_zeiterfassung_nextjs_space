export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { kennzahlen, sollStundenTag, stundenAusEintrag, type HolidayInput } from "@/lib/calc";
import { buildProfil, mapChanges, mapEintraege, parseYearMonthFromUrl } from "@/lib/export-helpers";

// Neutrales CSV für die Übernahme in ein Swissdec-zertifiziertes
// Lohnprogramm (MIGRATION.md Punkt 7, dritter Bullet). Bewusst KEINE
// eigene Swissdec-ELM-Zertifizierung — das wäre ein XML-basierter Standard
// mit eigenem Zertifizierungsprozess, ausdrücklich nicht das Ziel dieses
// Punktes ("Keine eigene Swissdec-Zertifizierung anstreben"). Stattdessen
// eine generische, klar beschriftete CSV-Tabelle, die eine Treuhandperson
// manuell oder per Mapping-Vorlage in ihr jeweiliges Lohnprogramm überträgt.
//
// Format-Entscheidungen, dokumentiert weil nicht aus dem Punkt-Text
// ableitbar: Semikolon als Trennzeichen und Komma als Dezimaltrennzeichen —
// das deutsch-/schweizerische Excel-Standardgebietsschema, das ein Komma
// als Dezimalzeichen erwartet und deshalb Semikolon statt Komma als
// Listentrennzeichen braucht. UTF-8 mit BOM, damit Excel Umlaute in Namen
// korrekt anzeigt statt sie als Sonderzeichen misszuinterpretieren.

function csvField(value: string | number): string {
  const s = typeof value === "number" ? value.toFixed(2).replace(".", ",") : value;
  if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const url = new URL(req.url);
    // Der Lohnexport ist bewusst immer monatsweise und verwendet deshalb
    // nicht parseExportRange (type=month|year|custom), aber dieselbe
    // Parameter-Validierung — vorher stand hier eine eigene Prüfung ohne
    // Jahresgrenzen (HARDENING.md B2).
    const { year, month } = parseYearMonthFromUrl(url);

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));
    const heute = new Date();

    // Nur Mitgliedschaften, die in diesem Monat mindestens einen Tag aktiv
    // waren (Ein-/Austritt mitten im Monat zählt anteilig, dieselbe Logik
    // wie sollStundenTag via profil.startDate/exitDate) — nicht nur
    // status: "aktiv" heute, sonst fehlt ein während des Monats ausgetretenes
    // Mitglied im Lohnexport für genau den Monat seines Austritts.
    const memberships = await prisma.membership.findMany({
      where: {
        orgId,
        entryDate: { lte: endDate },
        OR: [{ exitDate: null }, { exitDate: { gte: startDate } }],
      },
      include: { org: true, user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    });

    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId } });
    const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));

    const header = [
      "Personal-ID",
      "Nachname",
      "Vorname",
      "E-Mail",
      "Pensum (%)",
      "Sollstunden",
      "Arbeitsstunden",
      "Ferienstunden",
      "Krankstunden",
      "Militaerstunden",
      "UnbezahltStunden",
      "FeiertagStunden",
      "Ueberstunden",
      "Ueberzeit",
    ];
    const lines: string[] = [header.join(";")];

    for (const m of memberships) {
      const profil = buildProfil(m);
      const [pensumChangesRaw, entries, payoutsRaw] = await Promise.all([
        prisma.pensumChange.findMany({ where: { userId: m.userId, orgId }, orderBy: { effectiveFrom: "asc" } }),
        prisma.timeEntry.findMany({ where: { userId: m.userId, orgId, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
        prisma.overtimePayout.findMany({ where: { userId: m.userId, orgId, date: { gte: startDate, lte: endDate } } }),
      ]);
      const changes = mapChanges(pensumChangesRaw);
      const eintraege = mapEintraege(entries);
      const payouts = payoutsRaw.map((p) => ({ date: p.date, hours: p.hours }));

      const k = kennzahlen({ from: startDate, to: endDate, heute, eintraege, profil, changes, payouts, holidays });

      const stundenByType: Record<string, number> = { arbeit: 0, ferien: 0, krank: 0, militaer: 0, unbezahlt: 0, feiertag: 0 };
      for (const e of eintraege) {
        const tagesSoll = sollStundenTag(e.date, profil, changes, holidays);
        stundenByType[e.typ] = (stundenByType[e.typ] ?? 0) + stundenAusEintrag(e, tagesSoll);
      }

      lines.push(
        [
          csvField(m.userId),
          csvField(m.user.lastName),
          csvField(m.user.firstName),
          csvField(m.user.email),
          csvField(m.pensum),
          csvField(k.soll),
          csvField(stundenByType.arbeit),
          csvField(stundenByType.ferien),
          csvField(stundenByType.krank),
          csvField(stundenByType.militaer),
          csvField(stundenByType.unbezahlt),
          csvField(stundenByType.feiertag),
          csvField(k.ueberstunden),
          csvField(k.ueberzeit),
        ].join(";")
      );
    }

    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lohnexport_${year}-${String(month).padStart(2, "0")}.csv"`,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Lohnexport error:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
