import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Zwei Organisationen mit je mehreren Rollen, damit Mandantentrennung real
// klickbar ist (MIGRATION.md Punkt 3f) — z.B. als admin@onexis.test
// einloggen und prüfen, dass nichts aus "Beispiel Treuhand AG" sichtbar ist.
// Idempotent (upsert überall, kein delete/deleteMany — von
// scripts/safe-seed.ts ohnehin erzwungen): mehrfaches Ausführen legt nichts
// doppelt an und überschreibt keine bestehenden Werte.

interface SeedMember {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "owner" | "admin" | "manager" | "member";
  weeklyHours: number;
  pensum: number;
  vacationDays: number;
  startDate: string;
  reportsTo?: string; // E-Mail des Vorgesetzten (muss vorher in derselben Liste stehen)
}

async function upsertOrg(id: string, name: string, slug: string, plan: string) {
  return prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { id, name, slug, plan },
  });
}

async function seedOrgMembers(orgId: string, members: SeedMember[]) {
  const membershipIdByEmail = new Map<string, string>();
  for (const m of members) {
    const hashedPassword = await bcrypt.hash(m.password, 10);
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: {},
      create: {
        email: m.email,
        password: hashedPassword,
        firstName: m.firstName,
        lastName: m.lastName,
        mustSetPassword: false,
        language: "de",
      },
    });

    const managerMembershipId = m.reportsTo ? membershipIdByEmail.get(m.reportsTo) ?? null : null;

    const membership = await prisma.membership.upsert({
      where: { orgId_userId: { orgId, userId: user.id } },
      update: {},
      create: {
        orgId,
        userId: user.id,
        role: m.role,
        managerId: managerMembershipId,
        entryDate: new Date(m.startDate),
        weeklyHours: m.weeklyHours,
        pensum: m.pensum,
        vacationDays: m.vacationDays,
        startDate: new Date(m.startDate),
      },
    });
    membershipIdByEmail.set(m.email, membership.id);
  }
}

async function main() {
  // Org 1: ONEXIS — feste id, damit sie mit der Organisation übereinstimmt,
  // die die Datenmigration (Migration 20260813124101) für Bestandsnutzer
  // angelegt hat. John existierte schon vor Punkt 3 und ist dort bereits
  // als owner eingehängt (update: {} lässt ihn unverändert).
  const onexis = await upsertOrg("org_onexis_default", "ONEXIS", "onexis", "pro");
  await seedOrgMembers(onexis.id, [
    { email: "john@doe.com", password: "johndoe123", firstName: "John", lastName: "Doe", role: "owner", weeklyHours: 42, pensum: 100, vacationDays: 25, startDate: "2026-06-01" },
    { email: "admin@onexis.test", password: "onexisAdmin123", firstName: "Anna", lastName: "Admin", role: "admin", weeklyHours: 42, pensum: 100, vacationDays: 25, startDate: "2026-01-01" },
    { email: "manager@onexis.test", password: "onexisManager123", firstName: "Marco", lastName: "Manager", role: "manager", weeklyHours: 42, pensum: 100, vacationDays: 25, startDate: "2026-01-01" },
    { email: "member@onexis.test", password: "onexisMember123", firstName: "Mia", lastName: "Member", role: "member", weeklyHours: 40, pensum: 80, vacationDays: 25, startDate: "2026-03-01", reportsTo: "manager@onexis.test" },
  ]);

  // Org 2: eine zweite, komplett unabhängige Organisation — bewusst mit
  // anderem Branchennamen (Treuhand statt Ingenieurbüro), damit auf einen
  // Blick klar ist, dass es sich um einen anderen Mandanten handelt.
  const treuhand = await upsertOrg("org_beispiel_treuhand", "Beispiel Treuhand AG", "beispiel-treuhand", "starter");
  await seedOrgMembers(treuhand.id, [
    { email: "owner@treuhand.test", password: "treuhandOwner123", firstName: "Theresa", lastName: "Treuhänder", role: "owner", weeklyHours: 42, pensum: 100, vacationDays: 25, startDate: "2025-01-01" },
    { email: "admin@treuhand.test", password: "treuhandAdmin123", firstName: "Adrian", lastName: "Admin", role: "admin", weeklyHours: 42, pensum: 100, vacationDays: 25, startDate: "2025-06-01" },
    { email: "manager@treuhand.test", password: "treuhandManager123", firstName: "Manuela", lastName: "Manager", role: "manager", weeklyHours: 42, pensum: 90, vacationDays: 25, startDate: "2025-08-01" },
    { email: "member@treuhand.test", password: "treuhandMember123", firstName: "Max", lastName: "Mitarbeiter", role: "member", weeklyHours: 40, pensum: 60, vacationDays: 25, startDate: "2026-02-01", reportsTo: "manager@treuhand.test" },
  ]);

  console.log("Seed completed");
}

main()
  .catch((e: any) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
