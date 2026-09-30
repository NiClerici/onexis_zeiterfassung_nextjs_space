"use client";

// Gemeinsamer Zeitraum-Picker für den Team-Hub (Woche/Monat/Quartal/Jahr/
// Custom, lib/period.ts) — ersetzt die drei bisher unabhängigen Picker in
// Teamsicht, Analytics und Absenzen mit unterschiedlichen Optionen.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { type PeriodValue, type PeriodType, shiftPeriod, isoDate } from "@/lib/period";

const TYPES: PeriodType[] = ["week", "month", "quarter", "year", "custom"];

const FELD_CLASSES = "px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return isoDate(d);
}

export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const { t } = useI18n();
  const label: Record<PeriodType, string> = {
    week: t("period.week"),
    month: t("profile.exportMonth"),
    quarter: t("period.quarter"),
    year: t("profile.exportYear"),
    custom: t("profile.exportCustom"),
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        {TYPES.map((tp) => (
          <button
            key={tp}
            onClick={() => onChange({ ...value, type: tp })}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${value.type === tp ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}
          >
            {label[tp]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {value.type !== "custom" && (
          <button onClick={() => onChange(shiftPeriod(value, -1))} aria-label={t("period.prev")} className="p-1.5 rounded-lg bg-secondary hover:bg-accent transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        {value.type === "week" && (
          <input
            type="date"
            aria-label={t("period.week")}
            value={value.week}
            onChange={(e) => e.target.value && onChange({ ...value, week: mondayOf(e.target.value) })}
            className={FELD_CLASSES}
          />
        )}
        {value.type === "month" && <MonthYearPicker value={value.month} onChange={(month) => onChange({ ...value, month })} />}
        {value.type === "quarter" && (
          <div className="flex gap-2">
            <select
              aria-label={t("period.quarter")}
              value={value.quarter}
              onChange={(e) => onChange({ ...value, quarter: parseInt(e.target.value, 10) })}
              className={FELD_CLASSES}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </select>
            <input
              type="number"
              aria-label={t("profile.exportYear")}
              min={2020}
              max={2035}
              value={value.quarterYear}
              onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) onChange({ ...value, quarterYear: n }); }}
              className={`${FELD_CLASSES} w-24`}
            />
          </div>
        )}
        {value.type === "year" && (
          <input
            type="number"
            aria-label={t("profile.exportYear")}
            min={2020}
            max={2035}
            value={value.year}
            onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) onChange({ ...value, year: n }); }}
            className={`${FELD_CLASSES} w-24`}
          />
        )}
        {value.type === "custom" && (
          <>
            <input type="date" aria-label={t("absences.from")} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={FELD_CLASSES} />
            <input type="date" aria-label={t("absences.to")} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={FELD_CLASSES} />
          </>
        )}

        {value.type !== "custom" && (
          <button onClick={() => onChange(shiftPeriod(value, 1))} aria-label={t("period.next")} className="p-1.5 rounded-lg bg-secondary hover:bg-accent transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
