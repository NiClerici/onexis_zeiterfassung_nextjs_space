"use client";

// Eine Mitarbeitenden-Zeile im Team-Hub (Übersicht-Tab) — zugeklappt die
// Kernwerte, per Pfeil alle Details in drei Gruppen (Zeitkonto / Kunden &
// Projekte / Absenzen & Ferienkonto). Vorbild: die "Service/Subscription"-
// Kartenliste, die Nico als Referenz gegeben hat (Zeile mit Kernwerten, ein
// Pfeil klappt alle Details auf, kein separates Drawer).

import { ChevronDown, Download, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TYPE_COLOR } from "@/lib/absence-colors";
import { SaldoSparkline } from "@/components/team/saldo-sparkline";
import { ABSENZ_SPALTEN, type TeamMember, type AbsenzVerteilung } from "@/components/team/types";

function fmtH(n: number): string {
  return `${n.toFixed(1)}h`;
}
function signedH(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}h`;
}
function fmtAbsenz(v: AbsenzVerteilung, tageKurz: string): string {
  return `${v.stunden.toFixed(1)}h · ${v.tage.toFixed(1)} ${tageKurz}`;
}

export function MemberCard({
  member,
  isAdmin,
  isOpen,
  onToggle,
  onExport,
  exporting,
  onOpenAdmin,
}: {
  member: TeamMember;
  isAdmin: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onExport: () => void;
  exporting: boolean;
  onOpenAdmin?: () => void;
}) {
  const { t } = useI18n();
  const absenzTageSumme = ABSENZ_SPALTEN.reduce((s, typ) => s + member.verteilung.absenzen[typ].tage, 0);
  const istSollPct = member.soll > 0 ? Math.min(100, Math.round((member.ist / member.soll) * 100)) : 0;
  const geplanteAbsenzen = ABSENZ_SPALTEN.filter((typ) => member.verteilung.geplantAbsenzen[typ].stunden > 0);

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <div className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition cursor-pointer" onClick={onToggle}>
        <div className="min-w-[130px]">
          <div className="text-sm font-medium">{member.name}</div>
          <div className="text-xs text-muted-foreground">{member.pensum}%</div>
        </div>

        <div className="min-w-[90px]">
          <div className="text-xs font-mono">{fmtH(member.ist)} / {fmtH(member.soll)}</div>
          <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden mt-1">
            <div className="h-full bg-primary" style={{ width: `${istSollPct}%` }} />
          </div>
        </div>

        <div className="min-w-[85px]">
          <div className="text-xs font-mono">{fmtH(member.verteilung.kunden)}</div>
          <div className="text-xs text-muted-foreground">{member.verrechnungsgrad.toFixed(0)}%</div>
        </div>

        <div className="min-w-[70px] hidden sm:block">
          <div className="text-xs font-mono">{fmtH(member.verteilung.intern)}</div>
          <div className="text-[10px] text-muted-foreground">{t("teamsicht.kpiIntern")}</div>
        </div>

        <div className="min-w-[60px] hidden sm:block">
          <div className="text-xs font-mono">{absenzTageSumme.toFixed(1)} {t("teamsicht.tageKurz")}</div>
          <div className="text-[10px] text-muted-foreground">{t("teamsicht.kpiAbsenzen")}</div>
        </div>

        <div className="min-w-[70px] ml-auto text-right">
          <div className={`text-sm font-mono font-semibold ${member.saldoKumuliert.netOvertime >= 0 ? "text-green-600" : "text-red-500"}`}>
            {signedH(member.saldoKumuliert.netOvertime)}
          </div>
          <div className="text-[10px] text-muted-foreground">{t("team.colSaldoKum")}</div>
        </div>

        <div className="flex items-center gap-1 pl-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onExport} disabled={exporting} title={t("team.exportPerson")} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition disabled:opacity-50">
            <Download className="w-3.5 h-3.5" />
          </button>
          {isAdmin && onOpenAdmin && (
            <button onClick={onOpenAdmin} title={t("team.settingsPerson")} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition">
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onToggle} aria-label={isOpen ? t("teamsicht.collapse") : t("teamsicht.expand")} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition">
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-border/50 p-3 space-y-4 bg-secondary/30">
          {/* Zeitkonto */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{t("team.groupZeitkonto")}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("teamsicht.colSoll")}</div>
                <div className="text-sm font-mono">{fmtH(member.soll)}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("teamsicht.colIst")}</div>
                <div className="text-sm font-mono">{fmtH(member.ist)}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("teamsicht.colSaldo")}</div>
                <div className={`text-sm font-mono ${member.ueberstunden >= 0 ? "text-green-600" : "text-red-500"}`}>{signedH(member.ueberstunden)}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("team.colSaldoKum")}</div>
                <div className={`text-sm font-mono ${member.saldoKumuliert.netOvertime >= 0 ? "text-green-600" : "text-red-500"}`}>{signedH(member.saldoKumuliert.netOvertime)}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("team.colUeberzeit")}</div>
                <div className="text-sm font-mono">{fmtH(member.ueberzeit)}</div>
              </div>
            </div>
            <SaldoSparkline series={member.saldoSerie} />
          </div>

          {/* Kunden & Projekte */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{t("team.groupKunden")}</h4>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 text-xs">
                <span className="font-medium">{t("teamsicht.kpiIntern")}</span>
                <span className="font-mono text-muted-foreground">{fmtH(member.verteilung.intern)}</span>
              </div>
              {member.kundenNachKunde.length === 0 ? (
                <span className="text-xs text-muted-foreground self-center">{t("teamsicht.noData")}</span>
              ) : (
                member.kundenNachKunde.map((k) => (
                  <div key={k.customerId} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card text-xs" style={{ boxShadow: "var(--shadow-sm)" }}>
                    <span className="font-medium">{k.name}</span>
                    <span className="font-mono text-muted-foreground">{fmtH(k.stunden)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Absenzen & Ferienkonto */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{t("team.groupAbsenzen")}</h4>
            <div className="flex flex-wrap gap-2 mb-2">
              {ABSENZ_SPALTEN.map((typ) => (
                <div key={typ} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card text-xs" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <span className={`w-2 h-2 rounded-full ${TYPE_COLOR[typ]}`} />
                  <span className="font-medium">{t(`calendar.type.${typ}`)}</span>
                  <span className="font-mono text-muted-foreground whitespace-nowrap">{fmtAbsenz(member.verteilung.absenzen[typ], t("teamsicht.tageKurz"))}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("absences.colEntitlement")}</div>
                <div className="text-sm font-mono">{member.feriensaldo.anspruch} {t("teamsicht.tageKurz")}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("analytics.usedVacation")}</div>
                <div className="text-sm font-mono">{member.feriensaldo.bezogen} {t("teamsicht.tageKurz")}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("analytics.plannedVacation")}</div>
                <div className="text-sm font-mono">{member.feriensaldo.geplant} {t("teamsicht.tageKurz")}</div>
              </div>
              <div className="bg-card rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] text-muted-foreground">{t("absences.colRemaining")}</div>
                <div className="text-sm font-mono font-semibold">{member.feriensaldo.offen} {t("teamsicht.tageKurz")}</div>
              </div>
            </div>
            {geplanteAbsenzen.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {t("team.geplantePrefix")}{" "}
                {geplanteAbsenzen
                  .map((typ) => `${t(`calendar.type.${typ}`)}: ${fmtAbsenz(member.verteilung.geplantAbsenzen[typ], t("teamsicht.tageKurz"))}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
