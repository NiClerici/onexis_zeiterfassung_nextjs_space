// Tests für lib/error-log.ts — insbesondere die Garantie "wirft niemals",
// die logError() für jeden Aufrufer in einem catch-Block braucht: ein
// Fehler beim Loggen darf niemals die eigentliche Fehler-Response
// verhindern (Muster für den DB-down-Fall aus lib/health.test.ts
// übernommen).

import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";

const ORG = "test_error_log_org";

afterAll(async () => {
  await prisma.errorLog.deleteMany({ where: { orgId: ORG } });
});

describe("logError", () => {
  it("schreibt eine Zeile mit Quelle, Meldung und Stacktrace", async () => {
    const { logError } = await import("@/lib/error-log");
    await logError("POST /api/test", new Error("kaputt"), { orgId: ORG, userId: "user-1" });

    const rows = await prisma.errorLog.findMany({ where: { orgId: ORG } });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("POST /api/test");
    expect(rows[0].message).toBe("kaputt");
    expect(rows[0].stack).toContain("kaputt");
    expect(rows[0].userId).toBe("user-1");
  });

  it("loggt AccessError NICHT — das sind erwartete Ablehnungen, keine Störungen", async () => {
    const { logError } = await import("@/lib/error-log");
    const before = await prisma.errorLog.count({ where: { orgId: ORG } });
    await logError("POST /api/test", new AccessError(403, "Forbidden"), { orgId: ORG });
    const after = await prisma.errorLog.count({ where: { orgId: ORG } });
    expect(after).toBe(before);
  });

  it("wirft nicht, wenn die Datenbank nicht erreichbar ist", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      prisma: { errorLog: { create: () => Promise.reject(new Error("connection refused")) } },
    }));
    const { logError } = await import("@/lib/error-log");
    await expect(logError("POST /api/test", new Error("egal"))).resolves.toBeUndefined();
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  it("verarbeitet auch Nicht-Error-Werte (z.B. geworfene Strings) ohne zu werfen", async () => {
    const { logError } = await import("@/lib/error-log");
    await expect(logError("POST /api/test", "irgendein String")).resolves.toBeUndefined();
    const row = await prisma.errorLog.findFirst({ where: { orgId: null, message: "irgendein String" } });
    expect(row).not.toBeNull();
    if (row) await prisma.errorLog.delete({ where: { id: row.id } });
  });
});
