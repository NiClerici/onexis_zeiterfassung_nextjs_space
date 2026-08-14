import { describe, expect, it } from "vitest";
import { easterSunday, swissBasisFeiertage, kantonaleFeiertage, generateHolidaysForYear } from "./holidays";

describe("easterSunday", () => {
  // Referenzwerte gegengeprüft mit dem Standard-Gauss-Algorithmus (unabhängige
  // Implementierung), nicht nur mit dem eigenen Code — sonst testet man nur
  // sich selbst.
  it("berechnet bekannte Ostersonntage korrekt", () => {
    expect(easterSunday(2024)).toEqual(new Date(Date.UTC(2024, 2, 31)));
    expect(easterSunday(2025)).toEqual(new Date(Date.UTC(2025, 3, 20)));
    expect(easterSunday(2026)).toEqual(new Date(Date.UTC(2026, 3, 5)));
    expect(easterSunday(2027)).toEqual(new Date(Date.UTC(2027, 2, 28)));
    expect(easterSunday(2028)).toEqual(new Date(Date.UTC(2028, 3, 16)));
  });
});

describe("swissBasisFeiertage", () => {
  const feiertage2026 = swissBasisFeiertage(2026);

  it("enthält Karfreitag (beweglich, 2 Tage vor Ostern) am korrekten Datum 2026", () => {
    const karfreitag = feiertage2026.find((f) => f.name === "Karfreitag");
    expect(karfreitag?.date).toBe("2026-04-03");
    expect(karfreitag?.canton).toBeNull();
    expect(karfreitag?.halfDay).toBe(false);
  });

  it("enthält Ostermontag (beweglich, 1 Tag nach Ostern) am korrekten Datum 2026", () => {
    const ostermontag = feiertage2026.find((f) => f.name === "Ostermontag");
    expect(ostermontag?.date).toBe("2026-04-06");
  });

  it("enthält Auffahrt (39 Tage nach Ostern) und Pfingstmontag (50 Tage nach Ostern)", () => {
    expect(feiertage2026.find((f) => f.name === "Auffahrt")?.date).toBe("2026-05-14");
    expect(feiertage2026.find((f) => f.name === "Pfingstmontag")?.date).toBe("2026-05-25");
  });

  it("enthält die festen Basissatz-Daten (Neujahr, Bundesfeier, Weihnachten, Stephanstag)", () => {
    expect(feiertage2026.find((f) => f.name === "Neujahr")?.date).toBe("2026-01-01");
    expect(feiertage2026.find((f) => f.name === "Bundesfeier")?.date).toBe("2026-08-01");
    expect(feiertage2026.find((f) => f.name === "Weihnachten")?.date).toBe("2026-12-25");
    expect(feiertage2026.find((f) => f.name === "Stephanstag")?.date).toBe("2026-12-26");
  });

  it("liefert genau 8 Basissatz-Feiertage, alle mit canton: null", () => {
    expect(feiertage2026).toHaveLength(8);
    expect(feiertage2026.every((f) => f.canton === null)).toBe(true);
  });
});

describe("kantonaleFeiertage", () => {
  it("liefert den Kantonsfeiertag Jura am 23. Juni, mit korrektem canton-Feld", () => {
    const ju = kantonaleFeiertage(2026, "JU");
    expect(ju).toHaveLength(1);
    expect(ju[0]).toEqual({ date: "2026-06-23", name: "Kantonsfeiertag Jura", canton: "JU", halfDay: false });
  });

  it("liefert Berchtoldstag für ZH am 2. Januar", () => {
    const zh = kantonaleFeiertage(2026, "ZH");
    expect(zh.find((f) => f.name === "Berchtoldstag")?.date).toBe("2026-01-02");
  });

  it("liefert Fronleichnam (beweglich, 60 Tage nach Ostern) für LU", () => {
    const lu = kantonaleFeiertage(2026, "LU");
    expect(lu.find((f) => f.name === "Fronleichnam")?.date).toBe("2026-06-04");
  });

  it("liefert eine leere Liste für einen nicht hinterlegten Kanton", () => {
    expect(kantonaleFeiertage(2026, "GE")).toEqual([]);
  });
});

describe("generateHolidaysForYear", () => {
  it("liefert ohne Kanton nur den Basissatz", () => {
    expect(generateHolidaysForYear(2026)).toEqual(swissBasisFeiertage(2026));
  });

  it("liefert mit Kanton Basissatz plus kantonale Feiertage", () => {
    const result = generateHolidaysForYear(2026, "JU");
    expect(result).toHaveLength(9); // 8 Basissatz + 1 Kantonsfeiertag Jura
    expect(result.some((f) => f.name === "Kantonsfeiertag Jura")).toBe(true);
  });
});
