import { describe, expect, it } from "vitest";
import { verschiebeFolgezeilen, type ShiftRow } from "./day-shift";

function row(key: string, von: string, bis: string, opts: Partial<ShiftRow> = {}): ShiftRow {
  return { key, typ: "arbeit", von, bis, hoursMode: false, ...opts };
}

describe("verschiebeFolgezeilen", () => {
  it("verschiebt Von und Bis aller Folgezeilen um dieselbe Differenz", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "10:00", "13:00"), row("c", "13:00", "17:00")];
    // Zeile "a" wird von 10:00 auf 11:00 Bis-Zeit geändert → Differenz +60min
    const { rows: result, geklemmt } = verschiebeFolgezeilen(rows, "a", 60);
    expect(result[0]).toEqual(rows[0]); // unverändert
    expect(result[1]).toMatchObject({ von: "11:00", bis: "14:00" });
    expect(result[2]).toMatchObject({ von: "14:00", bis: "18:00" });
    expect(geklemmt).toBe(false);
  });

  it("lässt Zeilen vor der geänderten Zeile unangetastet", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "10:00", "13:00")];
    const { rows: result } = verschiebeFolgezeilen(rows, "b", 30);
    expect(result[0]).toEqual(rows[0]);
  });

  it("verschiebt im Stunden-Modus nur Von, nicht Bis (Bis leitet sich aus der Stundenzahl ab)", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "10:00", "14:00", { hoursMode: true })];
    const { rows: result } = verschiebeFolgezeilen(rows, "a", 60);
    expect(result[1].von).toBe("11:00");
    expect(result[1].bis).toBe("14:00"); // unverändert
  });

  it("lässt Absenzzeilen (typ !== 'arbeit') unangetastet", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "00:00", "00:00", { typ: "ferien" })];
    const { rows: result } = verschiebeFolgezeilen(rows, "a", 60);
    expect(result[1]).toEqual(rows[1]);
  });

  it("gibt bei deltaMin === 0 dieselbe Referenz zurück", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "10:00", "13:00")];
    const { rows: result, geklemmt } = verschiebeFolgezeilen(rows, "a", 0);
    expect(result).toBe(rows);
    expect(geklemmt).toBe(false);
  });

  it("kappt bei 23:59 und meldet geklemmt", () => {
    const rows = [row("a", "08:00", "10:00"), row("b", "23:00", "23:30")];
    const { rows: result, geklemmt } = verschiebeFolgezeilen(rows, "a", 120);
    expect(result[1].von).toBe("23:59");
    expect(result[1].bis).toBe("23:59");
    expect(geklemmt).toBe(true);
  });

  it("unterstützt auch negative Verschiebung (Bis-Zeit wird früher)", () => {
    const rows = [row("a", "08:00", "09:00"), row("b", "10:00", "13:00")];
    const { rows: result } = verschiebeFolgezeilen(rows, "a", -30);
    expect(result[1]).toMatchObject({ von: "09:30", bis: "12:30" });
  });

  it("bricht bei unbekanntem geaenderterKey unverändert ab", () => {
    const rows = [row("a", "08:00", "10:00")];
    const { rows: result } = verschiebeFolgezeilen(rows, "unbekannt", 60);
    expect(result).toBe(rows);
  });
});
