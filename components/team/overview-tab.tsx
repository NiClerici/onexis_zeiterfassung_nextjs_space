"use client";

// Übersicht-Tab des Team-Hubs: KPI-Kacheln (Kundenstunden, Verrechnungsgrad)
// plus eine Liste aufklappbarer Mitarbeitenden-Karten (components/team/
// member-card.tsx). Ersetzt die frühere "Zeitverteilung"-Tabelle und die
// separate "Mitarbeitende"-Tabelle der alten Teamsicht — beide Ansichten
// sind jetzt eine Karte pro Person.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ArrowUpDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { MemberCard } from "@/components/team/member-card";
import type { TeamData } from "@/components/team/types";

type SortKey = "name" | "ist" | "kundenH" | "saldoKum";

export function OverviewTab({
  data,
  isAdmin,
  onExportMember,
  exportingUserId,
  onOpenAdmin,
}: {
  data: TeamData;
  isAdmin: boolean;
  onExportMember: (userId: string) => void;
  exportingUserId: string | null;
  onOpenAdmin?: (userId: string) => void;
}) {
  const { t } = useI18n();
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };

  const toggleExpand = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const members = useMemo(() => {
    return data.members
      .filter((m) => m.name.toLowerCase().includes(filterText.toLowerCase()))
      .slice()
      .sort((a, b) => {
        const av = sortKey === "name" ? a.name : sortKey === "ist" ? a.ist : sortKey === "kundenH" ? a.verteilung.kunden : a.saldoKumuliert.netOvertime;
        const bv = sortKey === "name" ? b.name : sortKey === "ist" ? b.ist : sortKey === "kundenH" ? b.verteilung.kunden : b.saldoKumuliert.netOvertime;
        if (typeof av === "string") return sortDir * av.localeCompare(bv as string);
        return sortDir * ((av as number) - (bv as number));
      });
  }, [data.members, filterText, sortKey, sortDir]);

  const SORT_OPTIONS: [SortKey, string][] = [
    ["name", "teamsicht.colName"],
    ["ist", "teamsicht.colIst"],
    ["kundenH", "teamsicht.colKunden"],
    ["saldoKum", "team.colSaldoKum"],
  ];

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><span className="w-2 h-2 rounded-full bg-primary" /> {t("teamsicht.kpiKunden")}</div>
          <div className="text-xl font-mono font-semibold">{data.totals.verteilung.kunden.toFixed(1)}h</div>
        </div>
        <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="text-xs text-muted-foreground mb-1">{t("teamsicht.kpiVerrechnungsgrad")}</div>
          <div className="text-xl font-mono font-semibold">{data.totals.verrechnungsgrad.toFixed(1)}%</div>
        </div>
      </motion.div>

      {data.kundenstundenUnscharf && (
        <div className="text-xs text-muted-foreground bg-secondary/60 rounded-xl px-3 py-2">{t("team.approxHint")}</div>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-1.5 flex-wrap">
            {SORT_OPTIONS.map(([key, labelKey]) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${sortKey === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {t(labelKey)} <ArrowUpDown className="w-3 h-3" />
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t("teamsicht.filterPlaceholder")}
              className="pl-8 pr-3 py-1.5 rounded-xl bg-secondary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-36 sm:w-48"
            />
          </div>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">{t("teamsicht.noData")}</div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <MemberCard
                key={m.userId}
                member={m}
                isAdmin={isAdmin}
                isOpen={expanded.has(m.userId)}
                onToggle={() => toggleExpand(m.userId)}
                onExport={() => onExportMember(m.userId)}
                exporting={exportingUserId === m.userId}
                onOpenAdmin={onOpenAdmin ? () => onOpenAdmin(m.userId) : undefined}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
