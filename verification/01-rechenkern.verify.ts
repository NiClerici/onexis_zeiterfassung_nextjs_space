// Verifikation der Rechenkern-Funde aus REVIEW_LOOP.md durch Ausführung.
// Jeder Test behauptet das AKTUELLE (fehlerhafte) Verhalten und nennt im
// Namen, was korrekt wäre. Grün = Fehler reproduziert.
import { describe, it, expect } from "vitest";
import { pruefeCompliance } from "@/lib/compliance";
import { feriensaldo, stundenAusEintrag, kennzahlen, type Profil } from "@/lib/calc";
import { buildArbeitszeit } from "@/lib/arbeitszeit";
import { pruefeEintragKonflikte } from "@/lib/entry-overlap";

const profil = (o: Partial<Profil> = {}): Profil => ({
  pensum: 100, wochenstunden: 42, startDate: "2020-01-01", exitDate: null,
  ferientage: 25, maxWeeklyHours: 45, ...o,
});

describe("HOCH: Nachtarbeit vor 06:00", () => {
  it("BUG: Schicht 04:00-08:00 wird NICHT als Nachtarbeit gemeldet (korrekt wäre: gemeldet)", () => {
    const v = pruefeCompliance([{ date: "2026-08-11", typ: "arbeit", von: "04:00", bis: "08:00", pauseMin: 0 }], []);
    expect(v.some((x) => x.type === "nachtarbeit")).toBe(false);
  });
  it("Gegenprobe: Schicht 22:00-02:00 WIRD gemeldet (die getestete Hälfte funktioniert)", () => {
    const v = pruefeCompliance([{ date: "2026-08-11", typ: "arbeit", von: "22:00", bis: "02:00", pauseMin: 0 }], []);
    expect(v.some((x) => x.type === "nachtarbeit")).toBe(true);
  });
});

describe("HOCH: feriensaldo ignoriert exitDate", () => {
  it("BUG: Austritt 31.03.2026 ergibt vollen Jahresanspruch 25 (korrekt wäre ~6.25)", () => {
    const r = feriensaldo({ jahr: 2026, heute: "2026-08-30", profil: profil({ exitDate: "2026-03-31" }), changes: [], holidays: [], eintraege: [] });
    expect(r.anspruch).toBe(25);
  });
  it("Gegenprobe: Eintritt im selben Jahr WIRD anteilig gerechnet", () => {
    const r = feriensaldo({ jahr: 2026, heute: "2026-08-30", profil: profil({ startDate: "2026-03-01" }), changes: [], holidays: [], eintraege: [] });
    expect(r.anspruch).toBeLessThan(25);
  });
});

describe("HOCH/MITTEL: Mitternachts-Konvention widerspricht sich", () => {
  it("BUG: 08:00-08:00 ist in calc 0h, in compliance aber 24h", () => {
    const e = { date: "2026-08-11", typ: "arbeit" as const, von: "08:00", bis: "08:00", pauseMin: 0 };
    expect(stundenAusEintrag(e, 0)).toBe(0);
    const v = pruefeCompliance([e], []);
    const msg = v.find((x) => x.type === "tagesarbeitszeit_ueberschritten")?.message ?? "";
    expect(msg).toContain("24.0h");
  });
  it("BUG: 08:00-08:00 kollidiert in entry-overlap mit jedem anderen Eintrag des Tages", () => {
    const k = pruefeEintragKonflikte(
      { typ: "arbeit", von: "08:00", bis: "08:00", pauseMin: 0 },
      [{ id: "x", typ: "arbeit", von: "14:00", bis: "15:00", pauseMin: 0 }]
    );
    expect(k.some((x) => x.art === "ueberlappung")).toBe(true);
  });
});

describe("HOCH: buildArbeitszeit kürzt Stunden", () => {
  it("BUG: 16h ab 08:00 werden auf 23:59 geklemmt -> nur 14.98h zählbar", () => {
    const r = buildArbeitszeit(16);
    expect(r.bis).toBe("23:59");
    expect(r.geklemmt).toBe(true);
    const h = stundenAusEintrag({ typ: "arbeit", von: r.von, bis: r.bis, pauseMin: r.pauseMin }, 0);
    expect(Number(h.toFixed(2))).toBe(14.98);
  });
});

describe("HOCH: NaN passiert die Stunden-Validierung", () => {
  it("BUG: der Klemm-Ausdruck der Route macht aus 'acht' NaN statt einen Fehler", () => {
    const hours: any = "acht";
    const clamped = hours != null && hours !== "" ? Math.max(0, Math.min(24, Number(hours))) : null;
    expect(Number.isNaN(clamped)).toBe(true);
    expect(clamped != null).toBe(true); // -> passiert arbeitszeitIstGueltig
  });
  it("BUG: NaN-Stunden vergiften die Monatssumme", () => {
    const k = kennzahlen({
      from: "2026-08-01", to: "2026-08-31", heute: "2026-08-31",
      eintraege: [{ date: "2026-08-10", typ: "ferien", hours: NaN }],
      profil: profil(), changes: [], payouts: [], holidays: [], kundenstunden: 0,
    });
    expect(Number.isNaN(k.ist)).toBe(true);
  });
});

describe("MITTEL: zukünftige Auszahlung senkt heutige Überstunden", () => {
  it("BUG: Payout am 15.12. reduziert den Saldo per 30.08. um 20h", () => {
    const base = { from: "2026-01-01", to: "2026-12-31", heute: "2026-08-30", eintraege: [], profil: profil(), changes: [], holidays: [], kundenstunden: 0 };
    const ohne = kennzahlen({ ...base, payouts: [] });
    const mit = kennzahlen({ ...base, payouts: [{ date: "2026-12-15", hours: 20 }] });
    expect(Number((ohne.ueberstunden - mit.ueberstunden).toFixed(1))).toBe(20);
  });
});

describe("MITTEL: Analytics-Monatsschleife überspringt Februar", () => {
  it("BUG: Start am 31.01. -> setUTCMonth(+1) springt auf den 03.03.", () => {
    const cur = new Date(Date.UTC(2026, 0, 31));
    const monate: number[] = [];
    const end = new Date(Date.UTC(2026, 3, 30));
    while (cur <= end) { monate.push(cur.getUTCMonth() + 1); cur.setUTCMonth(cur.getUTCMonth() + 1); }
    expect(monate).toEqual([1, 3, 4]); // Februar fehlt
  });
});
