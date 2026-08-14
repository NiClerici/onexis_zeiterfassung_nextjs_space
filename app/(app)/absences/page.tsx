"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { CalendarOff, Check, X, Trash2, AlertTriangle, Users } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

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

interface CalendarDay {
  date: string;
  absent: Array<{ userId: string; name: string; type: string }>;
  warning: boolean;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
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

  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; });
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [teamSize, setTeamSize] = useState(0);

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
      const [y, m] = calMonth.split("-");
      const res = await fetch(`/api/absences/calendar?type=month&year=${y}&month=${m}`);
      if (res?.ok) {
        const d = await res?.json?.().catch(() => ({}));
        setCalendarDays(d?.days ?? []);
        setTeamSize(d?.teamSize ?? 0);
      }
    } catch (err: any) { console.error(err); }
  }, [isTeamLead, calMonth]);

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
              <input type="month" value={calMonth} onChange={(e) => setCalMonth(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t("absences.teamCalendarHint", { teamSize: String(teamSize) })}</p>
            {calendarDays.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("absences.noAbsences")}</p>
            ) : (
              <div className="space-y-1.5">
                {calendarDays.map((d) => (
                  <div key={d.date} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${d.warning ? "bg-red-50 dark:bg-red-950/20" : "bg-secondary/60"}`}>
                    {d.warning && <span title={t("absences.warningHint")}><AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" /></span>}
                    <div>
                      <span className="font-medium">{fmtDate(d.date)}</span>{" "}
                      <span className="text-xs text-muted-foreground">({d.absent.length}/{teamSize})</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {d.absent.map((a, i) => (
                          <span key={`${a.userId}-${i}`} className="text-xs px-2 py-0.5 rounded-full bg-card">{a.name} · {t(`calendar.type.${a.type}`)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
