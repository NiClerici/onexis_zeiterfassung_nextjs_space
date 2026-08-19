import { describe, expect, it } from "vitest";
import { diffTimeEntryFields } from "./audit";

describe("diffTimeEntryFields", () => {
  it("liefert eine leere Liste, wenn sich nichts geändert hat", () => {
    const state = { date: new Date("2026-08-10"), type: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30, notiz: null, hours: null };
    expect(diffTimeEntryFields(state, { ...state })).toEqual([]);
  });

  it("erkennt eine Änderung an einem einzelnen Feld", () => {
    const before = { von: "08:00", bis: "17:00" };
    const after = { von: "08:00", bis: "18:00" };
    expect(diffTimeEntryFields(before, after)).toEqual([{ field: "bis", oldValue: "17:00", newValue: "18:00" }]);
  });

  it("erkennt mehrere geänderte Felder gleichzeitig", () => {
    const before = { type: "arbeit", hours: null, notiz: null };
    const after = { type: "krank", hours: 8, notiz: "Grippe" };
    const changes = diffTimeEntryFields(before, after);
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ field: "type", oldValue: "arbeit", newValue: "krank" });
    expect(changes).toContainEqual({ field: "hours", oldValue: null, newValue: "8" });
    expect(changes).toContainEqual({ field: "notiz", oldValue: null, newValue: "Grippe" });
  });

  it("behandelt null → Wert und Wert → null korrekt, nicht als Gleichstand", () => {
    expect(diffTimeEntryFields({ notiz: null }, { notiz: "Homeoffice" })).toEqual([
      { field: "notiz", oldValue: null, newValue: "Homeoffice" },
    ]);
    expect(diffTimeEntryFields({ notiz: "Homeoffice" }, { notiz: null })).toEqual([
      { field: "notiz", oldValue: "Homeoffice", newValue: null },
    ]);
  });

  it("reduziert Date-Felder auf den UTC-Kalendertag, damit gleiche Tage nicht als Änderung gelten", () => {
    const before = { date: new Date("2026-08-10T00:00:00.000Z") };
    const after = { date: new Date("2026-08-10T00:00:00.000Z") };
    expect(diffTimeEntryFields(before, after)).toEqual([]);
  });

  it("erkennt eine echte Datumsänderung", () => {
    const before = { date: new Date("2026-08-10T00:00:00.000Z") };
    const after = { date: new Date("2026-08-11T00:00:00.000Z") };
    expect(diffTimeEntryFields(before, after)).toEqual([{ field: "date", oldValue: "2026-08-10", newValue: "2026-08-11" }]);
  });

  it("ignoriert nicht-auditierte Felder wie id oder userId", () => {
    const before = { id: "a", userId: "u1", von: "08:00" };
    const after = { id: "a", userId: "u1", von: "08:00" };
    expect(diffTimeEntryFields(before, after)).toEqual([]);
  });
});
