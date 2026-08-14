import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Rein additives Demo-Skript: legt vier neue Personen in der bestehenden
// ONEXIS-Organisation an (org_onexis_default), dazu drei neue Projekte beim
// bestehenden Kunden "Swissgrid" und ein Zeiterfassungs-Muster Juni-August
// 2026. Fasst keinen bestehenden User/keine bestehende Organisation an.
// Idempotent (nur upsert, kein delete/deleteMany — von scripts/safe-seed.ts
// ohnehin nur für seed.ts erzwungen, hier freiwillig genauso gehandhabt).

const ORG_ID = "org_onexis_default";

interface SeedPerson {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "admin" | "manager" | "member";
  startDate: string;
  reportsTo?: string;
  vacation: { from: string; to: string };
  sickDay: string;
}

const PEOPLE: SeedPerson[] = [
  {
    email: "nico.clerici@onexis.test",
    password: "onexisNico123",
    firstName: "Nico",
    lastName: "Clerici",
    role: "admin",
    startDate: "2026-01-01",
    vacation: { from: "2026-07-06", to: "2026-07-10" },
    sickDay: "2026-06-15",
  },
  {
    email: "stefan.buettler@onexis.test",
    password: "onexisStefan123",
    firstName: "Stefan",
    lastName: "Büttler",
    role: "manager",
    startDate: "2026-01-01",
    vacation: { from: "2026-07-13", to: "2026-07-17" },
    sickDay: "2026-06-16",
  },
  {
    email: "gabriel.wey@onexis.test",
    password: "onexisGabriel123",
    firstName: "Gabriel",
    lastName: "Wey",
    role: "member",
    startDate: "2026-02-01",
    reportsTo: "stefan.buettler@onexis.test",
    vacation: { from: "2026-07-20", to: "2026-07-24" },
    sickDay: "2026-08-05",
  },
  {
    email: "phillip.brunner@onexis.test",
    password: "onexisPhillip123",
    firstName: "Phillip",
    lastName: "Brunner",
    role: "member",
    startDate: "2026-02-01",
    reportsTo: "stefan.buettler@onexis.test",
    vacation: { from: "2026-07-27", to: "2026-07-31" },
    sickDay: "2026-08-06",
  },
];

const PROJECT_NAMES = ["UMS_Pipeline", "SF <> IAM Mapping", "MINE"];

function isWeekday(d: Date) {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function eachDate(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(from);
  while (cur.getTime() <= to.getTime()) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function upsertPerson(person: SeedPerson, membershipIdByEmail: Map<string, string>) {
  const hashedPassword = await bcrypt.hash(person.password, 10);
  const user = await prisma.user.upsert({
    where: { email: person.email },
    update: {},
    create: {
      email: person.email,
      password: hashedPassword,
      firstName: person.firstName,
      lastName: person.lastName,
      mustSetPassword: false,
      language: "de",
    },
  });

  const managerMembershipId = person.reportsTo ? membershipIdByEmail.get(person.reportsTo) ?? null : null;

  const membership = await prisma.membership.upsert({
    where: { orgId_userId: { orgId: ORG_ID, userId: user.id } },
    update: {},
    create: {
      orgId: ORG_ID,
      userId: user.id,
      role: person.role,
      managerId: managerMembershipId,
      entryDate: new Date(person.startDate),
      weeklyHours: 40,
      pensum: 100,
      vacationDays: 25,
      startDate: new Date(person.startDate),
    },
  });
  membershipIdByEmail.set(person.email, membership.id);
  return { user, membership };
}

async function main() {
  // Kunde "Swissgrid" muss bereits existieren (org_onexis_default) — wird
  // hier nur referenziert, nicht neu angelegt oder verändert (update: {}).
  const swissgrid = await prisma.customer.upsert({
    where: { orgId_name: { orgId: ORG_ID, name: "Swissgrid" } },
    update: {},
    create: { orgId: ORG_ID, name: "Swissgrid", billable: true },
  });

  const projects = [];
  for (const name of PROJECT_NAMES) {
    const project = await prisma.project.upsert({
      where: { orgId_customerId_name: { orgId: ORG_ID, customerId: swissgrid.id, name } },
      update: {},
      create: { orgId: ORG_ID, customerId: swissgrid.id, name },
    });
    projects.push(project);
  }

  const membershipIdByEmail = new Map<string, string>();
  // Reihenfolge wichtig: Stefan (Vorgesetzter) muss vor Gabriel/Phillip
  // angelegt werden, damit managerId aufgelöst werden kann.
  const ordered = [...PEOPLE].sort((a, b) => (a.reportsTo ? 1 : 0) - (b.reportsTo ? 1 : 0));

  for (const person of ordered) {
    const { user } = await upsertPerson(person, membershipIdByEmail);

    const existingCount = await prisma.timeEntry.count({ where: { userId: user.id, orgId: ORG_ID } });
    if (existingCount > 0) {
      console.log(`${person.email}: bereits ${existingCount} TimeEntry-Zeilen vorhanden — überspringe Zeiterfassung.`);
      continue;
    }

    const vacationDates = new Set(
      eachDate(new Date(person.vacation.from), new Date(person.vacation.to)).map(toDateKey)
    );
    const sickDate = person.sickDay;

    const allDays = eachDate(new Date("2026-06-01"), new Date("2026-08-31")).filter(isWeekday);

    let projectIdx = 0;
    let dayIdx = 0;
    let created = 0;
    for (const day of allDays) {
      const key = toDateKey(day);
      if (vacationDates.has(key)) {
        await prisma.timeEntry.create({
          data: { userId: user.id, orgId: ORG_ID, date: day, type: "ferien", hours: 8.0 },
        });
      } else if (key === sickDate) {
        await prisma.timeEntry.create({
          data: { userId: user.id, orgId: ORG_ID, date: day, type: "krank", hours: 8.0 },
        });
      } else {
        const noProject = dayIdx % 4 === 3;
        const project = noProject ? null : projects[projectIdx % projects.length];
        if (!noProject) projectIdx++;
        await prisma.timeEntry.create({
          data: {
            userId: user.id,
            orgId: ORG_ID,
            date: day,
            type: "arbeit",
            von: "08:00",
            bis: "17:00",
            pauseMin: 60,
            customerId: noProject ? null : swissgrid.id,
            projectId: noProject ? null : project!.id,
            billable: !noProject,
          },
        });
      }
      dayIdx++;
      created++;
    }
    console.log(`${person.email}: ${created} TimeEntry-Zeilen angelegt.`);
  }

  console.log("Demo-Team-Seed abgeschlossen.");
}

main()
  .catch((e: any) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
