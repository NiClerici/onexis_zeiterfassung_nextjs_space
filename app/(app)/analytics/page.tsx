"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { BarChart3, TrendingUp, Target, Percent, Clock, Palmtree, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { MonthYearPicker } from "@/components/ui/month-year-picker";

const BarChartComponent = dynamic(() => import("@/components/analytics-charts"), { ssr: false, loading: () => <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading...</div> });

interface VacationBalance {
  year: number;
  totalDays: number;
  usedDays: number;
  plannedDays: number;
  remainingDays: number;
}

interface AnalyticsData {
  targetHours: number;
  actualHours: number;
  customerHours: number;
  customerHoursFromMigration: number;
  billingRate: number;
  // Nenner von billingRate (reine Arbeitszeit ohne Absenzen) — für die
  // Aufschlüsselung unter der Verrechnungsgrad-Kachel.
  workHours: number;
  holidays: number;
  overtime: number;
  paidOutHours: number;
  netOvertime: number;
  // Netto-Prognose per Periodenende (Ist + Geplant − Soll − Auszahlungen),
  // für den gewählten Zeitraum. Zusammen mit netOvertime die rechte Spalte
  // der Überstunden-Matrix unten.
  forecastNetOvertime: number;
  // ISO-Datum des Periodenendes — für die Zeilenbeschriftung "per <Datum>".
  periodEnd: string;
  weeklyOvertime: number;
  futureHours: number;
  fullTargetHours: number;
  // Kumulierter Saldo seit Eintritt, unabhängig vom gewählten Zeitraum — null,
  // wenn der gewählte Zeitraum die Historie bereits abdeckt.
  cumulative: {
    since: string;
    asOf: string;
    targetHours: number;
    actualHours: number;
    overtimeGross: number;
    paidOutHours: number;
    netOvertime: number;
    forecastNetOvertime: number;
  } | null;
  vacationBalance: VacationBalance;
  monthlyData: Array<{ month: string; target: number; actual: number; work: number; customer: number }>;
}

export default function AnalyticsPage() {
  const { t } = useI18n();
  const [periodType, setPeriodType] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; });
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState(() => Math.ceil((new Date().getMonth() + 1) / 3));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customDefaultsLoaded, setCustomDefaultsLoaded] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  // Load user's startDate for custom period defaults
  useEffect(() => {
    async function loadDefaults() {
      try {
        const res = await fetch("/api/profile");
        if (res?.ok) {
          const profile = await res?.json?.().catch(() => ({}));
          if (profile?.startDate) {
            const sd = new Date(profile.startDate);
            const yyyy = sd.getFullYear();
            const mm = String(sd.getMonth() + 1).padStart(2, "0");
            const dd = String(sd.getDate()).padStart(2, "0");
            setCustomFrom(`${yyyy}-${mm}-${dd}`);
          }
        }
      } catch (err: any) { console.error(err); }
      // Yesterday as default end date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yy = yesterday.getFullYear();
      const ym = String(yesterday.getMonth() + 1).padStart(2, "0");
      const yd = String(yesterday.getDate()).padStart(2, "0");
      setCustomTo(`${yy}-${ym}-${yd}`);
      setCustomDefaultsLoaded(true);
    }
    loadDefaults();
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/analytics?";
      if (periodType === "month") {
        const [y, m] = (selectedMonth ?? "").split("-");
        url += `type=month&year=${y}&month=${m}`;
      } else if (periodType === "quarter") {
        url += `type=quarter&year=${selectedYear}&quarter=${selectedQuarter}`;
      } else if (periodType === "year") {
        url += `type=year&year=${selectedYear}`;
      } else {
        url += `type=custom&from=${customFrom}&to=${customTo}`;
      }
      const res = await fetch(url);
      if (res?.ok) {
        const d = await res?.json?.().catch(() => ({}));
        setData(d ?? null);
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, [periodType, selectedMonth, selectedYear, selectedQuarter, customFrom, customTo]);

  useEffect(() => {
    if (periodType === "custom" && (!customFrom || !customTo || !customDefaultsLoaded)) return;
    fetchAnalytics();
  }, [fetchAnalytics, periodType, customFrom, customTo, customDefaultsLoaded]);

  // targetHours ist das Soll BIS HEUTE, fullTargetHours das der ganzen Periode
  // (k.soll vs. k.sollGesamt, siehe app/api/analytics/route.ts). Sind sie
  // gleich, ist die Periode abgeschlossen — dann bleibt die Soll-Subline weg,
  // weil sie nichts Zusätzliches aussagt.
  const periodOngoing = (data?.fullTargetHours ?? 0) > (data?.targetHours ?? 0);
  const weeklyOvertimeVal = data?.weeklyOvertime ?? 0;
  const weeklyOvertimeColor = weeklyOvertimeVal > 0 ? "text-red-500" : "text-green-600";

  // Überstunden-Matrix: bis heute / per Periodenende × gesamt seit Eintritt /
  // gewählter Zeitraum. Alle vier Werte netto (nach Auszahlungen), damit die
  // Matrix zeilen- wie spaltenweise aufgeht (siehe app/api/analytics/route.ts).
  const netOvertimeVal = data?.netOvertime ?? 0;
  const forecastNetOvertimeVal = data?.forecastNetOvertime ?? 0;
  const cumulative = data?.cumulative ?? null;
  const periodColLabel = periodType === "month" ? t("analytics.colPeriodMonth") : t("analytics.colPeriodRange");
  const periodEndLabel = data?.periodEnd ? new Date(data.periodEnd).toLocaleDateString("de-CH") : "";
  const cellColor = (v: number) => (v >= 0 ? "text-green-600" : "text-red-500");

  return (
    <div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4">{t("analytics.title")}</h1>
      </motion.div>

      {/* Period selector */}
      <div className="bg-card rounded-2xl p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex gap-2 mb-3 flex-wrap">
          {["month", "quarter", "year", "custom"].map((pt: string) => (
            <button key={pt} onClick={() => setPeriodType(pt)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${periodType === pt ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-accent'}`}>
              {t(`analytics.${pt}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap">
          {periodType === "month" && <MonthYearPicker value={selectedMonth} onChange={setSelectedMonth} />}
          {periodType === "quarter" && (
            <>
              <input type="number" min="2020" max="2030" value={selectedYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedYear(parseInt(e?.target?.value) || 2026)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <select value={selectedQuarter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedQuarter(parseInt(e?.target?.value) || 1)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value={1}>Q1</option><option value={2}>Q2</option><option value={3}>Q3</option><option value={4}>Q4</option>
              </select>
            </>
          )}
          {periodType === "year" && <input type="number" min="2020" max="2030" value={selectedYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedYear(parseInt(e?.target?.value) || 2026)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary/30" />}
          {periodType === "custom" && (
            <>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("analytics.from")}</span><input type="date" value={customFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("analytics.to")}</span><input type="date" value={customTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomTo(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("common.loading")}</div>
      ) : data ? (
        <>
          {/* Überstunden-Matrix: bis heute / per Periodenende × gesamt seit
              Eintritt / gewählter Zeitraum — zieht die drei zentralen Zahlen
              zusammen, die vorher über zwei Kacheln und eine Prognose-Box
              verstreut waren. */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-500" /> {t("analytics.overtimeBlock")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th></th>
                    {cumulative && (
                      <th className="text-right font-normal pb-2 pl-4">
                        <div className="text-xs text-muted-foreground">{t("analytics.colTotal")}</div>
                        <div className="text-[11px] text-muted-foreground">{t("analytics.colTotalSince", { date: new Date(cumulative.since).toLocaleDateString("de-CH") })}</div>
                      </th>
                    )}
                    <th className="text-right font-normal pb-2 pl-4">
                      <div className="text-xs text-muted-foreground">{periodColLabel}</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="text-left font-normal text-xs text-muted-foreground py-1">{t("analytics.rowToDate")}</th>
                    {cumulative && (
                      <td className={`text-right font-mono font-bold pl-4 ${cellColor(cumulative.netOvertime)}`}>{cumulative.netOvertime >= 0 ? "+" : ""}{cumulative.netOvertime.toFixed(1)}h</td>
                    )}
                    <td className={`text-right font-mono font-bold pl-4 ${cellColor(netOvertimeVal)}`}>{netOvertimeVal >= 0 ? "+" : ""}{netOvertimeVal.toFixed(1)}h</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-left font-normal text-xs text-muted-foreground py-1">{t("analytics.rowAtPeriodEnd", { date: periodEndLabel })}</th>
                    {cumulative && (
                      <td className={`text-right font-mono font-bold pl-4 ${cellColor(cumulative.forecastNetOvertime)}`}>{cumulative.forecastNetOvertime >= 0 ? "+" : ""}{cumulative.forecastNetOvertime.toFixed(1)}h</td>
                    )}
                    <td className={`text-right font-mono font-bold pl-4 ${cellColor(forecastNetOvertimeVal)}`}>{forecastNetOvertimeVal >= 0 ? "+" : ""}{forecastNetOvertimeVal.toFixed(1)}h</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-muted-foreground space-y-0.5">
              <p>{t("analytics.plannedFutureFoot", { hours: (data.futureHours ?? 0).toFixed(1) })}</p>
              {(cumulative ? cumulative.paidOutHours > 0 : (data.paidOutHours ?? 0) > 0) && (
                <p>
                  {t("analytics.payoutsFootTotal", { hours: (cumulative ? cumulative.paidOutHours : data.paidOutHours ?? 0).toFixed(1) })}
                  {cumulative && ` · ${t("analytics.payoutsFootPeriod", { label: periodColLabel, hours: (data.paidOutHours ?? 0).toFixed(1) })}`}
                </p>
              )}
            </div>
          </motion.div>

          {/* Detail-Kacheln */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-2 mb-2"><Target className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">{t("analytics.targetHours")}</span></div>
              <p className="text-xl font-mono font-bold">{(data?.targetHours ?? 0)?.toFixed?.(1)}<span className="text-sm font-normal text-muted-foreground">h</span></p>
              {periodOngoing && (
                <p className="text-xs font-mono mt-1 text-muted-foreground">{t("analytics.targetToDate")} · {t("analytics.ofFullTarget", { hours: (data?.fullTargetHours ?? 0).toFixed(1) })}</p>
              )}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-green-500" /><span className="text-xs text-muted-foreground">{t("analytics.actualHours")}</span></div>
              <p className="text-xl font-mono font-bold">{(data?.actualHours ?? 0)?.toFixed?.(1)}<span className="text-sm font-normal text-muted-foreground">h</span></p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-2 mb-2"><Percent className="w-4 h-4 text-purple-500" /><span className="text-xs text-muted-foreground">{t("analytics.billingRate")}</span></div>
              <p className="text-xl font-mono font-bold">{(data?.billingRate ?? 0)?.toFixed?.(1)}<span className="text-sm font-normal text-muted-foreground">%</span></p>
              <p className="text-xs font-mono mt-1 text-muted-foreground">{t("analytics.billingRateBasis", { customer: (data?.customerHours ?? 0).toFixed(1), work: (data?.workHours ?? 0).toFixed(1) })}</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-sky-500" /><span className="text-xs text-muted-foreground">{t("analytics.customerHours")}</span></div>
              <p className="text-xl font-mono font-bold">{(data?.customerHours ?? 0)?.toFixed?.(1)}<span className="text-sm font-normal text-muted-foreground">h</span></p>
              {(data?.customerHoursFromMigration ?? 0) > 0 && (
                <p className="text-xs font-mono mt-1 text-muted-foreground">{t("analytics.customerHoursFromMigration", { hours: (data?.customerHoursFromMigration ?? 0).toFixed(1) })}</p>
              )}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }} title={t("analytics.weeklyOvertimeHint")}>
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-red-500" /><span className="text-xs text-muted-foreground">{t("analytics.weeklyOvertime")}</span></div>
              <p className={`text-xl font-mono font-bold ${weeklyOvertimeColor}`}>{weeklyOvertimeVal.toFixed(1)}<span className="text-sm font-normal text-muted-foreground">h</span></p>
            </motion.div>
          </div>

          {/* Vacation Balance */}
          {data?.vacationBalance && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-card rounded-2xl p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
              <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
                <Palmtree className="w-4 h-4 text-green-600" /> {t("analytics.vacationBalance")} {data.vacationBalance.year}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-secondary rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("analytics.totalEntitlement")}</p>
                  <p className="text-lg font-mono font-bold">{data.vacationBalance.totalDays}</p>
                </div>
                <div className="bg-secondary rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("analytics.usedVacation")}</p>
                  <p className="text-lg font-mono font-bold">{data.vacationBalance.usedDays}</p>
                </div>
                <div className="bg-secondary rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("analytics.plannedVacation")}</p>
                  <p className="text-lg font-mono font-bold text-sky-500">{data.vacationBalance.plannedDays}</p>
                </div>
                <div className="bg-secondary rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("analytics.stillToPlan")}</p>
                  <p className={`text-lg font-mono font-bold ${data.vacationBalance.remainingDays >= 0 ? 'text-primary' : 'text-red-500'}`}>{data.vacationBalance.remainingDays}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Charts */}
          <BarChartComponent data={data} t={t} />
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("analytics.noData")}</div>
      )}
    </div>
  );
}
