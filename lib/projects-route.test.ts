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

import { POST as projectsPost, PUT as projectsPut } from "@/app/api/projects/route";

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

const ORG = "test_projects_route_org";
let userId: string;
let customerId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "Projects Route Test Org", slug: "projects-route-test-org" } });
  const user = await prisma.user.create({ data: { email: "projects-route@example.test", password: "irrelevant", firstName: "P", lastName: "Route" } });
  userId = user.id;
  await prisma.membership.create({ data: { orgId: ORG, userId, role: "member", entryDate: new Date("2026-01-01") } });
  const customer = await prisma.customer.create({ data: { orgId: ORG, name: "Projects-Route-Kunde" } });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { orgId: ORG } });
  await prisma.customer.deleteMany({ where: { orgId: ORG } });
  await prisma.membership.deleteMany({ where: { orgId: ORG } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
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
