"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";

interface AnalyticsData {
  targetHours: number;
  actualHours: number;
  customerHours: number;
  billingRate: number;
  holidays: number;
  monthlyData: Array<{ month: string; target: number; actual: number; customer: number }>;
}

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
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                tick={{ fontSize: 10 }}
                label={{ value: "h", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 11 } }}
              />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" }} />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="target" name={t("analytics.targetHours")} fill="#60B5FF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name={t("analytics.actualHours")} fill="#34C759" radius={[4, 4, 0, 0]} />
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
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                tick={{ fontSize: 10 }}
                label={{ value: "h", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 11 } }}
              />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" }} />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="actual" name={t("analytics.workHours")} stroke="#34C759" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="customer" name={t("analytics.customerHours")} stroke="#FF9149" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
