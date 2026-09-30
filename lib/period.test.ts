import { describe, expect, it } from "vitest";
import { defaultPeriod, periodQuery, periodRange, shiftPeriod, isoDate } from "@/lib/period";

describe("defaultPeriod", () => {
  it("liefert type=month für den aktuellen Monat", () => {
    const p = defaultPeriod(new Date("2026-09-15T10:00:00Z"));
    expect(p.type).toBe("month");
    expect(p.month).toBe("2026-09");
    expect(p.year).toBe(2026);
  });
});

describe("periodRange", () => {
  it("week: Montag bis Sonntag derselben Woche", () => {
    const { startDate, endDate } = periodRange({ ...defaultPeriod(), type: "week", week: "2026-09-14" });
    expect(isoDate(startDate)).toBe("2026-09-14");
    expect(isoDate(endDate)).toBe("2026-09-20");
  });

  it("month: erster bis letzter Tag des Monats", () => {
    const { startDate, endDate } = periodRange({ ...defaultPeriod(), type: "month", month: "2026-02" });
    expect(isoDate(startDate)).toBe("2026-02-01");
    expect(isoDate(endDate)).toBe("2026-02-28");
  });

  it("quarter: Q3 2026 = Juli bis September", () => {
    const { startDate, endDate } = periodRange({ ...defaultPeriod(), type: "quarter", quarterYear: 2026, quarter: 3 });
    expect(isoDate(startDate)).toBe("2026-07-01");
    expect(isoDate(endDate)).toBe("2026-09-30");
  });

  it("year: 1.1. bis 31.12.", () => {
    const { startDate, endDate } = periodRange({ ...defaultPeriod(), type: "year", year: 2026 });
    expect(isoDate(startDate)).toBe("2026-01-01");
    expect(isoDate(endDate)).toBe("2026-12-31");
  });

  it("custom: from/to unverändert", () => {
    const { startDate, endDate } = periodRange({ ...defaultPeriod(), type: "custom", from: "2026-03-10", to: "2026-03-20" });
    expect(isoDate(startDate)).toBe("2026-03-10");
    expect(isoDate(endDate)).toBe("2026-03-20");
  });
});

describe("periodQuery", () => {
  it("month → type=month&year=&month=", () => {
    expect(periodQuery({ ...defaultPeriod(), type: "month", month: "2026-04" })).toBe("type=month&year=2026&month=04");
  });

  it("year → type=year&year=", () => {
    expect(periodQuery({ ...defaultPeriod(), type: "year", year: 2026 })).toBe("type=year&year=2026");
  });

  it("week → aufgelöst zu type=custom&from=&to=", () => {
    expect(periodQuery({ ...defaultPeriod(), type: "week", week: "2026-09-14" })).toBe("type=custom&from=2026-09-14&to=2026-09-20");
  });

  it("quarter → aufgelöst zu type=custom&from=&to=", () => {
    expect(periodQuery({ ...defaultPeriod(), type: "quarter", quarterYear: 2026, quarter: 1 })).toBe("type=custom&from=2026-01-01&to=2026-03-31");
  });
});

describe("shiftPeriod", () => {
  it("month: Dezember + 1 wechselt ins nächste Jahr", () => {
    const next = shiftPeriod({ ...defaultPeriod(), type: "month", month: "2026-12" }, 1);
    expect(next.month).toBe("2027-01");
  });

  it("month: Januar - 1 wechselt ins Vorjahr", () => {
    const prev = shiftPeriod({ ...defaultPeriod(), type: "month", month: "2026-01" }, -1);
    expect(prev.month).toBe("2025-12");
  });

  it("quarter: Q4 + 1 wechselt zu Q1 des Folgejahrs", () => {
    const next = shiftPeriod({ ...defaultPeriod(), type: "quarter", quarterYear: 2026, quarter: 4 }, 1);
    expect(next.quarter).toBe(1);
    expect(next.quarterYear).toBe(2027);
  });

  it("quarter: Q1 - 1 wechselt zu Q4 des Vorjahrs", () => {
    const prev = shiftPeriod({ ...defaultPeriod(), type: "quarter", quarterYear: 2026, quarter: 1 }, -1);
    expect(prev.quarter).toBe(4);
    expect(prev.quarterYear).toBe(2025);
  });

  it("week: +1 addiert 7 Tage", () => {
    const next = shiftPeriod({ ...defaultPeriod(), type: "week", week: "2026-09-14" }, 1);
    expect(next.week).toBe("2026-09-21");
  });

  it("year: +1/-1", () => {
    expect(shiftPeriod({ ...defaultPeriod(), type: "year", year: 2026 }, 1).year).toBe(2027);
    expect(shiftPeriod({ ...defaultPeriod(), type: "year", year: 2026 }, -1).year).toBe(2025);
  });

  it("custom bleibt unverändert", () => {
    const p = { ...defaultPeriod(), type: "custom" as const, from: "2026-01-01", to: "2026-01-10" };
    expect(shiftPeriod(p, 1)).toEqual(p);
  });
});
