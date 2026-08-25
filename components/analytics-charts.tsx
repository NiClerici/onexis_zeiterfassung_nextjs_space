"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";

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
const AXIS_LABEL_STYLE = { textAnchor: "middle" as const, fontSize: 11, fill: "hsl(var(--muted-foreground))" };
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
            <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis
                dataKey="month"
                tickLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                tick={AXIS_TICK}
                label={{ value: "h", angle: -90, position: "insideLeft", style: AXIS_LABEL_STYLE }}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} />
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
            <LineChart data={monthlyData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis
                dataKey="month"
                tickLine={false}
                tick={AXIS_TICK}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                tick={AXIS_TICK}
                label={{ value: "h", angle: -90, position: "insideLeft", style: AXIS_LABEL_STYLE }}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend verticalAlign="top" wrapperStyle={LEGEND_STYLE} />
              <Line type="monotone" dataKey="work" name={t("analytics.workHours")} stroke={CHART_2} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="customer" name={t("analytics.customerHours")} stroke={CHART_3} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
