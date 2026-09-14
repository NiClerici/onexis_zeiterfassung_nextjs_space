// Bereinigt TimeEntry-Zeilen, die an einem Tag mit Holiday-Zeile zusätzlich
// Absenz-Stunden mit fest gespeichertem Wert tragen — die eigentliche
// Ursache der in Prod beobachteten Phantom-Überstunden (Diagnose vom
// 14.09.2026, siehe .claude/plans/habe-jetz-noch-die-iridescent-cocoa.md).
//
// Mechanismus: sollStundenTag() (lib/calc.ts) kürzt das Tagessoll an einem
// Feiertag bereits automatisch auf 0 (ganztags) bzw. die Hälfte (halbtags).
// Ein zusätzlicher type!="arbeit"-Eintrag (z.B. type="feiertag" mit von Hand
// eingetragenen Stunden) desselben Tages zählte diese Stunden bisher ein
// zweites Mal aufs Ist. Der Code-Fix in lib/calc.ts kennzahlen() (Clamp auf
// das Tagessoll) verhindert das inzwischen für ALLE Berechnungen, auch ohne
// dieses Skript — hier geht es nur noch darum, die Altdaten selbst
// aufzuräumen, damit der Kalender nicht weiter widersprüchliche
// Doppel-Einträge anzeigt.
//
// Nutzung (Dry-Run ist der Default — es wird NICHTS geschrieben):
//   npx tsx --require dotenv/config scripts/fix-holiday-doublecount.ts
//   npx tsx --require dotenv/config scripts/fix-holiday-doublecount.ts --org=<slug>
//   npx tsx --require dotenv/config scripts/fix-holiday-doublecount.ts --user=<email>
//   npx tsx --require dotenv/config scripts/fix-holiday-doublecount.ts --apply
//
// Verhalten pro betroffenem Eintrag:
//   - Ganztags-Feiertag: Soft-Delete (deletedAt), analog zu
//     DELETE /api/time-entries und lib/absence-entries.ts — die 5-jährige
//     Aufbewahrungspflicht verbietet Hard-Delete.
//   - Halbtags-Feiertag: hours wird auf sollStundenTag() (= die Hälfte)
//     geklemmt statt gelöscht — der Eintrag bleibt als Beleg für den
//     (halben) Absenztag bestehen.
//   - type="arbeit" wird NIE angefasst — echte Arbeit am Feiertag ist
//     bewusst gewollte Überstunden. Erscheint aber im Report, damit von Hand
//     geprüft werden kann, ob es sich um echte Arbeit oder eine vor dem
//     Anlegen der Holiday-Zeile erfasste Standardwochen-Füllung handelt
//     (siehe Plan, Fall philipp.brunner@onexis.ch).
//   - type="unbezahlt" wird ignoriert — stundenAusEintrag() (lib/calc.ts)
//     liefert dafür ohnehin immer 0, unabhängig vom gespeicherten
//     hours-Wert; keine Doppelzählung möglich.
//
// Idempotent: ein zweiter Lauf (auch mit --apply) findet keine Kandidaten
// mehr, weil geklemmte Einträge danach exakt dem Tagessoll entsprechen und
// gelöschte Einträge nicht mehr geladen werden (deletedAt: null-Filter).

import { PrismaClient } from "@prisma/client";
import { kennzahlen, sollStundenTag, type HolidayInput, type PensumChangeInput, type EintragMitDatum } from "../lib/calc";
import { buildProfil, mapChanges, mapEintraege } from "../lib/export-helpers";
import { diffTimeEntryFields } from "../lib/audit";

const prisma = new PrismaClient();

// Marker im Audit-Trail (TimeEntryAudit.changedBy), damit diese Korrektur
// von menschlichen Änderungen unterscheidbar bleibt — analog zum Muster
// echter userId-Werte an derselben Stelle.
const SCRIPT_ACTOR = "script:fix-holiday-doublecount";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface Args {
  apply: boolean;
  org?: string;
  user?: string;
}

function parseArgs(): Args {
  const args: Args = { apply: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--org=")) args.org = a.slice("--org=".length);
    else if (a.startsWith("--user=")) args.user = a.slice("--user=".length);
    else {
      console.error(`Unbekanntes Argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

interface PlannedDelete {
  entryId: string;
  orgId: string;
  email: string;
  date: string;
  holidayName: string;
  hours: number;
}

interface PlannedClamp {
  entryId: string;
  orgId: string;
  email: string;
  date: string;
  holidayName: string;
  before: number | null;
  after: number;
}

interface ArbeitHinweis {
  email: string;
  date: string;
  holidayName: string;
  von: string | null;
  bis: string | null;
}

async function main() {
  const args = parseArgs();
  console.log(args.apply ? "=== MODUS: --apply (schreibt in die DB) ===" : "=== MODUS: Dry-Run (keine Schreibzugriffe) ===");
  if (args.org) console.log(`Eingeschränkt auf Organisation: ${args.org}`);
  if (args.user) console.log(`Eingeschränkt auf Person: ${args.user}`);
  console.log("");

  const orgs = await prisma.organization.findMany({ where: args.org ? { slug: args.org } : undefined });
  if (orgs.length === 0) {
    console.error("Keine passende Organisation gefunden.");
    process.exit(1);
  }

  const deletes: PlannedDelete[] = [];
  const clamps: PlannedClamp[] = [];
  const arbeitHinweise: ArbeitHinweis[] = [];
  let anyReported = false;

  for (const org of orgs) {
    const holidaysRaw = await prisma.holiday.findMany({ where: { orgId: org.id } });
    const holidays: HolidayInput[] = holidaysRaw.map((h) => ({ date: h.date, halfDay: h.halfDay }));
    const holidayByDate = new Map(holidaysRaw.map((h) => [h.date.toISOString().slice(0, 10), h]));
    if (holidayByDate.size === 0) continue;

    const memberships = await prisma.membership.findMany({
      where: { orgId: org.id, ...(args.user ? { user: { email: args.user } } : {}) },
      include: { user: true, org: true },
    });

    for (const membership of memberships) {
      const email = membership.user.email;
      const profil = buildProfil(membership);
      const changesRaw = await prisma.pensumChange.findMany({
        where: { userId: membership.userId, orgId: org.id },
        orderBy: { effectiveFrom: "asc" },
      });
      const changes: PensumChangeInput[] = mapChanges(changesRaw);

      const entries = await prisma.timeEntry.findMany({
        where: { userId: membership.userId, orgId: org.id, deletedAt: null },
        orderBy: { date: "asc" },
      });

      // Kandidaten: Absenz-Einträge (type != "arbeit"/"unbezahlt") mit fest
      // gespeicherten Stunden (hours !== null), deren Wert das
      // Holiday-korrigierte Tagessoll übersteigt — exakt die Bedingung,
      // unter der die Doppelzählung entsteht. Einträge mit hours===null sind
      // bereits korrekt: stundenAusEintrag() (lib/calc.ts) fällt dort
      // ohnehin auf das (bereits Holiday-korrigierte) Tagessoll zurück.
      const removedIds = new Set<string>();
      const hourOverrides = new Map<string, number>();

      for (const entry of entries) {
        const dateKey = entry.date.toISOString().slice(0, 10);
        const holiday = holidayByDate.get(dateKey);
        if (!holiday) continue;

        if (entry.type === "arbeit") {
          arbeitHinweise.push({ email, date: dateKey, holidayName: holiday.name, von: entry.von, bis: entry.bis });
          continue;
        }
        if (entry.type === "unbezahlt") continue;
        if (entry.hours === null) continue;

        const tagesSoll = sollStundenTag(entry.date, profil, changes, holidays);
        if (entry.hours <= tagesSoll + 0.005) continue; // bereits korrekt (Rundungstoleranz)

        if (holiday.halfDay) {
          const nextHours = round1(tagesSoll);
          clamps.push({ entryId: entry.id, orgId: org.id, email, date: dateKey, holidayName: holiday.name, before: entry.hours, after: nextHours });
          hourOverrides.set(entry.id, nextHours);
        } else {
          deletes.push({ entryId: entry.id, orgId: org.id, email, date: dateKey, holidayName: holiday.name, hours: entry.hours });
          removedIds.add(entry.id);
        }
      }

      if (removedIds.size === 0 && hourOverrides.size === 0) continue;
      anyReported = true;

      // Bericht: Überstunden-Saldo vor/nach der Bereinigung, mit derselben
      // kennzahlen()-Methode wie Analytics, Zeitraum
      // [Anstellungsbeginn, heute] (analog zu app/api/analytics/route.ts
      // saldoStart).
      const heute = new Date();
      const from = membership.startDate ?? membership.entryDate;
      const eintraegeVorher: EintragMitDatum[] = mapEintraege(entries);
      const entriesNachher = entries
        .filter((e) => !removedIds.has(e.id))
        .map((e) => (hourOverrides.has(e.id) ? { ...e, hours: hourOverrides.get(e.id)! } : e));
      const eintraegeNachher: EintragMitDatum[] = mapEintraege(entriesNachher);

      const kVorher = kennzahlen({ from, to: heute, heute, eintraege: eintraegeVorher, profil, changes, payouts: [], holidays, kundenstunden: 0 });
      const kNachher = kennzahlen({ from, to: heute, heute, eintraege: eintraegeNachher, profil, changes, payouts: [], holidays, kundenstunden: 0 });

      console.log(`--- ${email} (${org.name}) ---`);
      console.log(`  Betroffene Tage: ${removedIds.size} zu löschen, ${hourOverrides.size} zu kürzen`);
      console.log(`  Überstunden: ${kVorher.ueberstunden}h  ->  ${kNachher.ueberstunden}h  (Differenz: ${round1(kVorher.ueberstunden - kNachher.ueberstunden)}h)`);
      console.log("");
    }
  }

  if (!anyReported) {
    console.log("Keine Doppelzählung gefunden — nichts zu tun.\n");
  }

  if (deletes.length > 0) {
    console.log(`${deletes.length} Einträge ${args.apply ? "werden" : "WÜRDEN"} soft-gelöscht (Ganztags-Feiertag):`);
    for (const d of deletes) console.log(`  ${d.email} ${d.date} (${d.holidayName}): ${d.hours}h — entryId ${d.entryId}`);
    console.log("");
  }
  if (clamps.length > 0) {
    console.log(`${clamps.length} Einträge ${args.apply ? "werden" : "WÜRDEN"} gekürzt (Halbtags-Feiertag):`);
    for (const c of clamps) console.log(`  ${c.email} ${c.date} (${c.holidayName}): ${c.before}h -> ${c.after}h — entryId ${c.entryId}`);
    console.log("");
  }
  if (arbeitHinweise.length > 0) {
    console.log(`${arbeitHinweise.length} echte Arbeit-Einträge an Feiertagen — NICHT angefasst, bitte von Hand prüfen:`);
    for (const a of arbeitHinweise) console.log(`  ${a.email} ${a.date} (${a.holidayName}): ${a.von ?? "?"}–${a.bis ?? "?"}`);
    console.log("");
  }

  if (!args.apply) {
    console.log("Dry-Run — nichts wurde geschrieben. Mit --apply erneut ausführen, um die Änderungen zu übernehmen.");
    return;
  }

  if (deletes.length === 0 && clamps.length === 0) {
    console.log("Nichts zu übernehmen.");
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      const deletedAt = new Date();
      for (const d of deletes) {
        await tx.timeEntry.update({ where: { id: d.entryId }, data: { deletedAt } });
        await tx.timeEntryAudit.create({
          data: { entryId: d.entryId, orgId: d.orgId, changedBy: SCRIPT_ACTOR, field: "deletedAt", oldValue: null, newValue: deletedAt.toISOString() },
        });
      }
      for (const c of clamps) {
        await tx.timeEntry.update({ where: { id: c.entryId }, data: { hours: c.after } });
        const fieldChanges = diffTimeEntryFields({ hours: c.before }, { hours: c.after });
        if (fieldChanges.length > 0) {
          await tx.timeEntryAudit.createMany({
            data: fieldChanges.map((ch) => ({ entryId: c.entryId, orgId: c.orgId, changedBy: SCRIPT_ACTOR, field: ch.field, oldValue: ch.oldValue, newValue: ch.newValue })),
          });
        }
      }
    },
    { timeout: 30000 }
  );

  console.log(`${deletes.length} Einträge gelöscht, ${clamps.length} Einträge gekürzt. Fertig.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
