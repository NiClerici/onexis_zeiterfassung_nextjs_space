// Direkte Tests der reinen Berechnung (extrahiert aus app/api/analytics/
// route.ts) — der Rundweg über die Route ist bereits in
// lib/analytics-route.test.ts abgedeckt (overtimeSeries-Tests), hier geht es
// um die Funktionen isoliert, insbesondere für den neuen Aufrufer
// app/api/team/route.ts.

import { describe, expect, it } from "vitest";
import { kumulierterSaldo, saldoSerie } from "@/lib/saldo";
import type { Profil } from "@/lib/calc";

const profil: Profil = {
  pensum: 100,
  wochenstunden: 40,
  startDate: "2026-01-01",
  exitDate: null,
  ferientage: 25,
  maxWeeklyHours: 45,
};

describe("kumulierterSaldo", () => {
  it("Sonntag (kein Tagessoll) ohne Einträge ergibt Saldo 0", () => {
    // 04.01.2026 ist ein Sonntag — Tagessoll 0, damit since==to==heute keine
    // Wochentagsrechnung ins Spiel bringt.
    const r = kumulierterSaldo({
      profil, changes: [], holidays: [], heute: "2026-01-04",
      since: "2026-01-04", to: "2026-01-04", eintraege: [], payouts: [],
    });
    expect(r.netOvertime).toBe(0);
    expect(r.since).toBe("2026-01-04");
  });

  it("8h Arbeit an einem Tag mit 8h Soll ergibt Saldo 0, mit 10h ergibt +2", () => {
    // 05.01.2026 ist ein Montag, since==to schliesst nur diesen einen Tag ein.
    const r = kumulierterSaldo({
      profil, changes: [], holidays: [], heute: "2026-01-05",
      since: "2026-01-05", to: "2026-01-05",
      eintraege: [{ date: "2026-01-05", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 }],
      payouts: [],
    });
    // Tagessoll = 40/5 = 8h, Ist = 10h → Saldo +2
    expect(r.netOvertime).toBe(2);
    expect(r.actualHours).toBe(10);
  });

  it("Auszahlungen reduzieren den Nettosaldo", () => {
    const r = kumulierterSaldo({
      profil, changes: [], holidays: [], heute: "2026-01-05",
      since: "2026-01-05", to: "2026-01-05",
      eintraege: [{ date: "2026-01-05", typ: "arbeit", von: "08:00", bis: "18:00", pauseMin: 0 }],
      payouts: [{ date: "2026-01-05", hours: 1.5 }],
    });
    expect(r.netOvertime).toBe(0.5);
    expect(r.paidOutHours).toBe(1.5);
  });

  it("asOf ist auf heute gedeckelt, wenn `to` in der Zukunft liegt", () => {
    const r = kumulierterSaldo({
      profil, changes: [], holidays: [], heute: "2026-01-05",
      since: "2026-01-01", to: "2026-01-31", eintraege: [], payouts: [],
    });
    expect(r.asOf).toBe("2026-01-05");
  });
});

describe("saldoSerie", () => {
  it("ohne Historie startet der Vortagspunkt bei 0", () => {
    const series = saldoSerie({
      profil, changes: [], holidays: [], heute: "2026-01-10",
      seriesStart: "2026-01-01", periodStart: "2026-01-01", endDate: "2026-01-10", seriesLast: "2026-01-10",
      hasHistory: false, granularity: "day", eintraege: [], payouts: [],
    });
    expect(series[0].balance).toBe(0);
    expect(series[0].date).toBe("2025-12-31");
  });

  it("der letzte Punkt entspricht kumulierterSaldo().netOvertime für denselben Zeitraum", () => {
    const eintraege = [{ date: "2026-01-05", typ: "arbeit" as const, von: "08:00", bis: "18:00", pauseMin: 0 }];
    const cumulative = kumulierterSaldo({
      profil, changes: [], holidays: [], heute: "2026-01-10",
      since: "2026-01-01", to: "2026-01-10", eintraege, payouts: [],
    });
    const series = saldoSerie({
      profil, changes: [], holidays: [], heute: "2026-01-10",
      seriesStart: "2026-01-01", periodStart: "2026-01-01", endDate: "2026-01-10", seriesLast: "2026-01-10",
      hasHistory: false, granularity: "day", eintraege, payouts: [],
    });
    expect(series.at(-1)!.balance).toBe(cumulative.netOvertime);
  });

  it("Zeitraum komplett in der Zukunft liefert eine leere Serie", () => {
    const series = saldoSerie({
      profil, changes: [], holidays: [], heute: "2026-01-01",
      seriesStart: "2026-01-01", periodStart: "2026-03-01", endDate: "2026-03-31", seriesLast: "2026-01-01",
      hasHistory: false, granularity: "day", eintraege: [], payouts: [],
    });
    expect(series).toEqual([]);
  });
});
