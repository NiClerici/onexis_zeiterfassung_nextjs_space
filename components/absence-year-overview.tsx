"use client";

// Jahresansicht des Team-Kalenders (Absenzen). Die Monatsansicht rendert
// eine Spalte pro Tag — bei 365 Tagen wäre das unlesbar, deshalb hier pro
// Mitarbeiter ein durchgehender Jahresstreifen: 12 Monatsblöcke, ein
// schmaler Strich pro Tag, in denselben Farben wie überall sonst
// (HARDENING.md C1). Links daneben die Ferienbilanz aus feriensaldo()
// (lib/calc.ts), damit "wann ist wer weg" und "wie viel Ferien hat wer
// noch" auf einer Zeile stehen.

import { useI18n } from "@/lib/i18n";

export interface YearOverviewMember {
  userId: string;
  name: string;
  days: Array<{ date: string; type: string | null }>;
}

export interface Feriensaldo {
  anspruch: number;
  bezogen: number;
  geplant: number;
  offen: number;
}

interface Props {
  members: YearOverviewMember[];
  feriensaldi: Record<string, Feriensaldo>;
  typeColor: Record<string, string>;
}

const MONTH_SHORT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const round1 = (n: number) => Math.round(n * 10) / 10;

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

// Wochenenden etwas blasser als leere Werktage — sonst liest sich ein
// ferienfreier Monat wie ein gleichmässiger Balken und man verliert die
// Wochenstruktur als Orientierung.
function isWeekend(date: string): boolean {
  const tag = new Date(`${date}T00:00:00Z`).getUTCDay();
  return tag === 0 || tag === 6;
}

export function AbsenceYearOverview({ members, feriensaldi, typeColor }: Props) {
  const { t } = useI18n();

  // Die Tage kommen als flache Jahresliste — hier einmal pro Mitarbeiter
  // nach Monat gruppiert, damit die Monatsblöcke proportional zu ihrer
  // Tageszahl wachsen können (flexGrow) statt fix breit zu sein.
  const byMonth = (days: YearOverviewMember["days"]) => {
    const months: YearOverviewMember["days"][] = Array.from({ length: 12 }, () => []);
    for (const d of days) {
      const monat = parseInt(d.date.slice(5, 7), 10) - 1;
      if (monat >= 0 && monat < 12) months[monat].push(d);
    }
    return months;
  };

  const saldoCell = (wert: number | undefined, betonen = false) => (
    <td className={`px-2 text-right tabular-nums whitespace-nowrap ${betonen ? "font-semibold" : "text-muted-foreground"}`}>
      {wert === undefined ? "–" : round1(wert)}
    </td>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[720px]">
        <thead>
          <tr className="text-muted-foreground border-b border-border/50">
            <th className="text-left font-medium py-1.5 pr-2 sticky left-0 bg-card">{t("teamsicht.colName")}</th>
            <th className="font-medium px-2 text-right whitespace-nowrap">{t("absences.colEntitlement")}</th>
            <th className="font-medium px-2 text-right whitespace-nowrap">{t("analytics.usedVacation")}</th>
            <th className="font-medium px-2 text-right whitespace-nowrap">{t("analytics.plannedVacation")}</th>
            <th className="font-medium px-2 text-right whitespace-nowrap">{t("absences.colRemaining")}</th>
            <th className="pl-3 w-full">
              <div className="flex gap-1.5">
                {MONTH_SHORT.map((m, i) => (
                  <div key={i} style={{ flexGrow: 1, flexBasis: 0 }} className="text-center font-medium">
                    {m}
                  </div>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const fs = feriensaldi[member.userId];
            const monate = byMonth(member.days);
            return (
              <tr key={member.userId} className="border-b border-border/30 last:border-0">
                <td className="text-left py-1.5 pr-2 font-medium whitespace-nowrap sticky left-0 bg-card">{member.name}</td>
                {saldoCell(fs?.anspruch)}
                {saldoCell(fs?.bezogen)}
                {saldoCell(fs?.geplant)}
                {saldoCell(fs?.offen, true)}
                <td className="pl-3 py-1.5">
                  <div className="flex gap-1.5 items-center">
                    {monate.map((tage, i) => (
                      <div key={i} style={{ flexGrow: 1, flexBasis: 0 }} className="flex gap-px">
                        {tage.map((d) => (
                          <div
                            key={d.date}
                            className={`h-5 rounded-[1px] ${
                              d.type
                                ? typeColor[d.type] ?? "bg-gray-300"
                                : isWeekend(d.date)
                                  ? "bg-secondary/30"
                                  : "bg-secondary/70"
                            }`}
                            style={{ flexGrow: 1, flexBasis: 0, minWidth: "1px" }}
                            // Farbe ist nie alleiniger Informationsträger
                            // (HARDENING.md C6) — jeder Absenztag trägt
                            // zusätzlich Datum und Typ im Tooltip.
                            title={d.type ? `${member.name}, ${fmtDate(d.date)}: ${t(`calendar.type.${d.type}`)}` : undefined}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
