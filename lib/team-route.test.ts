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

  // report arbeitet 6h an diesem Projekt — über dem Budget von 5h, für den
  // "ueberzogen"-Sanity-Check.
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-03"), type: "arbeit", von: "08:00", bis: "14:00", pauseMin: 0, customerId, projectId, billable: true },
  });

  // A4: weder Projekt noch Kunde haben einen Stundensatz — der Umsatz muss
  // sauber 0 werden, nicht NaN und nicht null in einer Summe.
  const rateLessCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Kunde ohne Stundensatz", hourlyRate: null } });
  rateLessCustomerId = rateLessCustomer.id;
  const rateLessProject = await prisma.project.create({
    data: { orgId: ORG, customerId: rateLessCustomerId, name: "Projekt ohne Stundensatz", hourlyRate: null, budgetHours: null },
  });
  rateLessProjectId = rateLessProject.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-04"), type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0, customerId: rateLessCustomerId, projectId: rateLessProjectId, billable: true },
  });

  // A4: Budget EXAKT erreicht (4h Budget, 4h gearbeitet) — Grenzfall der
  // Hervorhebung, darf nicht als überzogen markiert werden.
  const exactBudgetCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Budget-Kunde", hourlyRate: 100 } });
  exactBudgetCustomerId = exactBudgetCustomer.id;
  const exactBudgetProject = await prisma.project.create({
    data: { orgId: ORG, customerId: exactBudgetCustomerId, name: "Budget-Projekt", hourlyRate: 100, budgetHours: 4 },
  });
  exactBudgetProjectId = exactBudgetProject.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-05"), type: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0, customerId: exactBudgetCustomerId, projectId: exactBudgetProjectId, billable: true },
  });

  // Kunde ohne jedes Projekt, 3h direkt verbucht — der Fall "nur Kunden
  // verrechnen" aus dem Bugfix.
  const directCustomer = await prisma.customer.create({ data: { orgId: ORG, name: "Direktkunde ohne Projekt", hourlyRate: 120 } });
  directCustomerId = directCustomer.id;
  await prisma.timeEntry.create({
    data: { userId: reportId, orgId: ORG, date: new Date("2026-08-06"), type: "arbeit", von: "08:00", bis: "11:00", pauseMin: 0, customerId: directCustomerId, billable: true },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, managerId, reportId, otherMemberId, loneManagerId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

const MONTH_QS = "type=month&year=2026&month=8";

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

describe("GET /api/team — Kunden-/Projektsicht, Heatmap, Feriensaldo", () => {
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

  it("jedes Mitglied hat einen Feriensaldo und eine Heatmap-Wochenliste", async () => {
    setSession(adminId, ORG, "admin");
    const res = await teamGet(req(`/api/team?${MONTH_QS}`));
    const body = await res.json();
    const reportMember = body.members.find((m: any) => m.userId === reportId);
    expect(reportMember.feriensaldo).toBeTruthy();
    expect(typeof reportMember.feriensaldo.anspruch).toBe("number");

    const reportHeatmap = body.heatmap.find((h: any) => h.userId === reportId);
    expect(Array.isArray(reportHeatmap.weeks)).toBe(true);
    expect(reportHeatmap.weeks.length).toBeGreaterThan(0);
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
    expect(Array.isArray(body.heatmap)).toBe(true);
  });

  it("manager ohne direkt unterstellte Personen bekommt eine leere Genehmigungsliste, kein Crash", async () => {
    setSession(loneManagerId, ORG, "manager");
    const res = await absenceRequestsGet(req("/api/absence-requests?scope=team"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toEqual([]);
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
