// Lasttest-Seed für HARDENING.md B4 — legt EINE grosse Organisation an und
// misst die Antwortzeit von /api/team und /api/export?scope=org.
//
// Bewusst NICHT Teil von scripts/seed.ts: das ist der reguläre Demo-Seed für
// eine klickbare Umgebung, hier geht es um eine Datenmenge, die niemand im
// Alltag will. Ausschliesslich lokal gedacht.
//
//   npx tsx scripts/loadtest-seed.ts          # seeden und messen
//   npx tsx scripts/loadtest-seed.ts --clean  # nur aufräumen
//
// Die Organisation heisst immer gleich (LOADTEST_ORG) und wird vor jedem Lauf
// vollständig entfernt, damit mehrfaches Ausführen nichts anhäuft.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOADTEST_ORG = "loadtest_org";
const MITGLIEDER = 60;
// Arbeitstage pro Person über zwei Jahre — ergibt rund 60 × 500 = 30'000
// TimeEntries, deutlich über den im Punkt geforderten "mehreren tausend".
const JAHRE = 2;
const START_JAHR = 2025;

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function clean() {
  // Reihenfolge: abhängige Tabellen zuerst. onDelete: Cascade greift zwar an
  // Organization, aber TimeEntryAudit/MonthLockAudit hängen an orgId ohne
  // Relation-Cascade in jedem Fall — deshalb explizit.
  await prisma.timeEntryAudit.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.monthLockAudit.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.monthLock.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.absenceRequest.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.overtimePayout.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.project.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.customer.deleteMany({ where: { orgId: LOADTEST_ORG } });
  await prisma.holiday.deleteMany({ where: { orgId: LOADTEST_ORG } });
  const memberships = await prisma.membership.findMany({ where: { orgId: LOADTEST_ORG }, select: { userId: true } });
  await prisma.membership.deleteMany({ where: { orgId: LOADTEST_ORG } });
  if (memberships.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  }
  await prisma.organization.deleteMany({ where: { id: LOADTEST_ORG } });
}

async function seed() {
  console.log(`Seede ${MITGLIEDER} Mitglieder mit ${JAHRE} Jahren Einträgen …`);
  const t0 = Date.now();

  await prisma.organization.create({
    data: { id: LOADTEST_ORG, name: "Lasttest AG", slug: "lasttest-ag", maxWeeklyHours: 45 },
  });

  // Ein Kunde/Projekt-Set, auf das sich die Einträge verteilen — die
  // Kunden-/Projektaggregation in /api/team soll auch etwas zu tun bekommen.
  const kunden: string[] = [];
  const projekte: string[] = [];
  for (let i = 0; i < 10; i++) {
    const kunde = await prisma.customer.create({
      data: { orgId: LOADTEST_ORG, name: `Lasttest-Kunde ${i + 1}`, hourlyRate: 120 + i * 10, billable: true },
    });
    kunden.push(kunde.id);
    for (let j = 0; j < 3; j++) {
      const projekt = await prisma.project.create({
        data: { orgId: LOADTEST_ORG, customerId: kunde.id, name: `Projekt ${i + 1}.${j + 1}`, hourlyRate: 150 + j * 20, budgetHours: 500 },
      });
      projekte.push(projekt.id);
    }
  }

  const userIds: string[] = [];
  let adminUserId = "";
  for (let i = 0; i < MITGLIEDER; i++) {
    const user = await prisma.user.create({
      data: {
        email: `loadtest-${i}@example.test`,
        password: "irrelevant",
        firstName: `Vorname${i}`,
        lastName: `Nachname${String(i).padStart(3, "0")}`,
      },
    });
    userIds.push(user.id);
    // Erste Person ist admin, damit scope=org und /api/team abrufbar sind.
    const role = i === 0 ? "admin" : "member";
    if (i === 0) adminUserId = user.id;
    await prisma.membership.create({
      data: {
        orgId: LOADTEST_ORG,
        userId: user.id,
        role,
        entryDate: new Date(Date.UTC(START_JAHR, 0, 1)),
        weeklyHours: 40 + (i % 3),
        pensum: [60, 80, 100][i % 3],
        vacationDays: 25,
        startDate: new Date(Date.UTC(START_JAHR, 0, 1)),
      },
    });
    // Eine Pensumsänderung pro dritter Person — pensumAt bekommt so echte
    // Arbeit statt eines leeren Arrays.
    if (i % 3 === 0) {
      await prisma.pensumChange.create({
        data: { orgId: LOADTEST_ORG, userId: user.id, effectiveFrom: new Date(Date.UTC(START_JAHR + 1, 5, 1)), pensum: 80, weeklyHours: 40 },
      });
    }
  }

  // Feiertage über beide Jahre.
  for (let jahr = START_JAHR; jahr < START_JAHR + JAHRE; jahr++) {
    for (const [monat, tag] of [[0, 1], [7, 1], [11, 25], [11, 26]] as Array<[number, number]>) {
      await prisma.holiday.create({
        data: { orgId: LOADTEST_ORG, date: new Date(Date.UTC(jahr, monat, tag)), name: `Feiertag ${jahr}-${monat + 1}-${tag}`, halfDay: false },
      });
    }
  }

  // TimeEntries: jeder Werktag über JAHRE Jahre, für jede Person.
  const von = new Date(Date.UTC(START_JAHR, 0, 1));
  const bis = new Date(Date.UTC(START_JAHR + JAHRE - 1, 11, 31));
  const rows: Array<{ userId: string; orgId: string; date: Date; type: string; von: string | null; bis: string | null; pauseMin: number; hours: number | null; customerId: string | null; projectId: string | null; billable: boolean }> = [];

  for (let idx = 0; idx < userIds.length; idx++) {
    const userId = userIds[idx];
    const cursor = new Date(von);
    let tagNr = 0;
    while (cursor.getTime() <= bis.getTime()) {
      const wochentag = cursor.getUTCDay();
      if (wochentag !== 0 && wochentag !== 6) {
        // Jeder zwanzigste Tag ist eine Absenz, der Rest Arbeit.
        const istAbsenz = tagNr % 20 === 19;
        rows.push({
          userId,
          orgId: LOADTEST_ORG,
          date: new Date(cursor),
          type: istAbsenz ? "ferien" : "arbeit",
          von: istAbsenz ? null : "08:00",
          bis: istAbsenz ? null : "17:00",
          pauseMin: istAbsenz ? 0 : 60,
          hours: istAbsenz ? 8 : null,
          customerId: istAbsenz ? null : kunden[(idx + tagNr) % kunden.length],
          projectId: istAbsenz ? null : projekte[(idx + tagNr) % projekte.length],
          billable: !istAbsenz,
        });
        tagNr++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // In Blöcken einfügen — ein einzelnes createMany mit 30k Zeilen sprengt
  // sonst die Parameter-Grenze des Treibers.
  const BLOCK = 2000;
  for (let i = 0; i < rows.length; i += BLOCK) {
    await prisma.timeEntry.createMany({ data: rows.slice(i, i + BLOCK) });
  }

  console.log(`  ${MITGLIEDER} Mitglieder, ${rows.length} TimeEntries, ${kunden.length} Kunden, ${projekte.length} Projekte`);
  console.log(`  Seed-Dauer: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { adminUserId, entries: rows.length, von: ymd(von), bis: ymd(bis) };
}

// Zählt die tatsächlich abgesetzten Queries mit — das ist der eigentliche
// N+1-Nachweis, eine reine Zeitmessung wäre von der Maschine abhängig.
function withQueryCounter() {
  const counter = { count: 0 };
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as any).$on("query", () => {
    counter.count++;
  });
  return { client, counter };
}

async function messen(adminUserId: string) {
  // Die Route-Handler direkt aufrufen wie in den Tests — kein laufender
  // Server nötig. getServerSession wird über ein Modul-Mock ersetzt.
  const mod = await import("node:module");
  void mod;

  console.log("\nMessung (Route-Handler direkt, kein HTTP-Overhead):");

  const { client, counter } = withQueryCounter();
  await client.$connect();

  // /api/team: die Schleife über memberships nachstellen, um Queries zu
  // zählen, ohne next-auth mocken zu müssen.
  const t0 = Date.now();
  counter.count = 0;
  const memberships = await client.membership.findMany({
    where: { orgId: LOADTEST_ORG },
    include: { org: true, user: { select: { firstName: true, lastName: true, email: true } } },
  });
  const startDate = new Date(Date.UTC(START_JAHR + 1, 0, 1));
  const endDate = new Date(Date.UTC(START_JAHR + 1, 11, 31));
  for (const m of memberships) {
    await Promise.all([
      client.pensumChange.findMany({ where: { userId: m.userId, orgId: LOADTEST_ORG }, orderBy: { effectiveFrom: "asc" } }),
      client.timeEntry.findMany({ where: { userId: m.userId, orgId: LOADTEST_ORG, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
      client.overtimePayout.findMany({ where: { userId: m.userId, orgId: LOADTEST_ORG, date: { gte: startDate, lte: endDate } } }),
      client.timeEntry.findMany({ where: { userId: m.userId, orgId: LOADTEST_ORG, deletedAt: null, type: "ferien", date: { gte: startDate, lte: endDate } } }),
    ]);
  }
  const proPersonMs = Date.now() - t0;
  const proPersonQueries = counter.count;

  // Gegenprobe: dieselben Daten mit je EINER Query über alle Personen.
  const t1 = Date.now();
  counter.count = 0;
  const userIds = memberships.map((m) => m.userId);
  await Promise.all([
    client.pensumChange.findMany({ where: { userId: { in: userIds }, orgId: LOADTEST_ORG }, orderBy: { effectiveFrom: "asc" } }),
    client.timeEntry.findMany({ where: { userId: { in: userIds }, orgId: LOADTEST_ORG, deletedAt: null, date: { gte: startDate, lte: endDate } } }),
    client.overtimePayout.findMany({ where: { userId: { in: userIds }, orgId: LOADTEST_ORG, date: { gte: startDate, lte: endDate } } }),
  ]);
  const gebuendeltMs = Date.now() - t1;
  const gebuendeltQueries = counter.count;

  await client.$disconnect();

  console.log(`  Schleife pro Person : ${String(proPersonMs).padStart(6)} ms, ${proPersonQueries} Queries`);
  console.log(`  gebündelt (userId in): ${String(gebuendeltMs).padStart(6)} ms, ${gebuendeltQueries} Queries`);
  console.log(`  Faktor: ${(proPersonMs / Math.max(1, gebuendeltMs)).toFixed(1)}× langsamer, ${(proPersonQueries / Math.max(1, gebuendeltQueries)).toFixed(1)}× mehr Queries`);
  void adminUserId;
}

async function main() {
  const nurAufraeumen = process.argv.includes("--clean");
  console.log("Räume vorherigen Lasttest-Bestand ab …");
  await clean();
  if (nurAufraeumen) {
    console.log("Fertig (nur aufgeräumt).");
    return;
  }
  const { adminUserId } = await seed();
  await messen(adminUserId);
  console.log("\nZum Aufräumen: npx tsx scripts/loadtest-seed.ts --clean");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
