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

describe("buildArbeitszeit — kein automatischer Pausen-Vorschlag mehr (Bugfix: neue Zeile bekam eine Pause, die niemand erfasst hat)", () => {
  it("liefert ohne opts.pauseMin IMMER 0 Minuten Pause, unabhängig von der Stundenzahl", () => {
    expect(buildArbeitszeit(5.8).pauseMin).toBe(0);
    expect(buildArbeitszeit(9.5).pauseMin).toBe(0);
    expect(buildArbeitszeit(2).pauseMin).toBe(0);
  });

  it("eine explizit übergebene pauseMin gewinnt weiterhin gegenüber dem 0-Default", () => {
    const az = buildArbeitszeit(8, { pauseMin: 45 });
    expect(az.pauseMin).toBe(45);
  });

  it("die Bis-Zeit verschiebt sich entsprechend nach vorn (keine erfundene Pause mehr in der Zeitspanne)", () => {
    const az = buildArbeitszeit(8.4); // Start 08:00 + 8.4h + 0 Min. Pause
    expect(az.bis).toBe("16:24");
  });

  it("bewusste, ehrliche Folge: ein per 'Stunden direkt' mit 5.8h erzeugter Eintrag LÖST jetzt pause_zu_kurz aus, solange niemand eine Pause nachträgt", () => {
    const az = buildArbeitszeit(5.8);
    const violations = pruefeCompliance(
      [{ date: "2026-08-10", typ: "arbeit", von: az.von, bis: az.bis, pauseMin: az.pauseMin }],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(true);
  });

  it("trägt die Person die vorgeschriebene Pause manuell ein, verschwindet die Warnung wieder", () => {
    const az = buildArbeitszeit(5.8, { pauseMin: mindestPauseMin(5.8) });
    const violations = pruefeCompliance(
      [{ date: "2026-08-10", typ: "arbeit", von: az.von, bis: az.bis, pauseMin: az.pauseMin }],
      []
    );
    expect(violations.some((v) => v.type === "pause_zu_kurz")).toBe(false);
  });
});
