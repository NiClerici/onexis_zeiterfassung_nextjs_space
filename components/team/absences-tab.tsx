"use client";

// Absenzen-Tab des Team-Hubs: Genehmigungen + Team-Kalender, vorher unter
// /absences (dort verblieben nur noch die eigenen Anträge). Nutzt den
// gemeinsamen Zeitraum aus dem Hub-Kopf statt eines eigenen Monat/Jahr-
// Umschalters, und die Feriensaldi aus den ohnehin schon geladenen
// Team-Daten (data.members[].feriensaldo) statt eines zweiten /api/team-
// Aufrufs (vorher in app/(app)/absences/page.tsx fetchCalendar()).

import { useCallback, useEffect, useState } from "react";
import { Check, X, Users } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { AbsenceYearOverview, type Feriensaldo } from "@/components/absence-year-overview";
import { TYPE_COLOR } from "@/lib/absence-colors";
import type { PeriodValue } from "@/lib/period";
import { periodQuery } from "@/lib/period";
import type { TeamData } from "@/components/team/types";

interface AbsenceRequestRow {
  id: string;
  userId: string;
  name?: string;
  fromDate: string;
  toDate: string;
  type: string;
  status: "offen" | "genehmigt" | "abgelehnt";
  comment: string | null;
}

interface CalendarMember {
  userId: string;
  name: string;
  days: Array<{ date: string; type: string | null }>;
}

interface AbsenceRangeRow {
  userId: string;
  name: string;
  type: string;
  from: string;
  to: string;
  days: number;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}
function fmtDayMonth(d: string): string {
  const [, m, day] = d.split("-");
  return `${day}.${m}.`;
}

export function AbsencesTab({ data, period, onPendingCountChange }: { data: TeamData; period: PeriodValue; onPendingCountChange?: (n: number) => void }) {
  const { t } = useI18n();

  const [teamRequests, setTeamRequests] = useState<AbsenceRequestRow[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const [calendarDays, setCalendarDays] = useState<string[]>([]);
  const [calendarMembers, setCalendarMembers] = useState<CalendarMember[]>([]);
  const [calendarRanges, setCalendarRanges] = useState<AbsenceRangeRow[]>([]);
  const [dayWarning, setDayWarning] = useState<Record<string, boolean>>({});
  const [teamSize, setTeamSize] = useState(0);

  const fetchTeamRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/absence-requests?scope=team");
      if (res?.ok) {
        const d = await res?.json?.().catch(() => ({}));
        const requests: AbsenceRequestRow[] = d?.requests ?? [];
        setTeamRequests(requests);
        onPendingCountChange?.(requests.filter((r) => r.status === "offen").length);
      }
    } catch (err: any) { console.error(err); }
  }, [onPendingCountChange]);

  const fetchCalendar = useCallback(async () => {
    try {
      const res = await fetch(`/api/absences/calendar?${periodQuery(period)}`);
      if (res?.ok) {
        const d = await res?.json?.().catch(() => ({}));
        setCalendarDays(d?.days ?? []);
        setCalendarMembers(d?.members ?? []);
        setCalendarRanges(d?.ranges ?? []);
        setDayWarning(d?.dayWarning ?? {});
        setTeamSize(d?.teamSize ?? 0);
      }
    } catch (err: any) { console.error(err); }
  }, [period]);

  useEffect(() => { fetchTeamRequests(); }, [fetchTeamRequests]);
  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setDecidingId(id);
    try {
      const res = await fetch("/api/absence-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const resData = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        if (action === "approve") {
          toast.success(t("absences.approvedResult", { created: String(resData?.entries?.created ?? 0), skipped: String(resData?.entries?.skipped ?? 0) }));
        } else {
          toast.success(t("absences.rejected"));
        }
        await fetchTeamRequests();
        await fetchCalendar();
      } else {
        toast.error(resData?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setDecidingId(null); }
  };

  const feriensaldi: Record<string, Feriensaldo> = {};
  for (const m of data.members) feriensaldi[m.userId] = m.feriensaldo;

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3">{t("absences.toApprove")}</h2>
        {teamRequests.filter((r) => r.status === "offen").length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("absences.noOpenRequests")}</p>
        ) : (
          <div className="space-y-1.5">
            {teamRequests.filter((r) => r.status === "offen").map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-secondary/60 rounded-xl px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-muted-foreground text-xs">— {t(`calendar.type.${r.type}`)}, {fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
                  {r.comment && <p className="text-xs text-muted-foreground mt-0.5">{r.comment}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => decide(r.id, "approve")} disabled={decidingId === r.id} className="p-1.5 rounded-lg text-green-600 hover:bg-green-500/10 transition disabled:opacity-50" title={t("absences.approve")}>
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => decide(r.id, "reject")} disabled={decidingId === r.id} className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 transition disabled:opacity-50" title={t("absences.reject")}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> {t("absences.teamCalendar")}</h2>
        <p className="text-xs text-muted-foreground mb-3">
          {period.type === "year" ? t("absences.teamCalendarHintYear", { year: String(period.year), teamSize: String(teamSize) }) : t("absences.teamCalendarHint", { teamSize: String(teamSize) })}
        </p>
        {calendarMembers.length === 0 || calendarDays.length === 0 ? (
          <p className="text-xs text-muted-foreground">{period.type === "year" ? t("absences.noAbsencesYear") : t("absences.noAbsences")}</p>
        ) : period.type === "year" ? (
          <AbsenceYearOverview members={calendarMembers} feriensaldi={feriensaldi} typeColor={TYPE_COLOR} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-xs border-separate" style={{ borderSpacing: "3px" }}>
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pr-2 sticky left-0 bg-card">{t("teamsicht.colName")}</th>
                    {calendarDays.map((date) => (
                      <th key={date} className={`font-medium px-1 whitespace-nowrap ${dayWarning[date] ? "text-red-600" : "text-muted-foreground"}`} title={dayWarning[date] ? t("absences.warningHint") : undefined}>
                        {fmtDayMonth(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendarMembers.map((member) => (
                    <tr key={member.userId}>
                      <td className="text-left pr-2 font-medium whitespace-nowrap sticky left-0 bg-card">{member.name}</td>
                      {member.days.map((cell) => (
                        <td
                          key={cell.date}
                          className={`w-6 h-6 rounded-md ${cell.type ? TYPE_COLOR[cell.type] ?? "bg-muted-foreground/30" : "bg-secondary/40"} ${dayWarning[cell.date] ? "ring-2 ring-red-400" : ""}`}
                          title={cell.type ? `${member.name}, ${fmtDate(cell.date)}: ${t(`calendar.type.${cell.type}`)}` : undefined}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
              {Object.entries(TYPE_COLOR).map(([typ, cls]) => (
                <span key={typ} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${cls}`} /> {t(`calendar.type.${typ}`)}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-red-400" /> {t("absences.warningHint")}
              </span>
            </div>

            {calendarRanges.length > 0 && (
              <div className="space-y-1 mt-3 pt-3 border-t border-border/50">
                {calendarRanges.map((r) => (
                  <div key={`${r.userId}-${r.type}-${r.from}`} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_COLOR[r.type] ?? "bg-muted-foreground/30"}`} />
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">
                      {r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`} · {t(`calendar.type.${r.type}`)} · {r.days} {r.days === 1 ? t("absences.dayOne") : t("absences.dayMany")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
