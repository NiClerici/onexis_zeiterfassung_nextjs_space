import { describe, expect, it } from "vitest";
import { groupAbsenceRanges, type AbsenceEntry } from "./absence-ranges";

function e(userId: string, name: string, date: string, type = "ferien"): AbsenceEntry {
  return { userId, name, date, type };
}

describe("groupAbsenceRanges (HARDENING.md C7b)", () => {
  it("fasst eine ununterbrochene Folge von Werktagen zu einem Bereich zusammen", () => {
    // Mo–Fr, 13.–17.07.2026, eine Ferienwoche ohne Wochenende dazwischen.
    const entries = [
      e("u1", "Stefan Büttler", "2026-07-13"),
      e("u1", "Stefan Büttler", "2026-07-14"),
      e("u1", "Stefan Büttler", "2026-07-15"),
      e("u1", "Stefan Büttler", "2026-07-16"),
      e("u1", "Stefan Büttler", "2026-07-17"),
    ];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ userId: "u1", name: "Stefan Büttler", type: "ferien", from: "2026-07-13", to: "2026-07-17", days: 5 });
  });

  it("überbrückt ein Wochenende, wenn die Absenz beidseitig weitergeht", () => {
    // Fr 2026-07-10 und Mo 2026-07-13 — Sa/So dazwischen sind erwartungsgemäss
    // keine eigenen Einträge, brechen den Bereich aber nicht auf.
    const entries = [e("u1", "A", "2026-07-06"), e("u1", "A", "2026-07-07"), e("u1", "A", "2026-07-08"), e("u1", "A", "2026-07-09"), e("u1", "A", "2026-07-10"), e("u1", "A", "2026-07-13")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe("2026-07-06");
    expect(ranges[0].to).toBe("2026-07-13");
    expect(ranges[0].days).toBe(6);
  });

  it("überbrückt einen Feiertag mitten in der Woche, wenn er als solcher übergeben wird", () => {
    // Do 2026-08-13 ist ein normaler Werktag, aber hier als Feiertag markiert.
    const entries = [e("u1", "A", "2026-08-11"), e("u1", "A", "2026-08-12"), e("u1", "A", "2026-08-14")];
    const holidays = new Set(["2026-08-13"]);
    const ranges = groupAbsenceRanges(entries, holidays);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe("2026-08-11");
    expect(ranges[0].to).toBe("2026-08-14");
    expect(ranges[0].days).toBe(3);
  });

  it("bricht den Bereich auf, wenn die Lücke einen echten Werktag ohne Absenz enthält", () => {
    // 11.08. und 13.08., aber 12.08. ist ein normaler Werktag OHNE Eintrag
    // und OHNE Feiertagsmarkierung — die Person war an diesem Tag da.
    const entries = [e("u1", "A", "2026-08-11"), e("u1", "A", "2026-08-13")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: "2026-08-11", to: "2026-08-11", days: 1 });
    expect(ranges[1]).toMatchObject({ from: "2026-08-13", to: "2026-08-13", days: 1 });
  });

  it("trennt Bereiche nach Absenztyp, auch wenn die Tage direkt aufeinanderfolgen", () => {
    // Krank Mo/Di, dann Ferien Mi/Do — unterschiedlicher Typ, kein
    // gemeinsamer Bereich, selbst ohne jede Lücke.
    const entries = [e("u1", "A", "2026-08-10", "krank"), e("u1", "A", "2026-08-11", "krank"), e("u1", "A", "2026-08-12", "ferien"), e("u1", "A", "2026-08-13", "ferien")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(2);
    expect(ranges.find((r) => r.type === "krank")).toMatchObject({ from: "2026-08-10", to: "2026-08-11", days: 2 });
    expect(ranges.find((r) => r.type === "ferien")).toMatchObject({ from: "2026-08-12", to: "2026-08-13", days: 2 });
  });

  it("trennt Bereiche nach Person, auch bei identischem Typ und Datum", () => {
    const entries = [e("u1", "A", "2026-08-10"), e("u2", "B", "2026-08-10"), e("u1", "A", "2026-08-11"), e("u2", "B", "2026-08-11")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(2);
    expect(ranges.find((r) => r.userId === "u1")).toMatchObject({ from: "2026-08-10", to: "2026-08-11", days: 2 });
    expect(ranges.find((r) => r.userId === "u2")).toMatchObject({ from: "2026-08-10", to: "2026-08-11", days: 2 });
  });

  it("ignoriert die Eingabereihenfolge — sortiert intern selbst", () => {
    const entries = [e("u1", "A", "2026-08-14"), e("u1", "A", "2026-08-10"), e("u1", "A", "2026-08-13"), e("u1", "A", "2026-08-11"), e("u1", "A", "2026-08-12")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ from: "2026-08-10", to: "2026-08-14", days: 5 });
  });

  it("behandelt einen doppelt übergebenen Tag als einen einzigen Eintrag", () => {
    const entries = [e("u1", "A", "2026-08-10"), e("u1", "A", "2026-08-10"), e("u1", "A", "2026-08-11")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(2);
  });

  it("liefert eine leere Liste ohne Einträge", () => {
    expect(groupAbsenceRanges([])).toEqual([]);
  });

  it("liefert einen Einzeltag-Bereich für einen einzelnen Eintrag", () => {
    const ranges = groupAbsenceRanges([e("u1", "A", "2026-08-10")]);
    expect(ranges).toEqual([{ userId: "u1", name: "A", type: "ferien", from: "2026-08-10", to: "2026-08-10", days: 1 }]);
  });

  it("sortiert die Ausgabe nach Startdatum", () => {
    const entries = [e("u1", "A", "2026-08-20"), e("u2", "B", "2026-08-10")];
    const ranges = groupAbsenceRanges(entries);
    expect(ranges.map((r) => r.userId)).toEqual(["u2", "u1"]);
  });
});
