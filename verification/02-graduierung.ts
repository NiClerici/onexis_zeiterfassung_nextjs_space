// V3: Beweist die Doppelzählung beim Graduieren einer migrierten Zeile.
// SICHERHEIT: legt eine eigene Wegwerf-Organisation an (Slug zzz-verify-*)
// und entfernt sie im finally-Block wieder. Fasst KEINE bestehenden Daten an.
import { PrismaClient } from "@prisma/client";
import { sumCustomerHours } from "@/lib/customer-months";
import { kennzahlen, type Profil } from "@/lib/calc";

const p = new PrismaClient();
const TAG = `zzz-verify-${Date.now()}`;
let orgId = "", userId = "";

async function main() {
  const org = await p.organization.create({ data: { name: TAG, slug: TAG, plan: "trial" } });
  orgId = org.id;
  const user = await p.user.create({ data: { email: `${TAG}@verify.local`, password: "x", firstName: "V", lastName: "Test" } });
  userId = user.id;
  await p.membership.create({ data: { orgId, userId, role: "member", entryDate: new Date("2020-01-01") } });
  const cust = await p.customer.create({ data: { orgId, name: `${TAG}-Kunde` } });

  // Migrierte Legacy-Zeile: countsAsWorktime=false, 8h am 10.04.2026
  const legacy = await p.timeEntry.create({
    data: { orgId, userId, date: new Date("2026-04-10T00:00:00Z"), type: "arbeit",
            von: "08:00", bis: "16:30", pauseMin: 30, customerId: cust.id, countsAsWorktime: false },
  });
  // Derselbe Monat zusätzlich als CustomerMonth erfasst (die Migration)
  await p.customerMonth.create({ data: { orgId, userId, year: 2026, month: 4, customerId: cust.id, hours: 102.8 } });

  const range = { orgId, userId, from: new Date("2026-04-01T00:00:00Z"), to: new Date("2026-04-30T00:00:00Z") };
  const profil: Profil = { pensum: 100, wochenstunden: 42, startDate: "2020-01-01", exitDate: null, ferientage: 25, maxWeeklyHours: 45 };
  const kz = async () => {
    const es = await p.timeEntry.findMany({ where: { orgId, userId, deletedAt: null } });
    return kennzahlen({ from: "2026-04-01", to: "2026-04-30", heute: "2026-08-30",
      eintraege: es.map(e => ({ date: e.date, typ: e.type as any, von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours, countsAsWorktime: e.countsAsWorktime })),
      profil, changes: [], payouts: [], holidays: [], kundenstunden: 0 });
  };

  const vorherKunden = await sumCustomerHours(range);
  const vorherIst = (await kz()).ist;

  // GRADUIERUNG: exakt das, was PUT /api/time-entries beim Speichern tut
  await p.timeEntry.update({ where: { id: legacy.id }, data: { countsAsWorktime: true } });

  const nachherKunden = await sumCustomerHours(range);
  const nachherIst = (await kz()).ist;

  console.log("\n--- Kundenstunden April 2026 ---");
  console.log("  vor  Graduierung:", vorherKunden, "h");
  console.log("  nach Graduierung:", nachherKunden, "h");
  console.log("  Differenz:       ", Math.round((nachherKunden - vorherKunden) * 10) / 10, "h");
  console.log("--- Arbeitszeit (kennzahlen().ist) ---");
  console.log("  vor  Graduierung:", vorherIst, "h");
  console.log("  nach Graduierung:", nachherIst, "h");
  console.log("\nERGEBNIS:", nachherKunden > vorherKunden ? "DOPPELZAEHLUNG BESTAETIGT" : "nicht reproduziert");
}

main()
  .catch((e) => { console.error("FEHLER:", e.message); process.exitCode = 1; })
  .finally(async () => {
    if (orgId) await p.organization.delete({ where: { id: orgId } }).catch(() => {});
    if (userId) await p.user.delete({ where: { id: userId } }).catch(() => {});
    const rest = await p.organization.count({ where: { slug: { startsWith: "zzz-verify-" } } });
    console.log(`Aufraeumen: Wegwerf-Orgs verblieben = ${rest} (muss 0 sein)`);
    await p.$disconnect();
  });
