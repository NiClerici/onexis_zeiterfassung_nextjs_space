"use client";

import { useId } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line, AreaChart, Area, ReferenceLine } from "recharts";

interface AnalyticsData {
  targetHours: number;
  actualHours: number;
  customerHours: number;
  billingRate: number;
  holidays: number;
  monthlyData: Array<{ month: string; target: number; actual: number; work: number; customer: number }>;
}

// Token-Farben statt fester Hex-Werte (--chart-1..5, app/globals.css) — die
// Werte kippen dadurch mit dem Theme mit, statt im Dark Mode fest auf den
// hellen Ton stehen zu bleiben. recharts akzeptiert jeden CSS-Farbstring,
// hsl(var(--chart-n)) löst im SVG korrekt auf.
const CHART_1 = "hsl(var(--chart-1))";
const CHART_2 = "hsl(var(--chart-2))";
const CHART_3 = "hsl(var(--chart-3))";
const AXIS_TICK = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const TOOLTIP_STYLE = {
  fontSize: 11,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
};
const LEGEND_STYLE = { fontSize: 11, color: "hsl(var(--muted-foreground))" };

export default function AnalyticsCharts({ data, t }: { data: AnalyticsData; t: (key: string) => string }) {
  const monthlyData = data?.monthlyData ?? [];
  if ((monthlyData?.length ?? 0) === 0) return null;

  return (
    <div className="space-y-4">
      {/* Bar Chart: Target vs Actual */}
      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-sm font-display font-semibold mb-3">{t("analytics.overview")}</h3>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 10, right: 0, left: 0, bottom: 20 }}>
              <XAxis
                dataKey="month"
                tickLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
              />
              <YAxis width={28} tickLine={false} tick={AXIS_TICK} />
              {/* Der Default-Cursor von recharts ist ein deckender grauer
                  Block ueber der vollen Balkenhoehe — auf Touch bleibt er
                  nach dem Antippen stehen und verdeckt die Balken. Ein
                  dezenter Tint statt Vollflaeche, dazu ausserhalb des
                  Diagramms nicht sichtbar. */}
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 }}
                wrapperStyle={{ outline: "none", zIndex: 20 }}
                allowEscapeViewBox={{ x: false, y: false }}
                isAnimationActive={false}
              />
              <Legend verticalAlign="top" wrapperStyle={{ ...LEGEND_STYLE, paddingBottom: 8 }} />
              <Bar dataKey="target" name={t("analytics.targetHours")} fill={CHART_1} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name={t("analytics.actualHours")} fill={CHART_2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Line Chart: Customer hours trend */}
      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-sm font-display font-semibold mb-3">{t("analytics.monthlyTrend")}</h3>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData} margin={{ top: 10, right: 0, left: 0, bottom: 20 }}>
              <XAxis
                dataKey="month"
                tickLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
              />
              <YAxis width={28} tickLine={false} tick={AXIS_TICK} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                wrapperStyle={{ outline: "none", zIndex: 20 }}
                allowEscapeViewBox={{ x: false, y: false }}
                isAnimationActive={false}
              />
              <Legend verticalAlign="top" wrapperStyle={{ ...LEGEND_STYLE, paddingBottom: 8 }} />
              <Line type="monotone" dataKey="work" name={t("analytics.workHours")} stroke={CHART_2} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="customer" name={t("analytics.customerHours")} stroke={CHART_3} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export interface OvertimePoint { date: string; balance: number; delta: number }
type Granularity = "day" | "week" | "month";

const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const signedH = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}h`;

// Datum kommt als "YYYY-MM-DD" (UTC-Kalendertag) — bewusst per getUTC* gelesen,
// sonst verrutscht der Tag in Zeitzonen westlich von UTC.
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}
const dayMonth = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;

// Saldo-Verlauf rechts in der Überstunden-Hero-Karte: Fläche des kumulierten
// Nettosaldos pro Tag/Woche/Monat, gestrichelte Nulllinie, keine Y-Achse —
// die Zahl links liefert den Massstab, Details per Tooltip.
export function OvertimeSparkline({
  series,
  granularity,
  t,
}: {
  series: OvertimePoint[];
  granularity: Granularity;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const gradientId = useId().replace(/:/g, "");
  if (series.length < 2) return null;

  const last = series[series.length - 1]?.balance ?? 0;
  const color = last >= 0 ? CHART_2 : "hsl(var(--destructive))";
  const data = series.map((p, i) => {
    const d = parseYMD(p.date);
    const tick = granularity === "month" && i > 0 ? MONTHS_SHORT[d.getUTCMonth()] : dayMonth(d);
    let label: string;
    if (i === 0) label = t("analytics.trendStart", { date: dayMonth(d) });
    else if (granularity === "day") label = `${WEEKDAYS_SHORT[d.getUTCDay()]} ${dayMonth(d)}`;
    else if (granularity === "week") label = t("analytics.trendWeekUntil", { date: dayMonth(d) });
    else label = `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return { ...p, tick, label, first: i === 0 };
  });
  const deltaLabel = t(granularity === "day" ? "analytics.trendDeltaDay" : granularity === "week" ? "analytics.trendDeltaWeek" : "analytics.trendDeltaMonth");
  const balances = series.map((p) => p.balance);
  const yMin = Math.min(...balances);
  const yMax = Math.max(...balances);
  const yPad = Math.max(1, (yMax - yMin) * 0.15);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="tick" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={24} height={16} />
        <YAxis hide domain={[yMin - yPad, yMax + yPad]} />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
        <Tooltip
          cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }}
          wrapperStyle={{ outline: "none", zIndex: 20 }}
          allowEscapeViewBox={{ x: false, y: false }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            if (!p) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2.5 py-1.5 tabular-nums">
                <div className="text-muted-foreground mb-0.5">{p.label}</div>
                <div>{t("analytics.trendBalance")}: <span className="font-semibold">{signedH(p.balance)}</span></div>
                {!p.first && <div className="text-muted-foreground">{deltaLabel}: {signedH(p.delta)}</div>}
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: color }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
