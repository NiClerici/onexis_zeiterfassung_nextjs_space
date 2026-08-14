// Test für /api/health (MIGRATION.md Punkt 11). Zwei Fälle: echte DB
// erreichbar (Standard-Testmuster dieses Loops, gegen die echte Dev-DB) und
// DB nicht erreichbar (hier mit einem gemockten Prisma-Client simuliert,
// da dieser eine Fall nicht durch reales Trennen der DB-Verbindung
// provoziert werden kann, ohne die anderen, parallel laufenden Testdateien
// zu stören).

import { describe, expect, it, vi } from "vitest";

describe("GET /api/health — DB erreichbar", () => {
  it("liefert 200 mit status=ok, wenn die Datenbank antwortet", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
  });
});

describe("GET /api/health — DB nicht erreichbar", () => {
  it("liefert 503 mit status=error, wenn die Datenbank-Query fehlschlägt", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      prisma: { $queryRaw: () => Promise.reject(new Error("connection refused")) },
    }));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.database).toBe("unreachable");
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });
});
