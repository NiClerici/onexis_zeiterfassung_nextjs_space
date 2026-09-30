"use client";

// Kleiner Saldo-Verlauf für die aufgeklappte Mitarbeitenden-Karte im
// Team-Hub — dasselbe Muster wie der grosse Trend in components/
// analytics-charts.tsx (BalanceTrendChart), nur kompakt ohne Achsen und
// ohne Legende. Der Datenpunkt kommt bereits fertig berechnet aus
// GET /api/team (members[].saldoSerie, lib/saldo.ts saldoSerie()).

import { useId } from "react";
import { AreaChart, Area, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export interface SaldoSeriePunkt {
  date: string;
  balance: number;
  delta: number;
}

const CHART_COLOR_POS = "hsl(var(--chart-2))";
const CHART_COLOR_NEG = "hsl(var(--destructive))";
const TOOLTIP_STYLE = {
  fontSize: 11,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
};

function fmtMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${y}`;
}

function signedH(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}h`;
}

export function SaldoSparkline({ series }: { series: SaldoSeriePunkt[] }) {
  const gradientId = useId();
  if (!series || series.length < 2) return null;

  const last = series[series.length - 1].balance;
  const color = last >= 0 ? CHART_COLOR_POS : CHART_COLOR_NEG;

  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Tooltip
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }}
            wrapperStyle={{ outline: "none", zIndex: 20 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as SaldoSeriePunkt | undefined) : undefined;
              if (!p) return null;
              return (
                <div style={TOOLTIP_STYLE} className="px-2 py-1 tabular-nums">
                  <div className="text-muted-foreground">{fmtMonth(p.date)}</div>
                  <div className="font-semibold">{signedH(p.balance)}</div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="balance" stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 2.5, strokeWidth: 0, fill: color }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
