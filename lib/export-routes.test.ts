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
  await prisma.membership.create({ data: { orgId: ORG, userId: memberBId, role: "member", entryDate: new Date("2026-01-01") } });

  await prisma.timeEntry.create({
    data: { userId: memberAId, orgId: ORG, date: new Date("2026-09-03"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 },
  });
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
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
});
