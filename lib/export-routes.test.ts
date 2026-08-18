// Berechtigungs-Tests für die drei Export-Routen (MIGRATION.md Punkt 7):
// /api/export (scope=self|person|org), /api/export/arg-control (dieselben
// scopes) und /api/export/payroll (immer org-weit, admin/owner-only). Prüft
// bewusst nur die sicherheitsrelevanten Pfade (wer darf was) und je einen
// Erfolgsfall mit Inhalts-Sanity-Check — nicht jede Excel-Zelle einzeln
// (dafür ist lib/calc.test.ts/wochenUebersicht der richtige Ort, die
// zugrundeliegende Berechnung ist dort bereits vollständig getestet).

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { GET as exportGet } from "@/app/api/export/route";
import { GET as argControlGet } from "@/app/api/export/arg-control/route";
import { GET as payrollGet } from "@/app/api/export/payroll/route";

const ORG = "test_export_org";

function req(url: string): Request {
  return new Request(`http://localhost${url}`);
}

let ownerId: string, adminId: string, memberAId: string, memberBId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Export Test Org", slug: "export-test-org" } });
  const mkUser = async (email: string, firstName: string, lastName: string) => {
    const u = await prisma.user.create({ data: { email, password: "irrelevant", firstName, lastName } });
    return u.id;
  };
  // Bewusst zwei Nutzer mit identischem Namen (Owner/Admin) — reproduziert
  // den ExcelJS-"Worksheet name already exists"-Fund aus scope=org und
  // verifiziert die Disambiguierung.
  ownerId = await mkUser("export-test-owner@example.test", "Sam", "Muster");
  adminId = await mkUser("export-test-admin@example.test", "Sam", "Muster");
  memberAId = await mkUser("export-test-membera@example.test", "Mia", "Muster");
  memberBId = await mkUser("export-test-memberb@example.test", "Nico", "Muster");

  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: adminId, role: "admin", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: memberAId, role: "member", entryDate: new Date("2026-01-01") } });
  await prisma.membership.create({ data: { orgId: ORG, userId: memberBId, role: "member", entryDate: new Date("2026-01-01"), pensum: 60, weeklyHours: 40 } });
  // Bugfix-Szenario (wie im Teamsicht-Test): Pensum wechselt erst per
  // Oktober auf 80% — der Lohnexport für September (MONTH_QS unten) muss
  // weiterhin 60% zeigen.
  await prisma.pensumChange.create({ data: { orgId: ORG, userId: memberBId, pensum: 80, weeklyHours: 40, effectiveFrom: new Date("2026-10-01") } });

  await prisma.timeEntry.create({
    data: { userId: memberAId, orgId: ORG, date: new Date("2026-09-03"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.pensumChange.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberAId, memberBId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

const MONTH_QS = "type=month&year=2026&month=9";

describe("GET /api/export — Excel-Export (scope=self|person|org)", () => {
  it("scope=self liefert für jede Rolle ein xlsx", async () => {
    setSession(memberAId, ORG, "member");
    const res = await exportGet(req(`/api/export?${MONTH_QS}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("scope=person: member darf NICHT für ein anderes, nicht verbundenes Mitglied exportieren", async () => {
    setSession(memberBId, ORG, "member");
    const res = await exportGet(req(`/api/export?${MONTH_QS}&scope=person&userId=${memberAId}`));
    expect(res.status).toBe(403);
  });

  it("scope=person: admin darf für ein beliebiges Mitglied exportieren", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req(`/api/export?${MONTH_QS}&scope=person&userId=${memberAId}`));
    expect(res.status).toBe(200);
  });

  it("scope=org: member/admin-lose Rolle ist verboten, admin/owner erlaubt", async () => {
    setSession(memberAId, ORG, "member");
    const resMember = await exportGet(req(`/api/export?${MONTH_QS}&scope=org`));
    expect(resMember.status).toBe(403);

    setSession(ownerId, ORG, "owner");
    const resOwner = await exportGet(req(`/api/export?${MONTH_QS}&scope=org`));
    expect(resOwner.status).toBe(200);
    expect(resOwner.headers.get("Content-Type")).toContain("spreadsheetml");
  });
});

describe("GET /api/export/arg-control — ArG-Kontrollexport (scope=self|person|org)", () => {
  it("scope=self liefert ein xlsx", async () => {
    setSession(memberAId, ORG, "member");
    const res = await argControlGet(req(`/api/export/arg-control?${MONTH_QS}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("scope=person ohne Berechtigung liefert 403", async () => {
    setSession(memberBId, ORG, "member");
    const res = await argControlGet(req(`/api/export/arg-control?${MONTH_QS}&scope=person&userId=${memberAId}`));
    expect(res.status).toBe(403);
  });

  it("scope=org ist nur admin/owner erlaubt", async () => {
    setSession(memberAId, ORG, "member");
    const resMember = await argControlGet(req(`/api/export/arg-control?${MONTH_QS}&scope=org`));
    expect(resMember.status).toBe(403);

    setSession(adminId, ORG, "admin");
    const resAdmin = await argControlGet(req(`/api/export/arg-control?${MONTH_QS}&scope=org`));
    expect(resAdmin.status).toBe(200);
  });
});

describe("GET /api/export/payroll — Lohnexport CSV (immer org-weit, admin/owner-only)", () => {
  it("member/manager erhalten 403", async () => {
    setSession(memberAId, ORG, "member");
    const res = await payrollGet(req("/api/export/payroll?year=2026&month=9"));
    expect(res.status).toBe(403);
  });

  it("admin erhält ein CSV mit Semikolon-Header und einer Zeile pro Mitglied", async () => {
    setSession(adminId, ORG, "admin");
    const res = await payrollGet(req("/api/export/payroll?year=2026&month=9"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0].split(";")).toContain("Ueberstunden");
    // 4 Mitgliedschaften angelegt in beforeAll → 4 Datenzeilen + 1 Header.
    expect(lines).toHaveLength(5);
    // memberA hatte einen 8h-Arbeitseintrag (08:00-17:00, 30min Pause) am 03.09.2026.
    const memberARow = lines.find((l) => l.includes(memberAId));
    expect(memberARow).toBeTruthy();
    const cols = memberARow!.split(";");
    expect(cols[6]).toBe("8,50"); // Arbeitsstunden-Spalte, Komma als Dezimaltrennzeichen
  });

  it("Pensum-Spalte zeigt das zum Monatsende gültige Pensum, nicht das heute aktuelle (Bugfix)", async () => {
    setSession(adminId, ORG, "admin");
    const res = await payrollGet(req("/api/export/payroll?year=2026&month=9")); // September
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    const memberBRow = lines.find((l) => l.includes(memberBId));
    expect(memberBRow).toBeTruthy();
    const cols = memberBRow!.split(";");
    expect(cols[4]).toBe("60,00"); // NICHT 80,00 — der Wechsel gilt erst ab Oktober
  });
});

// HARDENING.md B2 — Fehlerpfade der Export-Routen. Der Coverage-Bericht aus
// B1 zeigte für /api/export 92.63% Statements bei nur 53.57% Branches: der
// Happy Path lief, die Eingabevalidierung nicht. Dabei kam heraus, dass
// fehlerhafte Zeitraum-Parameter 500 statt 400 lieferten.
describe("Export-Routen — Fehlerpfade (HARDENING.md B2)", () => {
  it("type=custom mit unparsbarem from liefert 400, nicht 500", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req("/api/export?scope=self&type=custom&from=keinDatum&to=2026-09-30"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("from");
  });

  it("type=custom mit unparsbarem to liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req("/api/export?scope=self&type=custom&from=2026-09-01&to=auchNicht"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("to");
  });

  it("year=abc liefert 400, nicht 500", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req("/api/export?scope=self&type=month&year=abc&month=9"));
    expect(res.status).toBe(400);
  });

  it("month=99 liefert 400 statt eines still verschobenen Zeitraums", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req("/api/export?scope=self&type=month&year=2026&month=99"));
    expect(res.status).toBe(400);
  });

  it("year ausserhalb 2000–2100 liefert 400", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req("/api/export?scope=self&type=month&year=1899&month=9"));
    expect(res.status).toBe(400);
  });

  it("dieselbe Validierung greift in arg-control und payroll", async () => {
    setSession(adminId, ORG, "admin");
    const arg = await argControlGet(req("/api/export/arg-control?scope=self&type=month&year=abc&month=9"));
    expect(arg.status).toBe(400);
    // payroll ist bewusst immer monatsweise (kein type-Parameter), nutzt aber
    // seit B2 dieselbe Jahres-/Monatsvalidierung statt einer eigenen ohne
    // Jahresgrenzen.
    const payrollJahr = await payrollGet(req("/api/export/payroll?year=abc&month=9"));
    expect(payrollJahr.status).toBe(400);
    const payrollGrenze = await payrollGet(req("/api/export/payroll?year=1899&month=9"));
    expect(payrollGrenze.status).toBe(400);
    const payrollOk = await payrollGet(req("/api/export/payroll?year=2026&month=9"));
    expect(payrollOk.status).toBe(200);
  });

  it("gültige Parameter funktionieren weiterhin (kein Overblocking)", async () => {
    setSession(adminId, ORG, "admin");
    const month = await exportGet(req(`/api/export?scope=self&${MONTH_QS}`));
    expect(month.status).toBe(200);
    const custom = await exportGet(req("/api/export?scope=self&type=custom&from=2026-09-01&to=2026-09-30"));
    expect(custom.status).toBe(200);
    // type=custom ohne from/to fällt bewusst auf das ganze Jahr zurück.
    const ohneGrenzen = await exportGet(req("/api/export?scope=self&type=custom&year=2026"));
    expect(ohneGrenzen.status).toBe(200);
  });

  it("scope=person mit unbekannter userId liefert 404, nicht 500", async () => {
    setSession(adminId, ORG, "admin");
    const res = await exportGet(req(`/api/export?scope=person&userId=gibtesnicht&${MONTH_QS}`));
    expect(res.status).toBe(404);
  });

  it("scope=person mit einer userId aus einer FREMDEN Org liefert 404, nicht deren Daten", async () => {
    const fremdeOrg = "test_export_fremde_org";
    const fremderUser = await prisma.user.create({
      data: { email: "export-fremd@example.test", password: "irrelevant", firstName: "Fremd", lastName: "Person" },
    });
    await prisma.organization.create({ data: { id: fremdeOrg, name: "Fremde Org", slug: "export-fremde-org" } });
    await prisma.membership.create({ data: { orgId: fremdeOrg, userId: fremderUser.id, role: "member", entryDate: new Date("2026-01-01") } });
    try {
      setSession(adminId, ORG, "admin");
      const res = await exportGet(req(`/api/export?scope=person&userId=${fremderUser.id}&${MONTH_QS}`));
      expect(res.status).toBe(404);
    } finally {
      await prisma.membership.deleteMany({ where: { orgId: fremdeOrg } });
      await prisma.organization.deleteMany({ where: { id: fremdeOrg } });
      await prisma.user.deleteMany({ where: { id: fremderUser.id } });
    }
  });
});
