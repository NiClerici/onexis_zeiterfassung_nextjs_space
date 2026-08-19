"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Gauge, Download, ArrowUpDown, Search, Briefcase, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { MonthYearPicker } from "@/components/ui/month-year-picker";

interface FeriensaldoData {
  anspruch: number;
  bezogen: number;
  geplant: number;
  offen: number;
}

interface TeamMember {
  userId: string;
  name: string;
  pensum: number;
  soll: number;
  ist: number;
  ueberstunden: number;
  ueberzeit: number;
  kundenstunden: number;
  verrechnungsgrad: number;
  feriensaldo: FeriensaldoData;
}

interface ProjectRow {
  id: string;
  name: string;
  customerName: string;
  hourlyRate: number;
  budgetHours: number | null;
  stunden: number;
  umsatz: number;
  ueberzogen: boolean;
}

interface CustomerRow {
  id: string;
  name: string;
  hourlyRate: number | null;
  stunden: number;
  umsatz: number;
}

interface TeamData {
  members: TeamMember[];
  totals: { soll: number; ist: number; ueberstunden: number; kundenstunden: number; verrechnungsgrad: number };
  customers: CustomerRow[];
  projects: ProjectRow[];
}

type SortKey = "name" | "pensum" | "soll" | "ist" | "ueberstunden" | "verrechnungsgrad";

export default function TeamsichtPage() {
  const { t } = useI18n();
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const allowed = role === "owner" || role === "admin" || role === "manager";

  const [periodType, setPeriodType] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; });
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (sessionStatus === "authenticated" && role && !allowed) {
      router.replace("/calendar");
    }
  }, [sessionStatus, role, allowed, router]);

  const buildRangeQuery = useCallback(() => {
    if (periodType === "month") {
      const [y, m] = (selectedMonth ?? "").split("-");
      return `type=month&year=${y}&month=${m}`;
    } else if (periodType === "year") {
      return `type=year&year=${selectedYear}`;
    }
    return `type=custom&from=${customFrom}&to=${customTo}`;
  }, [periodType, selectedMonth, selectedYear, customFrom, customTo]);

  const fetchTeam = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/team?${buildRangeQuery()}`);
      if (res?.ok) {
        const d = await res?.json?.().catch(() => ({}));
        setData(d ?? null);
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, [allowed, buildRangeQuery]);

  useEffect(() => {
    if (periodType === "custom" && (!customFrom || !customTo)) return;
    fetchTeam();
  }, [fetchTeam, periodType, customFrom, customTo]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/export?${buildRangeQuery()}&scope=org`);
      if (res?.ok) {
        const blob = await res?.blob?.();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob ?? new Blob());
        a.download = `team_export_${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err: any) { console.error(err); } finally { setExporting(false); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };

  const filteredMembers = (data?.members ?? [])
    .filter((m) => m.name.toLowerCase().includes(filterText.toLowerCase()))
    .slice()
    .sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir * av.localeCompare(bv as string);
      return sortDir * ((av as number) - (bv as number));
    });

  if (sessionStatus === "loading" || (role && !allowed)) return null;

  return (
    <div className="space-y-4 pb-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4 flex items-center gap-2"><Gauge className="w-5 h-5 text-primary" /> {t("teamsicht.title")}</h1>
      </motion.div>

      {/* Period selector */}
      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex gap-2 mb-3 flex-wrap">
          {["month", "year", "custom"].map((pt: string) => (
            <button key={pt} onClick={() => setPeriodType(pt)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${periodType === pt ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}>
              {t(`profile.export${pt.charAt(0).toUpperCase() + pt.slice(1)}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap">
          {periodType === "month" && <MonthYearPicker value={selectedMonth} onChange={setSelectedMonth} />}
          {periodType === "year" && <input type="number" min="2020" max="2030" value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value) || 2026)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary/30" />}
          {periodType === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("common.loading")}</div>
      ) : !data || data.members.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("teamsicht.noData")}</div>
      ) : (
        <>
          {/* Mitarbeitenden-Tabelle */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-display font-semibold">{t("teamsicht.tableTitle")}</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder={t("teamsicht.filterPlaceholder")} className="pl-8 pr-3 py-1.5 rounded-xl bg-secondary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-36 sm:w-48" />
                </div>
                <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-accent transition disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" /> {exporting ? t("common.loading") : t("teamsicht.exportButton")}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    {([
                      ["name", "teamsicht.colName"],
                      ["pensum", "teamsicht.colPensum"],
                      ["soll", "teamsicht.colSoll"],
                      ["ist", "teamsicht.colIst"],
                      ["ueberstunden", "teamsicht.colSaldo"],
                      ["verrechnungsgrad", "teamsicht.colVerrechnung"],
                    ] as [SortKey, string][]).map(([key, labelKey]) => (
                      <th key={key} className="py-2 pr-3 font-medium cursor-pointer select-none" onClick={() => toggleSort(key)}>
                        <span className="flex items-center gap-1">{t(labelKey)} <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                    ))}
                    <th className="py-2 pr-3 font-medium">{t("teamsicht.colFerien")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => (
                    <tr key={m.userId} className="border-b border-border/30 last:border-0">
                      <td className="py-2 pr-3 font-medium">{m.name}</td>
                      <td className="py-2 pr-3 font-mono">{m.pensum}%</td>
                      <td className="py-2 pr-3 font-mono">{m.soll.toFixed(1)}h</td>
                      <td className="py-2 pr-3 font-mono">{m.ist.toFixed(1)}h</td>
                      <td className={`py-2 pr-3 font-mono ${m.ueberstunden >= 0 ? "text-green-600" : "text-red-500"}`}>{m.ueberstunden >= 0 ? "+" : ""}{m.ueberstunden.toFixed(1)}h</td>
                      <td className="py-2 pr-3 font-mono">{m.verrechnungsgrad.toFixed(1)}%</td>
                      <td className="py-2 pr-3 font-mono">{m.feriensaldo.offen}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-primary/30 font-semibold">
                    <td className="py-2 pr-3">{t("teamsicht.totalsRow")}</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 pr-3 font-mono">{data.totals.soll.toFixed(1)}h</td>
                    <td className="py-2 pr-3 font-mono">{data.totals.ist.toFixed(1)}h</td>
                    <td className={`py-2 pr-3 font-mono ${data.totals.ueberstunden >= 0 ? "text-green-600" : "text-red-500"}`}>{data.totals.ueberstunden >= 0 ? "+" : ""}{data.totals.ueberstunden.toFixed(1)}h</td>
                    <td className="py-2 pr-3 font-mono">{data.totals.verrechnungsgrad.toFixed(1)}%</td>
                    <td className="py-2 pr-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </motion.div>

          {/* Kunden-/Projektsicht — zwei Tabellen in einer Karte: Kunden
              (aggregiert, auch für direkt ohne Projekt verbuchte Stunden)
              und Projekte (granular, mit Budget). Vorher wurde nur
              data.projects gerendert; data.customers kam von der Route
              zwar schon zurück, war aber nirgends sichtbar — Organisationen,
              die nur auf Kundenebene verrechnen (kein Project-Datensatz
              angelegt), sahen deshalb immer "Keine Daten", obwohl echte
              verrechenbare Stunden vorlagen. */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl p-4 space-y-5" style={{ boxShadow: "var(--shadow-sm)" }}>
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => (
                      <tr key={c.id} className="border-b border-border/30 last:border-0">
                        <td className="py-2 pr-3 font-medium">{c.name}</td>
                        <td className="py-2 pr-3 font-mono">{c.stunden.toFixed(1)}h</td>
                        <td className="py-2 pr-3 font-mono">{c.hourlyRate != null ? `${c.hourlyRate.toFixed(2)} CHF` : "–"}</td>
                        <td className="py-2 pr-3 font-mono">{c.hourlyRate != null ? `${c.umsatz.toFixed(2)} CHF` : "–"}</td>
                      </tr>
                    ))}
                    {data.customers.length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-muted-foreground text-xs">{t("teamsicht.noData")}</td></tr>
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
        </>
      )}
    </div>
  );
}
