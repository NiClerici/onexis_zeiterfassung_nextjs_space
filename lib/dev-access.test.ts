// Tests für lib/dev-access.ts — reine Funktionen, kein DB-Zugriff nötig.
// requireDeveloper() selbst (Session-Aufruf) wird bewusst nicht hier
// getestet, sondern implizit über die Seiten unter app/(dev) — ein Mock von
// getServerSession() würde hier nur requireSession() aus lib/access.ts
// duplizieren, ohne zusätzlichen Erkenntniswert.

import { describe, expect, it } from "vitest";
import { isDeveloperEmail, parseDeveloperEmails } from "@/lib/dev-access";

describe("parseDeveloperEmails", () => {
  it("liefert eine leere Liste ohne ENV-Wert", () => {
    expect(parseDeveloperEmails(undefined)).toEqual([]);
    expect(parseDeveloperEmails(null)).toEqual([]);
    expect(parseDeveloperEmails("")).toEqual([]);
  });

  it("trimmt, lowercased und ignoriert leere Einträge", () => {
    expect(parseDeveloperEmails(" Nic@Example.com , b@example.com,, c@example.com ")).toEqual([
      "nic@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });
});

describe("isDeveloperEmail", () => {
  it("fail-closed: niemand hat Zugang, wenn DEVELOPER_EMAILS leer oder ungesetzt ist", () => {
    expect(isDeveloperEmail("nic@example.com", undefined)).toBe(false);
    expect(isDeveloperEmail("nic@example.com", "")).toBe(false);
  });

  it("erkennt eine E-Mail auf der Allowlist unabhängig von Gross-/Kleinschreibung", () => {
    expect(isDeveloperEmail("Nic@Example.com", "nic@example.com")).toBe(true);
    expect(isDeveloperEmail("nic@example.com", "other@x.ch, NIC@EXAMPLE.COM")).toBe(true);
  });

  it("lehnt eine E-Mail ohne Allowlist-Treffer ab", () => {
    expect(isDeveloperEmail("other@x.ch", "nic@example.com")).toBe(false);
    expect(isDeveloperEmail(null, "nic@example.com")).toBe(false);
    expect(isDeveloperEmail(undefined, "nic@example.com")).toBe(false);
  });

  it("verlangt exakte Gleichheit — Teilstring-Treffer zählen nicht", () => {
    expect(isDeveloperEmail("xnic@example.com", "nic@example.com")).toBe(false);
    expect(isDeveloperEmail("nic@example.com.evil.test", "nic@example.com")).toBe(false);
  });

  it("toleriert Whitespace um die eingegebene E-Mail", () => {
    expect(isDeveloperEmail("  nic@example.com  ", "nic@example.com")).toBe(true);
  });
});
