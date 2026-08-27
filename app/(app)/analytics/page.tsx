"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { Clock, BarChart3, Users, TriangleAlert, Palmtree, CalendarDays } from "lucide-react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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

  const netOvertimeVal = data?.netOvertime ?? 0;
  const forecastNetOvertimeVal = data?.forecastNetOvertime ?? 0;
  const cumulative = data?.cumulative ?? null;
  const periodColLabel = periodType === "month" ? t("analytics.colPeriodMonth") : t("analytics.colPeriodRange");
  const periodEndLabel = data?.periodEnd ? new Date(data.periodEnd).toLocaleDateString("de-CH") : "";
  const tone = (v: number) => (v >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400");
  const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}h`;

  // Hero-Zahl: kumulierter Nettosaldo seit Eintritt, wenn vorhanden — sonst
  // (Zeitraum deckt die ganze Historie ab) fällt sie auf den Zeitraumwert
  // zurück, dann bleibt der Badge daneben weg (wäre identisch).
  const heroVal = cumulative ? cumulative.netOvertime : netOvertimeVal;
  const heroForecast = cumulative ? cumulative.forecastNetOvertime : forecastNetOvertimeVal;
  const heroPaidOut = cumulative ? cumulative.paidOutHours : (data?.paidOutHours ?? 0);
  const badgeLabel = periodType === "month" ? t("analytics.badgePeriodMonth") : t("analytics.badgePeriodRange");

  // Arbeitszeit-Fortschritt: 0–100 geclamped, weil der Progress-Indicator
  // per translateX(-(100-value)%) positioniert wird — Werte über 100 laufen
  // sonst aus der Bahn.
  const targetHoursVal = data?.targetHours ?? 0;
  const actualHoursVal = data?.actualHours ?? 0;
  const workProgress = targetHoursVal > 0 ? Math.min(100, (actualHoursVal / targetHoursVal) * 100) : 0;
  const workTargetMet = actualHoursVal >= targetHoursVal;
  const billingRateVal = data?.billingRate ?? 0;
  const remainingVacation = data?.vacationBalance?.remainingDays ?? 0;

  return (
    <div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4">{t("analytics.title")}</h1>
      </motion.div>

      {/* Period selector — Segmented Control + Feld(er) in einer Zeile */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Tabs value={periodType} onValueChange={setPeriodType}>
          <TabsList className="h-9">
            {["month", "quarter", "year", "custom"].map((pt: string) => (
              <TabsTrigger key={pt} value={pt} className="text-sm">{t(`analytics.${pt}`)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex gap-2 flex-wrap items-center">
          {periodType === "month" && (
            <MonthYearPicker
              value={selectedMonth}
              onChange={setSelectedMonth}
              selectClassName="h-9 px-3 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              yearInputClassName="h-9 px-3 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          {periodType === "quarter" && (
            <>
              <input type="number" min="2020" max="2030" value={selectedYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedYear(parseInt(e?.target?.value) || 2026)} className="h-9 px-3 rounded-lg bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-ring" />
              <select value={selectedQuarter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedQuarter(parseInt(e?.target?.value) || 1)} className="h-9 px-3 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value={1}>Q1</option><option value={2}>Q2</option><option value={3}>Q3</option><option value={4}>Q4</option>
              </select>
            </>
          )}
          {periodType === "year" && <input type="number" min="2020" max="2030" value={selectedYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedYear(parseInt(e?.target?.value) || 2026)} className="h-9 px-3 rounded-lg bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-ring" />}
          {periodType === "custom" && (
            <>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("analytics.from")}</span><input type="date" value={customFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomFrom(e?.target?.value ?? "")} className="h-9 px-3 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("analytics.to")}</span><input type="date" value={customTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomTo(e?.target?.value ?? "")} className="h-9 px-3 rounded-lg bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("common.loading")}</div>
      ) : data ? (
        <>
          {/* Überstunden-Hero: eine dominante Zahl statt vier gleichwertiger
              Matrixwerte. Die Perioden-Prognose (vierter Matrixwert) entfällt
              bewusst — sie stand gleichgewichtig neben drei anderen Zahlen und
              wurde dadurch kaum gelesen. */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="p-5 mb-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Clock className="w-4 h-4" />
                {cumulative
                  ? t("analytics.overtimeHeroTotal", { date: new Date(cumulative.since).toLocaleDateString("de-CH") })
                  : t("analytics.overtimeHeroPeriod", { label: periodColLabel })}
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className={cn("font-display text-4xl font-semibold tracking-tight", tone(heroVal))}>{signed(heroVal)}</span>
                {cumulative && (
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 border-transparent">
                    {signed(netOvertimeVal)} {badgeLabel}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("analytics.forecastFoot", { date: periodEndLabel, hours: signed(heroForecast), planned: (data.futureHours ?? 0).toFixed(1) })}
                {heroPaidOut > 0 && ` · ${t("analytics.payoutsFootTotal", { hours: heroPaidOut.toFixed(1) })}`}
              </p>
            </Card>
          </motion.div>

          {/* Arbeitszeit + Verrechnungsgrad: Ist/Soll mit Fortschrittsbalken
              statt vier separater Zahlenkacheln. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 items-stretch">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="h-full">
              <Card className="p-4 h-full">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm"><BarChart3 className="w-4 h-4 text-muted-foreground" />{t("analytics.workTime")}</div>
                  <span className="font-mono text-sm tabular-nums">{actualHoursVal.toFixed(1)}h / {targetHoursVal.toFixed(1)}h</span>
                </div>
                <Progress value={workProgress} className={cn("h-2", workTargetMet ? "[&>div]:bg-emerald-600 dark:[&>div]:bg-emerald-500" : "[&>div]:bg-primary")} />
                <p className="text-xs text-muted-foreground mt-2">
                  {workTargetMet
                    ? t("analytics.workTargetMet", { hours: Math.abs(actualHoursVal - targetHoursVal).toFixed(1) })
                    : t("analytics.workTargetShort", { hours: Math.abs(targetHoursVal - actualHoursVal).toFixed(1) })}
                  {periodOngoing && ` · ${t("analytics.ofFullTarget", { hours: (data?.fullTargetHours ?? 0).toFixed(1) })}`}
                </p>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="h-full">
              <Card className="p-4 h-full">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm"><Users className="w-4 h-4 text-muted-foreground" />{t("analytics.billingRate")}</div>
                  <span className="font-mono text-sm tabular-nums">{billingRateVal.toFixed(1)}%</span>
                </div>
                <Progress value={Math.min(100, Math.max(0, billingRateVal))} className="h-2 [&>div]:bg-primary" />
                <p className="text-xs text-muted-foreground mt-2">
                  {t("analytics.billingRateBasis", { customer: (data?.customerHours ?? 0).toFixed(1), work: (data?.workHours ?? 0).toFixed(1) })}
                  {(data?.customerHoursFromMigration ?? 0) > 0 && ` · ${t("analytics.customerHoursFromMigration", { hours: (data?.customerHoursFromMigration ?? 0).toFixed(1) })}`}
                </p>
              </Card>
            </motion.div>
          </div>

          {/* Überzeit + Ferien-Rest: kompakte 2er-Grid */}
          <div className="grid grid-cols-2 gap-4 mb-4 items-stretch">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="h-full">
              <Card className="p-4 h-full" title={t("analytics.weeklyOvertimeHint")}>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TriangleAlert className="w-3.5 h-3.5" />{t("analytics.weeklyOvertime")}
                </div>
                <p className={cn("font-mono text-2xl font-bold", weeklyOvertimeVal > 0 ? "text-amber-700 dark:text-amber-500" : "text-foreground")}>
                  {weeklyOvertimeVal.toFixed(1)}<span className="text-sm font-normal text-muted-foreground">h</span>
                </p>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="h-full">
              <Card className="p-4 h-full">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Palmtree className="w-3.5 h-3.5" />{t("analytics.vacationToPlan")}
                </div>
                <p className={cn("font-mono text-2xl font-bold", remainingVacation < 0 ? "text-red-700 dark:text-red-400" : remainingVacation > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {remainingVacation}
                </p>
              </Card>
            </motion.div>
          </div>

          {/* Feriensaldo: bg-muted + Border statt bg-secondary ohne Kontur,
              "Noch zu planen" farblich hervorgehoben statt neutral. */}
          {data?.vacationBalance && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="p-4 mb-4">
                <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" /> {t("analytics.vacationBalance")} {data.vacationBalance.year}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">{t("analytics.totalEntitlement")}</p>
                    <p className="text-lg font-mono font-bold">{data.vacationBalance.totalDays}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">{t("analytics.usedVacation")}</p>
                    <p className="text-lg font-mono font-bold">{data.vacationBalance.usedDays}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">{t("analytics.plannedVacation")}</p>
                    <p className="text-lg font-mono font-bold text-primary/70">{data.vacationBalance.plannedDays}</p>
                  </div>
                  <div className={cn("rounded-xl border p-3", remainingVacation > 0 ? "border-primary/30 bg-primary/5" : "border-border bg-muted")}>
                    <p className="text-xs text-muted-foreground mb-1">{t("analytics.stillToPlan")}</p>
                    <p className={cn("text-lg font-mono font-bold", remainingVacation < 0 ? "text-red-700 dark:text-red-400" : "text-foreground")}>{data.vacationBalance.remainingDays}</p>
                  </div>
                </div>
              </Card>
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
