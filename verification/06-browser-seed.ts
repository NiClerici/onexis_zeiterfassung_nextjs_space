// Legt ein Wegwerf-Konto für den Browser-Test an bzw. entfernt es wieder.
// Aufruf: ... 06-browser-seed.ts up | down
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const p = new PrismaClient();
const SLUG = "zzz-verify-browser";
const EMAIL = "zzz-verify-browser@verify.local";
const PW = "VerifyTest2026!";

async function up() {
  await down();
  const org = await p.organization.create({ data: { name: SLUG, slug: SLUG, plan: "trial", trialEndsAt: new Date(Date.now() + 30 * 864e5) } });
  const u = await p.user.create({ data: { email: EMAIL, password: await bcrypt.hash(PW, 10), firstName: "Verify", lastName: "Browser", mustSetPassword: false } });
  await p.membership.create({ data: { orgId: org.id, userId: u.id, role: "member", entryDate: new Date("2020-01-01"), pensum: 100, weeklyHours: 42, vacationDays: 25 } });
  const c = await p.customer.create({ data: { orgId: org.id, name: "ZZZ-Verify-Kunde" } });
  await p.project.create({ data: { orgId: org.id, customerId: c.id, name: "ZZZ-Verify-Projekt", createdBy: u.id } });
  await p.timeEntry.create({ data: { orgId: org.id, userId: u.id, date: new Date("2026-08-11T00:00:00Z"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30, customerId: c.id } });
  console.log(`READY email=${EMAIL} pw=${PW} orgId=${org.id}`);
}
async function down() {
  await p.organization.deleteMany({ where: { slug: { startsWith: "zzz-verify" } } });
  await p.user.deleteMany({ where: { email: { startsWith: "zzz-verify" } } });
  const rest = await p.organization.count({ where: { slug: { startsWith: "zzz-verify" } } });
  console.log(`CLEAN verbleibende Wegwerf-Orgs: ${rest}`);
}
(process.argv[2] === "down" ? down() : up())
  .catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
