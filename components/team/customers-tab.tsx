"use client";

// Kunden-Tab des Team-Hubs: Kunden- und Projekttabelle, wie zuvor in der
// Teamsicht (app/(app)/team/page.tsx "Kunden- und Projektsicht"), jetzt mit
// pro Kunde aufklappbarer Aufteilung nach Person. Die Projekttabelle liest
// seit dem Nachtrag "Projektstunden pro Tag" primär aus TimeEntry.projectId
// (app/api/team/route.ts, lib/customer-months.ts projectHoursByUserAndProject).

import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { Briefcase, AlertTriangle, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TeamData } from "@/components/team/types";

export function CustomersTab({ data }: { data: TeamData }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4 space-y-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <h2 className="text-sm font-display font-semibold flex items-center gap-2"><Briefcase className="w-4 h-4 text-primary" /> {t("teamsicht.customersTitle")}</h2>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">{t("teamsicht.customersSubtitle")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colCustomer")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colHours")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colRate")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colRevenue")}</th>
                <th className="py-2 pr-3 font-medium w-6" />
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c) => {
                const isOpen = expanded.has(c.id);
                return (
                  <Fragment key={c.id}>
                    <tr className="border-b border-border/30 last:border-0 cursor-pointer hover:bg-accent/40" onClick={() => toggle(c.id)}>
                      <td className="py-2 pr-3 font-medium">{c.name}</td>
                      <td className="py-2 pr-3 font-mono">{c.stunden.toFixed(1)}h</td>
                      <td className="py-2 pr-3 font-mono">{c.hourlyRate != null ? `${c.hourlyRate.toFixed(2)} CHF` : "–"}</td>
                      <td className="py-2 pr-3 font-mono">{c.hourlyRate != null ? `${c.umsatz.toFixed(2)} CHF` : "–"}</td>
                      <td className="py-2 pr-3"><ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/30 last:border-0 bg-secondary/30">
                        <td colSpan={5} className="py-3 px-3">
                          {c.nachPerson.length === 0 ? (
                            <div className="text-xs text-muted-foreground">{t("teamsicht.noData")}</div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {c.nachPerson.map((p) => (
                                <div key={p.userId} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card text-xs" style={{ boxShadow: "var(--shadow-sm)" }}>
                                  <span className="font-medium">{p.name}</span>
                                  <span className="font-mono text-muted-foreground">{p.stunden.toFixed(1)}h</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {data.customers.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground text-xs">{t("teamsicht.noData")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">{t("teamsicht.projectsSubtitle")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colProject")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colCustomer")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colHours")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colBudget")}</th>
                <th className="py-2 pr-3 font-medium">{t("teamsicht.colRevenue")}</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className={`border-b border-border/30 last:border-0 ${p.ueberzogen ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                  <td className="py-2 pr-3 font-medium flex items-center gap-1.5">
                    {p.ueberzogen && <span title={t("teamsicht.overBudget")}><AlertTriangle className="w-3.5 h-3.5 text-red-500" /></span>}
                    {p.name}
                  </td>
                  <td className="py-2 pr-3">{p.customerName}</td>
                  <td className="py-2 pr-3 font-mono">{p.stunden.toFixed(1)}h</td>
                  <td className={`py-2 pr-3 font-mono ${p.ueberzogen ? "text-red-500 font-semibold" : ""}`}>{p.budgetHours != null ? `${p.budgetHours.toFixed(1)}h` : "–"}</td>
                  <td className="py-2 pr-3 font-mono">{p.umsatz.toFixed(2)} CHF</td>
                </tr>
              ))}
              {data.projects.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground text-xs">{t("teamsicht.noData")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
