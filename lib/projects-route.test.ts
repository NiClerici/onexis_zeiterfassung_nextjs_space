// Test für POST/PUT /api/projects — deckt bisher nur den Zusatz aus dem
// Stundenrapport-Export-Umbau ab (Project.externalRef), da die Route selbst
// noch keine eigene Testdatei hatte. Gleiches Muster wie
// lib/customer-months-route.test.ts.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

let mockSession: any = null;
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

function setSession(userId: string, orgId: string, role: string) {
  mockSession = { user: { id: userId, orgId, role, mustSetPassword: false } };
}

import { POST as projectsPost, PUT as projectsPut, DELETE as projectsDelete } from "@/app/api/projects/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_projects_route_org";
let userId: string;
let otherUserId: string;
let ownerId: string;
let customerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Projects Route Test Org", slug: "projects-route-test-org" } });
  const user = await prisma.user.create({ data: { email: "projects-route@example.test", password: "irrelevant", firstName: "P", lastName: "Route" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01") } });
  const otherUser = await prisma.user.create({ data: { email: "projects-route-other@example.test", password: "irrelevant", firstName: "O", lastName: "Route" } });
  otherUserId = otherUser.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: otherUserId, role: "member", entryDate: new Date("2026-01-01") } });
  const owner = await prisma.user.create({ data: { email: "projects-route-owner@example.test", password: "irrelevant", firstName: "Ow", lastName: "Route" } });
  ownerId = owner.id;
  await prisma.membership.create({ data: { orgId: ORG, userId: ownerId, role: "owner", entryDate: new Date("2026-01-01") } });
  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Projects-Route-Kunde" } });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { orgId: ORG } });
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId, ownerId] } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
});

describe("DELETE /api/projects — Rollenprüfung und Referenzsperre (Audit-Fund KRITISCH, geteilte Regel mit /api/customers)", () => {
  it("ein member darf das selbst angelegte Projekt löschen", async () => {
    setSession(userId, ORG, "member");
    const created = await projectsPost(jsonReq("/api/projects", "POST", { customerId, name: "Eigenes-Loeschbares-Projekt" }));
    const { project } = await created.json();

    const deleted = await projectsDelete(jsonReq("/api/projects", "DELETE", { id: project.id }));
    expect(deleted.status).toBe(200);
  });

  it("ein member darf ein fremdes Projekt NICHT löschen (403)", async () => {
    setSession(otherUserId, ORG, "member");
    const created = await projectsPost(jsonReq("/api/projects", "POST", { customerId, name: "Fremdes-Projekt" }));
    const { project } = await created.json();

    setSession(userId, ORG, "member");
    const deleted = await projectsDelete(jsonReq("/api/projects", "DELETE", { id: project.id }));
    expect(deleted.status).toBe(403);

    setSession(otherUserId, ORG, "member");
    await projectsDelete(jsonReq("/api/projects", "DELETE", { id: project.id }));
  });

  it("ein bebuchtes Projekt kann von KEINER Rolle gelöscht werden — 409 nennt die Zahl der Zeiteinträge", async () => {
    setSession(ownerId, ORG, "owner");
    const created = await projectsPost(jsonReq("/api/projects", "POST", { customerId, name: "Bebuchtes-Projekt" }));
    const { project } = await created.json();

    await prisma.timeEntry.create({
      data: { userId, orgId: ORG, date: new Date("2026-04-11"), type: "arbeit", customerId, projectId: project.id, hours: 8 },
    });

    const deletedByOwner = await projectsDelete(jsonReq("/api/projects", "DELETE", { id: project.id }));
    expect(deletedByOwner.status).toBe(409);
    const dataOwner = await deletedByOwner.json();
    expect(dataOwner.error).toContain("1 Zeiteintrag");

    await prisma.timeEntry.deleteMany({ where: { orgId: ORG, projectId: project.id } });
    await projectsDelete(jsonReq("/api/projects", "DELETE", { id: project.id }));
  });
});

describe("POST/PUT /api/projects — externalRef", () => {
  it("speichert externalRef beim Anlegen und lässt es leer, wenn keins mitgeschickt wird", async () => {
    setSession(userId, ORG, "member");
    const res = await projectsPost(
      jsonReq("/api/projects", "POST", { customerId, name: "Mit SAP-Nummer", externalRef: " 00000000000000068440TTO " })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.externalRef).toBe("00000000000000068440TTO"); // getrimmt

    const res2 = await projectsPost(jsonReq("/api/projects", "POST", { customerId, name: "Ohne SAP-Nummer" }));
    const data2 = await res2.json();
    expect(data2.project.externalRef).toBeNull();
  });

  it("setzt externalRef per PUT und wieder auf null zurück", async () => {
    setSession(userId, ORG, "member");
    const created = await projectsPost(jsonReq("/api/projects", "POST", { customerId, name: "Wird bearbeitet" }));
    const { project } = await created.json();
    expect(project.externalRef).toBeNull();

    const updated = await projectsPut(jsonReq("/api/projects", "PUT", { id: project.id, externalRef: "00000000000000923640TTO" }));
    const { project: updatedProject } = await updated.json();
    expect(updatedProject.externalRef).toBe("00000000000000923640TTO");

    const cleared = await projectsPut(jsonReq("/api/projects", "PUT", { id: project.id, externalRef: "" }));
    const { project: clearedProject } = await cleared.json();
    expect(clearedProject.externalRef).toBeNull();
  });
});
