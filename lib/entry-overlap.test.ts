// Test für den gemeldeten Bug "man kann zweimal am gleichen Tag die gleiche
// Zeit hinzufügen" — siehe lib/entry-overlap.ts für den vollen Kontext.

import { describe, expect, it } from "vitest";
import { pruefeEintragKonflikte } from "./entry-overlap";

describe("pruefeEintragKonflikte — Duplikate", () => {
  it("erkennt ein exaktes Duplikat (gleiche Von/Bis/Pause)", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "17:00", pauseMin: 60 },
      [{ typ: "arbeit", von: "08:00", bis: "17:00", pauseMin: 60 }]
    );
    expect(konflikte.map((k) => k.art)).toContain("duplikat");
  });

  it("unterschiedliche Pause bei gleichen Zeiten ist KEIN Duplikat", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "17:00", pauseMin: 60 },
      [{ typ: "arbeit", von: "08:00", bis: "17:00", pauseMin: 30 }]
    );
    expect(konflikte.some((k) => k.art === "duplikat")).toBe(false);
    // aber sie überlappen weiterhin
    expect(konflikte.some((k) => k.art === "ueberlappung")).toBe(true);
  });

  it("die eigene Zeile (gleiche id) wird nicht gegen sich selbst geprüft, weil der Aufrufer sie vorher ausschliesst", () => {
    const eigen = { id: "row-1", typ: "arbeit" as const, von: "08:00", bis: "17:00", pauseMin: 60 };
    // andereDesTages enthält die eigene Zeile NICHT (so ruft die Route es auf)
    const konflikte = pruefeEintragKonflikte(eigen, []);
    expect(konflikte).toHaveLength(0);
  });
});

describe("pruefeEintragKonflikte — Überlappung (nur Warnung, kein Duplikat)", () => {
  it("teilweise überlappende Arbeitszeit wird als Überlappung gemeldet", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "12:00" },
      [{ typ: "arbeit", von: "11:00", bis: "15:00" }]
    );
    expect(konflikte.map((k) => k.art)).toEqual(["ueberlappung"]);
  });

  it("direkt aneinandergrenzende Zeiten (12:00-12:00) überlappen nicht", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "12:00" },
      [{ typ: "arbeit", von: "12:00", bis: "17:00" }]
    );
    expect(konflikte).toHaveLength(0);
  });

  it("eine Schicht über Mitternacht (22:00-02:00) überlappt NICHT mit 01:00-05:00 desselben Kalendertags (das 02:00-Ende liegt bereits am Folgetag)", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "22:00", bis: "02:00" },
      [{ typ: "arbeit", von: "01:00", bis: "05:00" }]
    );
    expect(konflikte).toHaveLength(0);
  });

  it("zwei Schichten über Mitternacht überlappen korrekt, wenn sich ihre Nachtanteile schneiden (22:00-03:00 / 23:00-04:00)", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "22:00", bis: "03:00" },
      [{ typ: "arbeit", von: "23:00", bis: "04:00" }]
    );
    expect(konflikte.map((k) => k.art)).toEqual(["ueberlappung"]);
  });
});

describe("pruefeEintragKonflikte — doppelte Absenzen", () => {
  it("zwei 'ferien'-Zeilen am selben Tag werden erkannt (sonst zählt feriensaldo() zwei Tage)", () => {
    const konflikte = pruefeEintragKonflikte({ typ: "ferien", hours: 8 }, [{ typ: "ferien", hours: 8 }]);
    expect(konflikte.map((k) => k.art)).toEqual(["absenz_doppelt"]);
  });

  it("Absenz neben Arbeitszeit desselben Tages wird gemeldet", () => {
    const konflikte = pruefeEintragKonflikte({ typ: "krank", hours: 8 }, [
      { typ: "arbeit", von: "08:00", bis: "12:00" },
    ]);
    expect(konflikte.map((k) => k.art)).toEqual(["absenz_doppelt"]);
  });

  it("Arbeitszeit neben bestehender Absenz wird ebenfalls gemeldet (umgekehrte Richtung)", () => {
    const konflikte = pruefeEintragKonflikte({ typ: "arbeit", von: "08:00", bis: "12:00" }, [
      { typ: "ferien", hours: 8 },
    ]);
    expect(konflikte.map((k) => k.art)).toEqual(["absenz_doppelt"]);
  });
});

describe("pruefeEintragKonflikte — countsAsWorktime:false wird ignoriert", () => {
  it("migrierte Zuordnung (countsAsWorktime:false) als Kandidat liefert nie einen Konflikt", () => {
    const konflikte = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "17:00", countsAsWorktime: false },
      [{ typ: "arbeit", von: "08:00", bis: "17:00" }]
    );
    expect(konflikte).toHaveLength(0);
  });

  it("migrierte Zuordnung als andere Zeile wird beim Vergleich übersprungen", () => {
    const konflikte = pruefeEintragKonflikte({ typ: "arbeit", von: "08:00", bis: "17:00" }, [
      { typ: "arbeit", von: "08:00", bis: "17:00", countsAsWorktime: false },
    ]);
    expect(konflikte).toHaveLength(0);
  });
});
