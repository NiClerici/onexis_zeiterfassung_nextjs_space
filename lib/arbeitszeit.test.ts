import { describe, expect, it } from "vitest";
import { buildArbeitszeit, mindestPauseMin } from "./arbeitszeit";
import { pruefeCompliance } from "./compliance";

describe("mindestPauseMin — Pausenstaffel Art. 15 ArG", () => {
  it("bis und mit 5.5h ist keine Pause vorgeschrieben", () => {
    expect(mindestPauseMin(5.5)).toBe(0);
  });

  it("über 5.5h sind 15 Min. vorgeschrieben", () => {
    expect(mindestPauseMin(5.6)).toBe(15);
  });

  it("über 7h sind 30 Min. vorgeschrieben", () => {
    expect(mindestPauseMin(7.1)).toBe(30);
  });

  it("über 9h sind 60 Min. vorgeschrieben", () => {
    expect(mindestPauseMin(9.1)).toBe(60);
  });
});

describe("buildArbeitszeit — Regression: keine Selbstbeanstandung mehr", () => {
  it("5.8h bekommt 15 Min. Pause zugewiesen (vorher: 0, da die Auto-Pause erst ab 6h griff)", () => {
    const az = buildArbeitszeit(5.8);
    expect(az.pauseMin).toBe(15);
  });

  it("ein per 'Stunden direkt' mit 5.8h erzeugter Eintrag löst KEINE pause_zu_kurz-Warnung aus", () => {
    const az = buildArbeitszeit(5.8);
    const violations = pruefeCompliance(
      [{ date: "2026-08-10", typ: "arbeit", von: az.von, bis: az.bis, pauseMin: az.pauseMin }],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });

  it("9.5h bekommt weiterhin die volle 60-Min.-Pause statt der alten fixen 30 Min.", () => {
    const az = buildArbeitszeit(9.5);
    expect(az.pauseMin).toBe(60);
  });
});
