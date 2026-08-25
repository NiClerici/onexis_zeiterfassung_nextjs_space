"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { CalendarOff, Check, X, Trash2, Users } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { AbsenceYearOverview, type Feriensaldo } from "@/components/absence-year-overview";

const ABSENCE_TYPES = ["ferien", "krank", "militaer", "unbezahlt"] as const;

interface AbsenceRequestRow {
  id: string;
  userId: string;
  name?: string;
  fromDate: string;
  toDate: string;
  type: string;
  status: "offen" | "genehmigt" | "abgelehnt";
  comment: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// Raster statt Datumsliste (HARDENING.md C7c) — dieselbe Form wie die
// Teamsicht-Heatmap: eine dichte Tagesliste als Spaltenköpfe, pro Person
// eine Zeile mit einer darauf ausgerichteten Zell-Liste.
interface CalendarMember {
  userId: string;
  name: string;
  days: Array<{ date: string; type: string | null }>;
}

// Zusammengefasste Bereiche (HARDENING.md C7b, lib/absence-ranges.ts) für
// eine kompakte, exakt lesbare Liste neben dem Raster.
interface AbsenceRangeRow {
  userId: string;
  name: string;
  type: string;
  from: string;
  to: string;
  days: number;
}

// Dieselben Farben wie im persönlichen Kalender (app/(app)/calendar/
// page.tsx TYPE_DOT_COLOR) — eine Absenzfarbe bedeutet in der ganzen App
// dasselbe (HARDENING.md C1).
const TYPE_CELL_COLOR: Record<string, string> = {
  ferien: "bg-sky-400",
  krank: "bg-red-400",
  militaer: "bg-orange-400",
  unbezahlt: "bg-gray-400",
};

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function fmtDayMonth(d: string): string {
  const [, m, day] = d.split("-");
  return `${day}.${m}.`;
}

function statusBadgeClass(status: string): string {
  if (status === "genehmigt") return "bg-green-500/10 text-green-600";
  if (status === "abgelehnt") return "bg-red-500/10 text-red-600";
  return "bg-secondary text-muted-foreground";
}

export default function AbsencesPage() {
  const { t } = useI18n();
  const { data: session } = useSession() || {};
  const role = (session?.user as any)?.role;
  const isTeamLead = role === "owner" || role === "admin" || role === "manager";

  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newType, setNewType] = useState<string>("ferien");
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [myRequests, setMyRequests] = useState<AbsenceRequestRow[]>([]);
  const [teamRequests, setTeamRequests] = useState<AbsenceRequestRow[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const [calPeriod, setCalPeriod] = useState<"month" | "year">("month");
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; });
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calendarDays, setCalendarDays] = useState<string[]>([]);
  const [calendarMembers, setCalendarMembers] = useState<CalendarMember[]>([]);
  const [calendarRanges, setCalendarRanges] = useState<AbsenceRangeRow[]>([]);
  const [dayWarning, setDayWarning] = useState<Record<string, boolean>>({});
  const [teamSize, setTeamSize] = useState(0);
  const [feriensaldi, setFeriensaldi] = useState<Record<string, Feriensaldo>>({});

  const fetchMine = useCallback(async () => {
    try {
      const res = await fetch("/api/absence-requests?scope=mine");
      if (res?.ok) { const d = await res?.json?.().catch(() => ({})); setMyRequests(d?.requests ?? []); }
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchTeam = useCallback(async () => {
    if (!isTeamLead) return;
    try {
      const res = await fetch("/api/absence-requests?scope=team");
      if (res?.ok) { const d = await res?.json?.().catch(() => ({})); setTeamRequests(d?.requests ?? []); }
    } catch (err: any) { console.error(err); }
  }, [isTeamLead]);

  const fetchCalendar = useCallback(async () => {
    if (!isTeamLead) return;
    try {
      const rangeQuery = calPeriod === "year" ? `type=year&year=${calYear}` : (() => { const [y, m] = calMonth.split("-"); return `type=month&year=${y}&month=${m}`; })();
      const requests: Promise<Response>[] = [fetch(`/api/absences/calendar?${rangeQuery}`)];
      // Ferienbilanz (Anspruch/Bezogen/Geplant/Offen) kommt aus derselben
      // Berechnung wie die Teamsicht (feriensaldo() in lib/calc.ts) — für
      // die Jahresansicht zusätzlich abgefragt, damit man Abwesenheiten und
      // verbleibende Ferientage auf einen Blick sieht.
      if (calPeriod === "year") requests.push(fetch(`/api/team?type=year&year=${calYear}`));
      const [calRes, teamRes] = await Promise.all(requests);
      if (calRes?.ok) {
        const d = await calRes?.json?.().catch(() => ({}));
        setCalendarDays(d?.days ?? []);
        setCalendarMembers(d?.members ?? []);
        setCalendarRanges(d?.ranges ?? []);
        setDayWarning(d?.dayWarning ?? {});
        setTeamSize(d?.teamSize ?? 0);
      }
      if (teamRes?.ok) {
        const d = await teamRes?.json?.().catch(() => ({}));
        const byUser: Record<string, Feriensaldo> = {};
        for (const m of d?.members ?? []) byUser[m.userId] = m.feriensaldo;
        setFeriensaldi(byUser);
      }
    } catch (err: any) { console.error(err); }
  }, [isTeamLead, calPeriod, calMonth, calYear]);

  useEffect(() => { fetchMine(); }, [fetchMine]);
  useEffect(() => { fetchTeam(); }, [fetchTeam]);
  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  const submitRequest = async () => {
    if (!newFrom || !newTo) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/absence-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: newFrom, toDate: newTo, type: newType, comment: newComment.trim() || undefined }),
      });
      if (res?.ok) {
        toast.success(t("absences.requestSubmitted"));
        setNewFrom(""); setNewTo(""); setNewComment("");
        await fetchMine();
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSubmitting(false); }
  };

  const withdrawRequest = async (id: string) => {
    try {
      const res = await fetch("/api/absence-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) { toast.success(t("absences.withdrawn")); await fetchMine(); }
      else { const data = await res?.json?.().catch(() => ({})); toast.error(data?.error ?? t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    setDecidingId(id);
    try {
      const res = await fetch("/api/absence-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        if (action === "approve") {
          toast.success(t("absences.approvedResult", { created: String(data?.entries?.created ?? 0), skipped: String(data?.entries?.skipped ?? 0) }));
        } else {
          toast.success(t("absences.rejected"));
        }
        await fetchTeam();
        await fetchCalendar();
      } else {
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setDecidingId(null); }
  };

  return (
    <div className="space-y-4 pb-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4 flex items-center gap-2"><CalendarOff className="w-5 h-5 text-primary" /> {t("absences.title")}</h1>
      </motion.div>

      {/* Neuer Antrag */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3">{t("absences.newRequest")}</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("absences.from")}</label>
            <input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("absences.to")}</label>
            <input type="date" value={newTo} onChange={(e) => setNewTo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("absences.type")}</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {ABSENCE_TYPES.map((typ) => (
                <option key={typ} value={typ}>{t(`calendar.type.${typ}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("absences.comment")}</label>
            <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder={t("absences.commentPlaceholder")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <button onClick={submitRequest} disabled={submitting || !newFrom || !newTo} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
          {submitting ? t("common.loading") : t("absences.submit")}
        </button>
      </motion.div>

      {/* Meine Anträge */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3">{t("absences.myRequests")}</h2>
        {myRequests.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("absences.noRequests")}</p>
        ) : (
          <div className="space-y-1.5">
            {myRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-secondary/60 rounded-xl px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{t(`calendar.type.${r.type}`)}</span>{" "}
                  <span className="text-muted-foreground text-xs">{fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</span>
                  {r.comment && <p className="text-xs text-muted-foreground mt-0.5">{r.comment}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass(r.status)}`}>{t(`absences.status.${r.status}`)}</span>
                  {r.status === "offen" && (
                    <button onClick={() => withdrawRequest(r.id)} className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition" title={t("absences.withdraw")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {isTeamLead && (
        <>
          {/* Zu genehmigen */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
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
          </motion.div>

          {/* Team-Kalender */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-sm font-display font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> {t("absences.teamCalendar")}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-xl bg-secondary p-0.5 text-xs">
                  {(["month", "year"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCalPeriod(p)}
                      className={`px-3 py-1 rounded-lg font-medium transition ${calPeriod === p ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                    >
                      {t(p === "month" ? "profile.exportMonth" : "profile.exportYear")}
                    </button>
                  ))}
                </div>
                {calPeriod === "month" ? (
                  <MonthYearPicker
                    value={calMonth}
                    onChange={setCalMonth}
                    selectClassName="px-3 py-1.5 rounded-xl bg-secondary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    yearInputClassName="px-3 py-1.5 rounded-xl bg-secondary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                ) : (
                  <input
                    type="number"
                    min="2020"
                    max="2030"
                    value={calYear}
                    onChange={(e) => setCalYear(parseInt(e.target.value) || new Date().getFullYear())}
                    className="px-3 py-1.5 rounded-xl bg-secondary text-xs w-20 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {calPeriod === "year" ? t("absences.teamCalendarHintYear", { year: String(calYear), teamSize: String(teamSize) }) : t("absences.teamCalendarHint", { teamSize: String(teamSize) })}
            </p>
            {calendarMembers.length === 0 || calendarDays.length === 0 ? (
              <p className="text-xs text-muted-foreground">{calPeriod === "year" ? t("absences.noAbsencesYear") : t("absences.noAbsences")}</p>
            ) : calPeriod === "year" ? (
              <AbsenceYearOverview members={calendarMembers} feriensaldi={feriensaldi} typeColor={TYPE_CELL_COLOR} />
            ) : (
              <>
                {/* Raster: Personen als Zeilen, Tage als Spalten — dasselbe
                    Muster wie die Teamsicht-Heatmap (HARDENING.md C7c).
                    overflow-x-auto macht das Raster auf Mobile scrollbar,
                    dasselbe Muster wie die Team-Tabelle (HARDENING.md C2). */}
                <div className="overflow-x-auto">
                  <table className="text-xs border-separate" style={{ borderSpacing: "3px" }}>
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-muted-foreground pr-2 sticky left-0 bg-card">{t("teamsicht.colName")}</th>
                        {calendarDays.map((date) => (
                          <th
                            key={date}
                            className={`font-medium px-1 whitespace-nowrap ${dayWarning[date] ? "text-red-600" : "text-muted-foreground"}`}
                            title={dayWarning[date] ? t("absences.warningHint") : undefined}
                          >
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
                              className={`w-6 h-6 rounded-md ${cell.type ? TYPE_CELL_COLOR[cell.type] ?? "bg-muted-foreground/30" : "bg-secondary/40"} ${dayWarning[cell.date] ? "ring-2 ring-red-400" : ""}`}
                              title={cell.type ? `${member.name}, ${fmtDate(cell.date)}: ${t(`calendar.type.${cell.type}`)}` : undefined}
                            />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Legende — Farbe ist im Raster nie alleiniger Informations-
                    träger (HARDENING.md C6): jede Zelle hat zusätzlich einen
                    Text-Tooltip, hier zusätzlich die Zuordnung Farbe→Text. */}
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
                  {Object.entries(TYPE_CELL_COLOR).map(([typ, cls]) => (
                    <span key={typ} className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-sm ${cls}`} /> {t(`calendar.type.${typ}`)}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-red-400" /> {t("absences.warningHint")}
                  </span>
                </div>

                {/* Zusammengefasste Bereiche (HARDENING.md C7b) — kompakte,
                    exakt lesbare Liste zusätzlich zum Raster: eine Ferienwoche
                    ist hier eine Zeile, nicht fünf. */}
                {calendarRanges.length > 0 && (
                  <div className="space-y-1 mt-3 pt-3 border-t border-border/50">
                    {calendarRanges.map((r) => (
                      <div key={`${r.userId}-${r.type}-${r.from}`} className="flex items-center gap-2 text-xs">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_CELL_COLOR[r.type] ?? "bg-muted-foreground/30"}`} />
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
          </motion.div>
        </>
      )}
    </div>
  );
}
