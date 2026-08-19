"use client";

// Ersetzt components/customer-month-card.tsx (Nachtrag 19.08.2026 —
// Projektstunden werden wieder pro Tag am TimeEntry erfasst statt einmal
// pro Monat, siehe prisma/schema.prisma:TimeEntry.projectId und der
// Projekt-Select im Tagesdialog). Diese Karte ist rein darstellend: sie
// bekommt die für den Monat schon geladenen Einträge fertig aufsummiert vom
// Kalender übergeben (app/(app)/calendar/page.tsx) und lädt selbst nichts —
// anders als die alte Karte, die eine eigene, editierbare Kopie der
// CustomerMonth-Zeilen hielt.

import { useI18n } from "@/lib/i18n";

export interface ProjectSummaryRow {
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  hours: number;
}

interface ProjectMonthSummaryProps {
  rows: ProjectSummaryRow[];
  unassignedHours: number;
  totalHours: number;
  onExportCustomer?: (customerId: string, customerName: string) => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ProjectMonthSummary({ rows, unassignedHours, totalHours, onExportCustomer }: ProjectMonthSummaryProps) {
  const { t } = useI18n();

  if (rows.length === 0 && unassignedHours <= 0) return null;

  // Nach Kunde gruppieren, innerhalb nach Projekt — für den Export-Knopf
  // (ein Rapport pro Kunde) und für eine übersichtlichere Darstellung bei
  // mehreren Kunden im selben Monat.
  const byCustomer = new Map<string, { customerId: string; customerName: string; hours: number; projects: ProjectSummaryRow[] }>();
  for (const row of rows) {
    const entry = byCustomer.get(row.customerId) ?? { customerId: row.customerId, customerName: row.customerName, hours: 0, projects: [] };
    entry.hours += row.hours;
    entry.projects.push(row);
    byCustomer.set(row.customerId, entry);
  }
  const customerGroups = Array.from(byCustomer.values()).sort((a, b) => b.hours - a.hours);

  return (
    <div className="mt-3 bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-display font-semibold">{t("calendar.projectSummary")}</h2>
        <span className="text-sm font-mono text-muted-foreground">{round1(totalHours)}h</span>
      </div>
      <div className="space-y-3">
        {customerGroups.map((g) => (
          <div key={g.customerId} className="rounded-xl bg-secondary/60 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium">{g.customerName}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">{round1(g.hours)}h</span>
                {onExportCustomer && (
                  <button
                    onClick={() => onExportCustomer(g.customerId, g.customerName)}
                    className="text-xs px-2 py-1 rounded-lg bg-secondary hover:bg-accent transition"
                  >
                    {t("calendar.exportCustomer")}
                  </button>
                )}
              </div>
            </div>
            <ul className="space-y-0.5">
              {g.projects.map((p) => (
                <li key={p.projectId} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{p.projectName}</span>
                  <span className="font-mono shrink-0 ml-2">{round1(p.hours)}h</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {unassignedHours > 0 && (
          <p className="text-xs text-muted-foreground px-1">{t("calendar.unassignedHours", { hours: String(round1(unassignedHours)) })}</p>
        )}
      </div>
    </div>
  );
}
