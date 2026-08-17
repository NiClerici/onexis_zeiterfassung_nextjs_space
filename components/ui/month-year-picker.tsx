"use client";

// Monat/Jahr-Auswahl als zwei eigene Felder statt <input type="month">
// (HARDENING.md C7f). Ein natives type="month"-Feld zeigt den Monatsnamen
// in der Sprache des BROWSERS, nicht der App — in einer durchgehend
// deutschen Oberfläche kann das je nach Browser-/Systemsprache der
// Nutzerin "October 2026" statt "Oktober 2026" anzeigen. Diese Komponente
// verwendet stattdessen die bereits vorhandenen month.1..month.12-Strings
// aus lib/i18n.tsx, die App bleibt damit unabhängig von der
// Browsersprache konsistent deutsch. Ersetzt vier bisher native Felder
// (Absenzen-Team-Kalender, Teamsicht, Analytics, Profil-Export) und den
// bisherigen Lohnexport-Sonderfall, der dieses Muster bereits einzeln
// verwendet hatte.

import { useI18n } from "@/lib/i18n";

export interface MonthYearPickerProps {
  // "YYYY-MM", wie das bisherige <input type="month"> es lieferte — damit
  // bleibt der aufrufende State (calMonth/selectedMonth/exportMonth) beim
  // Umstieg unverändert.
  value: string;
  onChange: (value: string) => void;
  className?: string;
  selectClassName?: string;
  yearInputClassName?: string;
  monthLabel?: string;
  yearLabel?: string;
  minYear?: number;
  maxYear?: number;
}

const DEFAULT_FELD_CLASSES =
  "px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export function MonthYearPicker({
  value,
  onChange,
  className,
  selectClassName,
  yearInputClassName,
  monthLabel = "Monat",
  yearLabel = "Jahr",
  minYear = 2020,
  maxYear = 2035,
}: MonthYearPickerProps) {
  const { t } = useI18n();
  const [jahrStr, monatStr] = (value ?? "").split("-");
  const jahr = parseInt(jahrStr, 10) || new Date().getFullYear();
  const monat = parseInt(monatStr, 10) || new Date().getMonth() + 1;

  function setMonat(neuerMonat: number) {
    onChange(`${jahr}-${String(neuerMonat).padStart(2, "0")}`);
  }
  function setJahr(neuesJahr: number) {
    onChange(`${neuesJahr}-${String(monat).padStart(2, "0")}`);
  }

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <select
        aria-label={monthLabel}
        value={monat}
        onChange={(e) => setMonat(parseInt(e.target.value, 10))}
        className={selectClassName ?? DEFAULT_FELD_CLASSES}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
          <option key={mo} value={mo}>
            {t(`month.${mo}`)}
          </option>
        ))}
      </select>
      <input
        type="number"
        aria-label={yearLabel}
        min={minYear}
        max={maxYear}
        value={jahr}
        onChange={(e) => {
          const parsed = parseInt(e?.target?.value ?? "", 10);
          if (Number.isFinite(parsed)) setJahr(parsed);
        }}
        className={`${yearInputClassName ?? DEFAULT_FELD_CLASSES} w-24`}
      />
    </div>
  );
}
