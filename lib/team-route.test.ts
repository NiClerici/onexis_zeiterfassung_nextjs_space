// Tests für /api/team (MIGRATION.md Punkt 8) — Berechtigungs-Scoping
// (member verboten, manager sieht nur sein Team, admin/owner sehen alle)
// und ein Sanity-Check der Kunden-/Projektaggregation. Die zugrunde-
// liegende Berechnung (teamKennzahlen, wochenUebersicht) ist bereits
// vollständig in lib/calc.test.ts getestet — hier geht es nur um die
// Route-Ebene: wer sieht was.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as teamGet } from "@/app/api/team/route";
import { GET as absenceRequestsGet } from "@/app/api/absence-requests/route";

const ORG = "test_team_route_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}

let ownerId: string, adminId: string, managerId: string, reportId: string, otherMemberId: string;
let loneManagerId: string;
let managerMembershipId: string;
let customerId: string, projectId: string;
// HARDENING.md A4: Kunde und Projekt beide OHNE hourlyRate, sowie ein
// Projekt, dessen Budget exakt erreicht (nicht überschritten) wird.
let rateLessCustomerId: string, rateLessProjectId: string;
let exactBudgetCustomerId: string, exactBudgetProjectId: string;
// Kunde, bei dem NIE ein Projekt erfasst wird — deckt "nur auf Kundenebene
// verrechnen" ab (Teamsicht-Bugfix: die Kundentabelle wurde bisher nie
// gerendert, obwohl die Route diese Aggregation längst lieferte).
let directCustomerId: string;
// Kunde, der AUSSCHLIESSLICH über die tagesgenaue Erfassung gebucht wird
// (TimeEntry.customerId, kein CustomerMonth) — der Fall, den customers[]
// vor diesem Fix komplett übersah (Bugfix: einheitliche Teamsicht).
let dailyCustomerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Team Route Test Org", slug: "team-route-test-org" } });
  const mkUser = async (email: string, firstName: string) => {
    const u = await prisma.user.create({ data: { email, password: "irrelevant", firstName, lastName: "Test" } });
    return u.id;
  };
  ownerId = await mkUser("team-route-owner@example.test", "Owner");
  adminId = await mkUser("team-route-admin@example.test", "Admin");
  managerId = await mkUser("team-route-manager@example.test", "Manager");
  reportId = await mkUser("team-route-report@example.test", "Report");
  otherMemberId = await mkUser("team-route-other@example.test", "Other");
  loneManagerId = await mkUser("team-route-lone-manager@example.test", "LoneManager");

  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  const managerMembership = await prisma.membership.create({ data: { orgId: ORG, userId: managerId, role: "manager", entryDate: new Date("2026-01-01") } });
  managerMembershipId = managerMembership.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: reportId, role: "member", managerId: managerMembershipId, entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: otherMemberId, role: "member", entryDate: new Date("2026-01-01"), pensum: 60, weeklyHours: 40 } });
  // Bugfix-Szenario: Pensum wechselt erst per September auf 80% — eine
  // Abfrage für August (MONTH_QS unten) muss weiterhin 60% zeigen, nicht
  // den heute aktuellen (zukünftigen) Wert.
  await prisma.pensumChange.create({ data: { orgId: ORG, userId: otherMemberId, pensum: 80, weeklyHours: 40, effectiveFrom: new Date("2026-09-01") } });
  // manager ohne einen einzigen direkt unterstellten Eintrag (HARDENING.md A4)
  await prisma.membership.create({ data: { orgId: ORG, userId: loneManagerId, role: "manager", entryDate: new Date("2026-01-01") } });

  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Team-Route-Kunde", hourlyRate: 150 } });
  customerId = customer.id;
  const project = await prisma.project.create({ data: { orgId: ORG, customerId, name: "Team-Route-Projekt", hourlyRate: 200, budgetHours: 5 } });
  projectId = project.id;

  // report arbeitet 6h — Kundenzuordnung liegt seit der Monatsumstellung
  // nicht mehr am TimeEntry, sondern in CustomerMonth (August 2026, passend
  // zu MONTH_QS unten).
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-03"), type: "arbeit", von: "08:00", bis: "14:00", pauseMin: 0 },
  });
  await prisma.customerMonth.create({ data: { orgId: ORG, userId: reportId, year: 2026, month: 8, customerId, projectId, hours: 6 } });

  // A4: weder Projekt noch Kunde haben einen Stundensatz — der Umsatz muss
  // sauber 0 werden, nicht NaN und nicht null in einer Summe.
  const rateLessCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Kunde ohne Stundensatz", hourlyRate: null } });
  rateLessCustomerId = rateLessCustomer.id;
  const rateLessProject = await prisma.project.create({
    data: { orgId: ORG, customerId: rateLessCustomerId, name: "Projekt ohne Stundensatz", hourlyRate: null, budgetHours: null },
  });
  rateLessProjectId = rateLessProject.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-04"), type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0 },
  });
  await prisma.customerMonth.create({ data: { orgId: ORG, userId: reportId, year: 2026, month: 8, customerId: rateLessCustomerId, projectId: rateLessProjectId, hours: 4 } });

  // A4: Budget EXAKT erreicht (4h Budget, 4h gearbeitet) — Grenzfall der
  // Hervorhebung, darf nicht als überzogen markiert werden.
  const exactBudgetCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Budget-Kunde", hourlyRate: 100 } });
  exactBudgetCustomerId = exactBudgetCustomer.id;
  const exactBudgetProject = await prisma.project.create({
    data: { orgId: ORG, customerId: exactBudgetCustomerId, name: "Budget-Projekt", hourlyRate: 100, budgetHours: 4 },
  });
  exactBudgetProjectId = exactBudgetProject.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-05"), type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0 },
  });
  await prisma.customerMonth.create({ data: { orgId: ORG, userId: reportId, year: 2026, month: 8, customerId: exactBudgetCustomerId, projectId: exactBudgetProjectId, hours: 4 } });

  // Kunde ohne jedes Projekt, 3h direkt verbucht — der Fall "nur Kunden
  // verrechnen" aus dem Bugfix.
  const directCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Direktkunde ohne Projekt", hourlyRate: 120 } });
  directCustomerId = directCustomer.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-06"), type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0 },
  });
  await prisma.customerMonth.create({ data: { orgId: ORG, userId: reportId, year: 2026, month: 8, customerId: directCustomerId, hours: 3 } });

  // Zeitverteilung (Kunden/Intern/Absenzen) — eigener Monat (September),
  // damit er nicht mit den CustomerMonth-Fixturen von MONTH_QS (August)
  // interferiert. report arbeitet 5h beim Tageskunden (echte tagesgenaue
  // Erfassung, KEIN CustomerMonth), 3h ohne Kundenzuordnung (intern), und
  // hat einen ganzen Ferientag.
  const dailyCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Tageskunde", hourlyRate: 140 } });
  dailyCustomerId = dailyCustomer.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-09-02"), type: "arbeit", von: "08:00", bis: "13:00", pauseMin: 0, customerId: dailyCustomerId },
  });
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-09-03"), type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0 },
  });
  // Ohne explizites hours-Feld → stundenAusEintrag() füllt das volle
  // Tagessoll ein, damit tage exakt 1 wird (statt eines krummen Verhältnisses
  // zu einem fest verdrahteten hours-Wert).
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-09-07"), type: "ferien" },
  });
});

afterAll(async () => {
  await prisma.monthLockAudit.deleteMany({ where: { orgId: ORG } });
  await prisma.monthLock.deleteMany({ where: { orgId: ORG } });
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.customerMonth.deleteMany({ where: { orgId: ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, managerId, reportId, otherMemberId, loneManagerId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

const MONTH_QS = "type=month&year=2026&month=8";
const SEPT_QS = "type=month&year=2026&month=9";

describe("GET /api/team — Berechtigungs-Scoping", () => {
  it("member erhält 403", async () => {
    setSession(otherMemberId, ORG, "member");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(403);
  });

  it("manager sieht nur sich selbst + direkt unterstellte Mitglieder", async () => {
    setSession(managerId, ORG, "manager");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const userIds = body.members.map((m: any) => m.userId);
    expect(userIds).toContain(managerId);
    expect(userIds).toContain(reportId);
    expect(userIds).not.toContain(otherMemberId);
    expect(userIds).not.toContain(ownerId);
  });

  it("admin sieht alle Mitglieder der Organisation", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const userIds = body.members.map((m: any) => m.userId);
    expect(userIds).toEqual(expect.arrayContaining([ownerId, adminId, managerId, reportId, otherMemberId]));
  });

  it("Pensum-Spalte zeigt das zum Periodenende gültige Pensum, nicht das heute aktuelle (Bugfix)", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`)); // August 2026
    expect(res.status).toBe(200);
    const body = await res.json();
    const other = body.members.find((m: any) => m.userId === otherMemberId);
    expect(other.pensum).toBe(60); // NICHT 80 — der Wechsel gilt erst ab September
  });
});

describe("GET /api/team — Kunden-/Projektsicht, Feriensaldo", () => {
  it("liefert Projektstunden, erkennt Budgetüberschreitung, und rechnet den Umsatz aus dem Stundensatz", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const project = body.projects.find((p: any) => p.id === projectId);
    expect(project).toBeTruthy();
    expect(project.stunden).toBe(6);
    expect(project.ueberzogen).toBe(true); // 6h > budgetHours (5h)
    expect(project.umsatz).toBe(1200); // 6h * 200 CHF/h

    const customer = body.customers.find((c: any) => c.id === customerId);
    expect(customer.stunden).toBe(6); // die Projektstunden fliessen in die Kundensicht ein
  });

  it("Kunde ohne jedes Projekt wird trotzdem mit seinen direkt verbuchten Stunden aggregiert", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const customer = body.customers.find((c: any) => c.id === directCustomerId);
    expect(customer).toBeTruthy();
    expect(customer.stunden).toBe(3);
    expect(customer.umsatz).toBe(360); // 3h * 120 CHF/h
    // Dieser Kunde taucht bewusst NICHT in body.projects auf — es gibt kein Project.
    expect(body.projects.find((p: any) => p.customerName === "Direktkunde ohne Projekt")).toBeUndefined();
  });

  it("jedes Mitglied hat einen Feriensaldo", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.feriensaldo).toBeTruthy();
    expect(typeof reportMember.feriensaldo.anspruch).toBe("number");
  });

  it("totals sind über alle sichtbaren Mitglieder aggregiert", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    expect(body.totals.ist).toBeGreaterThanOrEqual(6); // mindestens reports 6h
  });
});

describe("GET /api/team — Randfälle (HARDENING.md A4)", () => {
  it("Projekt UND Kunde ohne Stundensatz: Umsatz ist sauber 0, keine NaN/null-Werte", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();

    const project = body.projects.find((p: any) => p.id === rateLessProjectId);
    expect(project.stunden).toBe(4);
    expect(project.hourlyRate).toBe(0); // Fallback Projekt → Kunde → 0
    expect(project.umsatz).toBe(0);
    expect(Number.isFinite(project.umsatz)).toBe(true);

    const customer = body.customers.find((c: any) => c.id === rateLessCustomerId);
    expect(customer.stunden).toBe(4);
    expect(customer.umsatz).toBe(0);
    expect(Number.isFinite(customer.umsatz)).toBe(true);

    // Und der entscheidende Teil: der satzlose Kunde reisst keine Summe mit.
    for (const c of body.customers) {
      expect(Number.isFinite(c.umsatz), `Umsatz von ${c.name}`).toBe(true);
    }
    for (const p of body.projects) {
      expect(Number.isFinite(p.umsatz), `Umsatz von ${p.name}`).toBe(true);
    }
  });

  it("Budget exakt erreicht (4h von 4h) gilt NICHT als überzogen", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const project = body.projects.find((p: any) => p.id === exactBudgetProjectId);
    expect(project.stunden).toBe(4);
    expect(project.budgetHours).toBe(4);
    expect(project.ueberzogen).toBe(false); // strikt >, nicht >=
  });

  it("manager ohne direkt unterstellte Personen sieht nur sich selbst, kein Crash", async () => {
    setSession(loneManagerId, ORG, "manager");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members.map((m: any) => m.userId)).toEqual([loneManagerId]);
    expect(body.totals.ist).toBe(0);
    expect(body.totals.verrechnungsgrad).toBe(0); // keine Division durch 0
  });

  it("manager ohne direkt unterstellte Personen bekommt eine leere Genehmigungsliste, kein Crash", async () => {
    setSession(loneManagerId, ORG, "manager");
    const res = await absenceRequestsGet(req("/api/absence-requests?scope=team"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toEqual([]);
  });
});

// Einheitliche Team-Übersicht (Teamleiter-Wunsch: Kunden/Intern/Absenzen an
// einer Stelle statt verstreut über Absenzen- und Teamansicht) sowie der
// Bugfix, dass customers[] vorher ausschliesslich CustomerMonth-Zeilen zeigte.
describe("GET /api/team — Zeitverteilung (Kunden/Intern/Absenzen) und Kunden aus Tageserfassung", () => {
  it("customers[] enthält jetzt auch Kunden, die nur tagesgenau (TimeEntry.customerId) gebucht wurden", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const customer = body.customers.find((c: any) => c.id === dailyCustomerId);
    expect(customer).toBeTruthy();
    expect(customer.stunden).toBe(5);
    expect(customer.umsatz).toBe(700); // 5h * 140 CHF/h
  });

  it("members[].kundenNachKunde schlüsselt die Kundenstunden dieser Person einzeln auf", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.kundenNachKunde).toEqual([{ customerId: dailyCustomerId, name: "Tageskunde", stunden: 5 }]);
  });

  it("members[].verteilung trennt Kunden-Arbeit, interne Arbeit und Absenzen", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.verteilung.kunden).toBe(5);
    expect(reportMember.verteilung.intern).toBe(3); // 3h ohne Kundenzuordnung
    expect(reportMember.verteilung.absenzen.ferien).toEqual({ stunden: expect.any(Number), tage: 1 });
    expect(reportMember.verteilung.absenzen.ferien.stunden).toBeGreaterThan(0);
  });

  it("totals.verteilung summiert die Verteilung über alle sichtbaren Mitglieder", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    const body = await res.json();
    expect(body.totals.verteilung.kunden).toBeGreaterThanOrEqual(5);
    expect(body.totals.verteilung.absenzen.ferien.tage).toBeGreaterThanOrEqual(1);
  });

  it("manager sieht in customers[] nur Kunden seines eigenen Teams", async () => {
    setSession(managerId, ORG, "manager");
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    // reportId ist dem manager unterstellt → dessen Tageskunde ist sichtbar.
    expect(body.customers.find((c: any) => c.id === dailyCustomerId)).toBeTruthy();
    // otherMemberId ist NICHT unterstellt und hat ohnehin keine Buchung —
    // der lone manager (kein Team) darf denselben Kunden gar nicht sehen.
    setSession(loneManagerId, ORG, "manager");
    const loneRes = await teamGet(req(`/api/team?${SEPT_QS}`));
    const loneBody = await loneRes.json();
    expect(loneBody.customers.find((c: any) => c.id === dailyCustomerId)).toBeUndefined();
  });
});

// Team-Hub: kumulierter Saldo seit Eintritt (lib/saldo.ts) und Monatsabschluss
// je Person, bisher nur in Analytics (eigene Person) bzw. /admin/team
// (Admin-only, ohne Zahlen) verfügbar.
describe("GET /api/team — Eintrittsdatum je Person", () => {
  it("liefert entryDate roh mit, editierbar über /api/team/member-dates", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.entryDate.slice(0, 10)).toBe("2026-01-01");
  });

  // Kernpunkt der Vereinfachung (kein separates Startdatum-Feld mehr):
  // eine Person mit entryDate MITTEN im abgefragten Monat bekommt ihr Soll
  // erst ab diesem Tag, nicht rückwirkend ab dem 1. — buildProfil()
  // (lib/export-helpers.ts) lässt startDate auf entryDate zurückfallen.
  it("Soll zählt erst ab dem Eintrittsdatum, nicht ab Periodenbeginn (ohne separates Startdatum)", async () => {
    setSession(adminId, ORG, "admin");
    // Eigene, unabhängige Fixtur: tritt am 20.08.2026 ein, kein startDate.
    // August statt eines Zukunftsmonats, weil kennzahlen() soll ohnehin bei
    // "heute" kappt — ein Monat komplett in der Zukunft läge sonst gänzlich
    // ausserhalb von bisHeute und ergäbe soll=0, unabhängig vom Eintritt.
    const lateUser = await prisma.user.create({ data: { email: "team-route-late-entry@example.test", password: "irrelevant", firstName: "Late", lastName: "Entry" } });
    await prisma.membership.create({
      data: { orgId: ORG, userId: lateUser.id, role: "member", entryDate: new Date("2026-08-20"), weeklyHours: 40, pensum: 100 },
    });
    try {
      const res = await teamGet(req(`/api/team?${MONTH_QS}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      const m = body.members.find((x: any) => x.userId === lateUser.id);
      expect(m).toBeTruthy();
      // August 2026: 20.–31.8. enthält 8 Werktage (Do 20. bis Mo 31.) à 8h =
      // 64h — NICHT das volle Monatssoll ab dem 1.
      expect(m.soll).toBe(64);
    } finally {
      await prisma.membership.deleteMany({ where: { orgId: ORG, userId: lateUser.id } });
      await prisma.user.delete({ where: { id: lateUser.id } });
    }
  });
});

describe("GET /api/team — Saldo kumuliert und Monatsabschluss", () => {
  it("members[].saldoKumuliert ist seit dem Eintrittsdatum gerechnet, nicht seit Periodenbeginn", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`)); // August 2026
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    // reportId ist seit 01.01.2026 Mitglied (entryDate) — der kumulierte
    // Saldo beginnt dort, nicht erst am 01.08.
    expect(reportMember.saldoKumuliert.since).toBe("2026-01-01");
    expect(typeof reportMember.saldoKumuliert.netOvertime).toBe("number");
    expect(Array.isArray(reportMember.saldoSerie)).toBe(true);
    expect(reportMember.saldoSerie.length).toBeGreaterThan(0);
  });

  it("monthLock/monthLocked sind nur bei einem exakten Kalendermonat gesetzt, sonst null", async () => {
    setSession(adminId, ORG, "admin");
    const monthRes = await teamGet(req(`/api/team?${MONTH_QS}`));
    const monthBody = await monthRes.json();
    expect(monthBody.monthLock).toEqual({ year: 2026, month: 8 });
    expect(monthBody.members.find((m: any) => m.userId === reportId).monthLocked).toBe(false);

    const customRes = await teamGet(req("/api/team?type=custom&from=2026-08-10&to=2026-08-20"));
    const customBody = await customRes.json();
    expect(customBody.monthLock).toBeNull();
    expect(customBody.members.find((m: any) => m.userId === reportId).monthLocked).toBeNull();
  });

  it("monthLocked wird true, sobald der Monat für diese Person gesperrt ist", async () => {
    await prisma.monthLock.create({ data: { orgId: ORG, userId: reportId, year: 2026, month: 8, lockedBy: adminId } });
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    expect(body.members.find((m: any) => m.userId === reportId).monthLocked).toBe(true);
    // otherMemberId ist für diesen Monat nicht gesperrt.
    expect(body.members.find((m: any) => m.userId === otherMemberId).monthLocked).toBe(false);
  });
});

// Projektsicht jetzt primär aus der Tageserfassung (TimeEntry.projectId) statt
// ausschliesslich aus CustomerMonth (Nachtrag "Projektstunden pro Tag").
describe("GET /api/team — Projektstunden aus der Tageserfassung", () => {
  it("ein täglich über TimeEntry.projectId gebuchtes Projekt erscheint in projects[]", async () => {
    setSession(adminId, ORG, "admin");
    await prisma.timeEntry.create({
      data: {
        userId: reportId,
        orgId: ORG,
        date: new Date("2026-09-10"),
        type: "arbeit",
        von: "08:00",
        bis: "12:30",
        pauseMin: 0,
        customerId: dailyCustomerId,
        projectId,
      },
    });
    const res = await teamGet(req(`/api/team?${SEPT_QS}`));
    const body = await res.json();
    const project = body.projects.find((p: any) => p.id === projectId);
    expect(project).toBeTruthy();
    expect(project.stunden).toBe(4.5);
    expect(project.customerName).toBe("Team-Route-Kunde");
  });
});

// HARDENING.md B2 — Fehlerpfade von /api/team. Die Zeitraum-Parameter laufen
// über dasselbe parseExportRange wie die Export-Routen, die Validierung aus
// B2 muss hier also ebenso greifen.
describe("GET /api/team — Fehlerpfade (HARDENING.md B2)", () => {
  it("year=abc liefert 400, nicht 500", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req("/api/team?type=month&year=abc&month=8"));
    expect(res.status).toBe(400);
  });

  it("month=99 liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req("/api/team?type=month&year=2026&month=99"));
    expect(res.status).toBe(400);
  });

  it("type=custom mit unparsbarem from liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req("/api/team?type=custom&from=keinDatum&to=2026-08-31"));
    expect(res.status).toBe(400);
  });

  it("gültige Parameter funktionieren weiterhin", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    expect(res.status).toBe(200);
  });
});
