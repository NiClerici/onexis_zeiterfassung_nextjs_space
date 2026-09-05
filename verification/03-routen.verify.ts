// V4: Ruft die ECHTEN Route-Handler mit gemockter Session auf (Muster aus
// lib/api-isolation.test.ts). SICHERHEIT: eigene Wegwerf-Organisation
// (zzz-verify-*), wird in afterAll entfernt. Bestehende Daten unangetastet.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { kennzahlen, type Profil } from "@/lib/calc";

let mockSession: any = null;
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => Promise.resolve(mockSession)) }));

import { PUT as profilePut } from "@/app/api/profile/route";
import { DELETE as customerDelete } from "@/app/api/customers/route";

const TAG = `zzz-verify-${Date.now()}`;
let orgId = "", userId = "", customerId = "", projectId = "", entryId = "";
const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: TAG, slug: TAG, plan: "trial" } });
  orgId = org.id;
  const u = await prisma.user.create({ data: { email: `${TAG}@verify.local`, password: "x", firstName: "V", lastName: "T" } });
  userId = u.id;
  await prisma.membership.create({ data: { orgId, userId, role: "member", entryDate: new Date("2020-01-01"), pensum: 100, weeklyHours: 42, vacationDays: 25 } });
  const c = await prisma.customer.create({ data: { orgId, name: `${TAG}-K` } });
  customerId = c.id;
  const pr = await prisma.project.create({ data: { orgId, customerId, name: `${TAG}-P`, createdBy: userId } });
  projectId = pr.id;
  const e = await prisma.timeEntry.create({ data: { orgId, userId, date: new Date("2026-04-10T00:00:00Z"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30, customerId, projectId } });
  entryId = e.id;
  await prisma.customerMonth.create({ data: { orgId, userId, year: 2026, month: 4, customerId, hours: 50 } });
  mockSession = { user: { id: userId, orgId, role: "member", mustSetPassword: false } };
});

afterAll(async () => {
  if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  const rest = await prisma.organization.count({ where: { slug: { startsWith: "zzz-verify-" } } });
  console.log(`\n[Aufraeumen] Wegwerf-Orgs verblieben: ${rest} (muss 0 sein)`);
});

describe("HOCH: Profil schreibt Stammdaten ungeprüft", () => {
  it("BUG: PUT /api/profile akzeptiert pensum = -100 von einem 'member'", async () => {
    const res = await profilePut(req("/api/profile", { method: "PUT", body: JSON.stringify({ pensum: -100 }) }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    expect(m!.pensum).toBe(-100);
    console.log(`  -> gespeichertes Pensum: ${m!.pensum}%`);
  });

  it("BUG: negatives Pensum erzeugt negatives Soll und erfundene Überstunden", () => {
    const profil = (pensum: number): Profil => ({ pensum, wochenstunden: 42, startDate: "2020-01-01", exitDate: null, ferientage: 25, maxWeeklyHours: 45 });
    const base = { from: "2026-04-01", to: "2026-04-30", heute: "2026-04-30", eintraege: [], changes: [], payouts: [], holidays: [], kundenstunden: 0 };
    const ok = kennzahlen({ ...base, profil: profil(100) });
    const bad = kennzahlen({ ...base, profil: profil(-100) });
    console.log(`  -> Soll bei 100%: ${ok.soll}h | bei -100%: ${bad.soll}h`);
    console.log(`  -> Überstunden bei 100%: ${ok.ueberstunden}h | bei -100%: ${bad.ueberstunden}h`);
    expect(ok.soll).toBeGreaterThan(0);      // korrekt: positives Monatssoll
    expect(bad.soll).toBeLessThan(0);        // BUG: negatives Soll
    expect(bad.ueberstunden).toBeGreaterThan(0); // BUG: Überstunden aus dem Nichts
    expect(bad.ueberstunden).toBe(-bad.soll);    // exakt das gespiegelte Soll
  });

  it("BUG: 'member' kann sein eigenes startDate verschieben und damit alle Vormonate auf Soll 0 setzen", async () => {
    const res = await profilePut(req("/api/profile", { method: "PUT", body: JSON.stringify({ startDate: "2026-08-01" }) }));
    expect(res.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    expect(m!.startDate?.toISOString().slice(0, 10)).toBe("2026-08-01");
    console.log(`  -> gespeichertes startDate: ${m!.startDate?.toISOString().slice(0, 10)}`);
  });
});

describe("KRITISCH: 'member' darf Kunden löschen (Route-Ebene)", () => {
  it("BUG: DELETE /api/customers liefert 200 für Rolle 'member'", async () => {
    const vorher = {
      projekte: await prisma.project.count({ where: { customerId } }),
      customerMonths: await prisma.customerMonth.count({ where: { customerId } }),
      eintraegeMitKunde: await prisma.timeEntry.count({ where: { orgId, customerId: { not: null } } }),
    };
    const res = await customerDelete(req("/api/customers", { method: "DELETE", body: JSON.stringify({ id: customerId }) }));
    expect(res.status).toBe(200);

    const nachher = {
      projekte: await prisma.project.count({ where: { customerId } }),
      customerMonths: await prisma.customerMonth.count({ where: { customerId } }),
      eintraegeMitKunde: await prisma.timeEntry.count({ where: { orgId, customerId: { not: null } } }),
    };
    const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
    console.log(`  -> Projekte:        ${vorher.projekte} -> ${nachher.projekte}`);
    console.log(`  -> CustomerMonths:  ${vorher.customerMonths} -> ${nachher.customerMonths}`);
    console.log(`  -> Einträge m. Kunde: ${vorher.eintraegeMitKunde} -> ${nachher.eintraegeMitKunde}`);
    console.log(`  -> Eintrag existiert noch: ${entry !== null}, customerId=${entry?.customerId}, projectId=${entry?.projectId}`);

    expect(nachher.projekte).toBe(0);        // Cascade
    expect(nachher.customerMonths).toBe(0);  // Cascade
    expect(entry).not.toBeNull();            // Eintrag bleibt...
    expect(entry!.customerId).toBeNull();    // ...verliert aber die Zuordnung
    expect(entry!.projectId).toBeNull();
  });
});
