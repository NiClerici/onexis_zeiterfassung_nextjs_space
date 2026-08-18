"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, UserPlus, ChevronDown, ChevronUp, Trash2, TrendingUp, Lock, Unlock, Copy, Check, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface Member {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  managerId: string | null;
  entryDate: string;
  exitDate: string | null;
  weeklyHours: number;
  pensum: number;
  vacationDays: number;
  startDate: string | null;
  standardWeek: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number };
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

interface PensumChange {
  id: string;
  pensum: number;
  weeklyHours: number;
  effectiveFrom: string;
}

interface MonthLockRow {
  id: string;
  year: number;
  month: number;
  lockedAt: string;
  lockedBy: string;
}

const ROLE_OPTIONS = ["owner", "admin", "manager", "member"];
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", member: "Mitglied" };

function fmtDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

export default function TeamPage() {
  const { t } = useI18n();
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const ownUserId = (session?.user as any)?.id;

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  const [pensumByUser, setPensumByUser] = useState<Record<string, PensumChange[]>>({});
  const [newPensum, setNewPensum] = useState("");
  const [newWeeklyHours, setNewWeeklyHours] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [savingPensum, setSavingPensum] = useState(false);

  // Monatsabschluss (MIGRATION.md Punkt 6e)
  const [monthLocksByUser, setMonthLocksByUser] = useState<Record<string, MonthLockRow[]>>({});
  const now = new Date();
  const [lockYear, setLockYear] = useState(String(now.getFullYear()));
  const [lockMonth, setLockMonth] = useState(String(now.getMonth() + 1));
  const [lockingMonth, setLockingMonth] = useState(false);

  useEffect(() => {
    if (sessionStatus === "authenticated" && role && role !== "owner" && role !== "admin") {
      router.replace("/calendar");
    }
  }, [sessionStatus, role, router]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/team");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setMembers(data?.members ?? []);
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await fetch("/api/invitations");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setInvitations(data?.invitations ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  useEffect(() => {
    if (role === "owner" || role === "admin") {
      fetchMembers();
      fetchInvitations();
    }
  }, [role, fetchMembers, fetchInvitations]);

  const fetchPensumChanges = async (userId: string) => {
    try {
      const res = await fetch(`/api/pensum-changes?userId=${userId}`);
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setPensumByUser((prev) => ({ ...prev, [userId]: data?.changes ?? [] }));
      }
    } catch (err: any) { console.error(err); }
  };

  const fetchMonthLocks = async (userId: string) => {
    try {
      const res = await fetch(`/api/month-locks?userId=${userId}`);
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setMonthLocksByUser((prev) => ({ ...prev, [userId]: data?.locks ?? [] }));
      }
    } catch (err: any) { console.error(err); }
  };

  const toggleExpand = (userId: string) => {
    if (expandedUserId === userId) { setExpandedUserId(null); return; }
    setExpandedUserId(userId);
    if (!pensumByUser[userId]) fetchPensumChanges(userId);
    if (!monthLocksByUser[userId]) fetchMonthLocks(userId);
  };

  const submitMonthLock = async (userId: string) => {
    if (!lockYear || !lockMonth) return;
    setLockingMonth(true);
    try {
      const res = await fetch("/api/month-locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, year: parseInt(lockYear), month: parseInt(lockMonth) }),
      });
      if (res?.ok) {
        toast.success(t("team.monthLocked"));
        await fetchMonthLocks(userId);
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setLockingMonth(false); }
  };

  const unlockMonth = async (userId: string, year: number, month: number) => {
    try {
      const res = await fetch("/api/month-locks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, year, month }),
      });
      if (res?.ok) { toast.success(t("team.monthUnlocked")); await fetchMonthLocks(userId); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); }
  };

  const updateMember = async (userId: string, patch: Record<string, any>) => {
    try {
      const res = await fetch("/api/admin/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        await fetchMembers();
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); }
  };

  const sendInvite = async () => {
    if (!inviteEmail?.trim?.()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        toast.success(t("team.inviteSent"));
        if (data?.inviteUrl) {
          setInviteLinkCopied(false);
          setInviteLink({ email: inviteEmail.trim(), url: data.inviteUrl });
        }
        setInviteEmail("");
        await fetchInvitations();
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setInviting(false); }
  };

  // "Link neu erzeugen" für eine bestehende Einladung: ruft dieselbe Route
  // erneut mit E-Mail + Rolle der bestehenden Einladung auf. Die Route
  // entwertet dabei die alte Einladung selbst (siehe app/api/invitations/
  // route.ts) — der bisherige Link ist danach ungültig, nur der neue zählt.
  const regenerateInvite = async (inv: InvitationRow) => {
    setRegeneratingId(inv.id);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        setInviteLinkCopied(false);
        setInviteLink({ email: inv.email, url: data?.inviteUrl });
        await fetchInvitations();
      } else {
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setRegeneratingId(null); }
  };

  const copyInviteLink = async () => {
    if (!inviteLink?.url) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setInviteLinkCopied(true);
    } catch (err) { console.error(err); toast.error(t("profile.error")); }
  };

  const revokeInvite = async (id: string) => {
    try {
      const res = await fetch("/api/invitations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) { toast.success(t("team.inviteRevoked")); await fetchInvitations(); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); }
  };

  const addPensumChange = async (userId: string) => {
    if (!newPensum || !newWeeklyHours || !effectiveFrom) { toast.error(t("profile.error")); return; }
    setSavingPensum(true);
    try {
      const res = await fetch("/api/pensum-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pensum: parseFloat(newPensum), weeklyHours: parseFloat(newWeeklyHours), effectiveFrom }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        setNewPensum(""); setNewWeeklyHours(""); setEffectiveFrom("");
        await fetchPensumChanges(userId);
        await fetchMembers();
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSavingPensum(false); }
  };

  const deletePensumChange = async (userId: string, id: string) => {
    try {
      const res = await fetch("/api/pensum-changes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) { await fetchPensumChanges(userId); await fetchMembers(); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); }
  };

  if (sessionStatus === "loading" || (role && role !== "owner" && role !== "admin")) return null;

  return (
    <div className="space-y-4 pb-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> {t("team.invite")}</h2>
        {/* HARDENING.md C2: E-Mail-Feld + Rollen-Select + Button liefen bei
            375px auf ~407px über den Viewport — dieselbe fehlende
            flex-wrap wie bei der Kunde-hinzufügen-Zeile in profile/page.tsx. */}
        <div className="flex flex-wrap gap-2">
          <input aria-label={t("login.email")} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={t("login.emailPlaceholder")} className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          <select aria-label={t("team.role")} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition">
            {ROLE_OPTIONS.filter((r) => r !== "owner" || role === "owner").filter((r) => r !== "owner").map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <button onClick={sendInvite} disabled={inviting || !inviteEmail?.trim?.()} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
            {inviting ? t("common.loading") : t("team.inviteSubmit")}
          </button>
        </div>
        {invitations.filter((i) => i.status === "ausstehend").length > 0 && (
          <div className="mt-3 space-y-1.5">
            {invitations.filter((i) => i.status === "ausstehend").map((inv) => (
              <div key={inv.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm">
                <span>{inv.email} <span className="text-muted-foreground text-xs">({ROLE_LABELS[inv.role] ?? inv.role})</span></span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => regenerateInvite(inv)}
                    disabled={regeneratingId === inv.id}
                    title={t("team.inviteRegenerate")}
                    className="p-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${regeneratingId === inv.id ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => revokeInvite(inv.id)} className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> {t("team.members")}</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const isExpanded = expandedUserId === m.userId;
              const isSelf = m.userId === ownUserId;
              return (
                <div key={m.userId} className="border border-border/50 rounded-xl overflow-hidden">
                  <button onClick={() => toggleExpand(m.userId)} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition">
                    <div>
                      <div className="text-sm font-medium">{m.firstName} {m.lastName} {isSelf && <span className="text-xs text-muted-foreground">({t("team.you")})</span>}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${m.status === "aktiv" ? "bg-green-500/10 text-green-600" : "bg-secondary text-muted-foreground"}`}>{m.status}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{ROLE_LABELS[m.role] ?? m.role}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/50 p-3 space-y-3 bg-secondary/30">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`role-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.role")}</label>
                          <select
                            id={`role-${m.userId}`}
                            value={m.role}
                            disabled={role !== "owner" && m.role === "owner"}
                            onChange={(e) => updateMember(m.userId, { role: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          >
                            {ROLE_OPTIONS.filter((r) => r !== "owner" || role === "owner").map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`status-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.status")}</label>
                          <select
                            id={`status-${m.userId}`}
                            value={m.status}
                            disabled={isSelf}
                            onChange={(e) => updateMember(m.userId, { status: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          >
                            <option value="aktiv">{t("team.statusActive")}</option>
                            <option value="inaktiv">{t("team.statusInactive")}</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`manager-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.manager")}</label>
                          <select
                            id={`manager-${m.userId}`}
                            value={m.managerId ?? ""}
                            onChange={(e) => updateMember(m.userId, { managerId: e.target.value || null })}
                            className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          >
                            <option value="">{t("team.noManager")}</option>
                            {members.filter((x) => x.membershipId !== m.membershipId).map((x) => (
                              <option key={x.membershipId} value={x.membershipId}>{x.firstName} {x.lastName}</option>
                            ))}
                          </select>
                        </div>
                        <div />
                        <div>
                          <label htmlFor={`entry-date-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.entryDate")}</label>
                          <input id={`entry-date-${m.userId}`} type="date" defaultValue={fmtDate(m.entryDate)} onBlur={(e) => e.target.value && updateMember(m.userId, { entryDate: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                        </div>
                        <div>
                          <label htmlFor={`exit-date-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.exitDate")}</label>
                          <input id={`exit-date-${m.userId}`} type="date" defaultValue={fmtDate(m.exitDate)} onBlur={(e) => updateMember(m.userId, { exitDate: e.target.value || null })} className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/50">
                        <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> {t("profile.pensumChange")}</h3>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div>
                            <label htmlFor={`pensum-effective-from-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("profile.effectiveFrom")}</label>
                            <input id={`pensum-effective-from-${m.userId}`} type="date" value={isExpanded ? effectiveFrom : ""} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                          </div>
                          <div>
                            <label htmlFor={`new-pensum-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("profile.newPensum")}</label>
                            <input id={`new-pensum-${m.userId}`} type="number" value={newPensum} onChange={(e) => setNewPensum(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                          </div>
                          <div>
                            <label htmlFor={`new-weekly-hours-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("profile.newWeeklyHours")}</label>
                            <input id={`new-weekly-hours-${m.userId}`} type="number" value={newWeeklyHours} onChange={(e) => setNewWeeklyHours(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                          </div>
                        </div>
                        <button onClick={() => addPensumChange(m.userId)} disabled={savingPensum} className="w-full py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition disabled:opacity-50 mb-2">
                          {savingPensum ? t("common.loading") : t("profile.addPensumChange")}
                        </button>
                        {(pensumByUser[m.userId]?.length ?? 0) > 0 ? (
                          <div className="space-y-1">
                            {pensumByUser[m.userId].map((pc) => (
                              <div key={pc.id} className="flex items-center justify-between bg-card rounded-lg px-2 py-1.5 text-xs">
                                <span>{fmtDate(pc.effectiveFrom)}: {pc.pensum}% / {pc.weeklyHours}h</span>
                                <button onClick={() => deletePensumChange(m.userId, pc.id)} className="text-muted-foreground hover:text-destructive transition"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("profile.noPensumChanges")}</p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-border/50">
                        <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> {t("team.monthLock")}</h3>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div>
                            <label htmlFor={`lock-year-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.monthLockYear")}</label>
                            <input id={`lock-year-${m.userId}`} type="number" value={isExpanded ? lockYear : ""} onChange={(e) => setLockYear(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                          </div>
                          <div>
                            <label htmlFor={`lock-month-${m.userId}`} className="text-xs text-muted-foreground mb-1 block">{t("team.monthLockMonth")}</label>
                            <select id={`lock-month-${m.userId}`} value={isExpanded ? lockMonth : ""} onChange={(e) => setLockMonth(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition">
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                                <option key={mo} value={mo}>{t(`month.${mo}`)}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-end">
                            <button onClick={() => submitMonthLock(m.userId)} disabled={lockingMonth} className="w-full py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition disabled:opacity-50">
                              {lockingMonth ? t("common.loading") : t("team.monthLockSubmit")}
                            </button>
                          </div>
                        </div>
                        {(monthLocksByUser[m.userId]?.length ?? 0) > 0 ? (
                          <div className="space-y-1">
                            {monthLocksByUser[m.userId].map((lock) => (
                              <div key={lock.id} className="flex items-center justify-between bg-card rounded-lg px-2 py-1.5 text-xs">
                                <span className="flex items-center gap-1.5"><Lock className="w-3 h-3 text-amber-600" /> {t(`month.${lock.month}`)} {lock.year}</span>
                                <button onClick={() => unlockMonth(m.userId, lock.year, lock.month)} className="flex items-center gap-1 text-muted-foreground hover:text-primary transition" title={t("team.monthUnlock")}>
                                  <Unlock className="w-3 h-3" /> {t("team.monthUnlock")}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("team.noMonthLocks")}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      <Dialog open={Boolean(inviteLink)} onOpenChange={(open) => { if (!open) setInviteLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.inviteLinkTitle", { email: inviteLink?.email ?? "" })}</DialogTitle>
            <DialogDescription>{t("team.inviteLinkDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl bg-secondary text-xs">{inviteLink?.url}</code>
            <button
              onClick={copyInviteLink}
              className="shrink-0 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center gap-1.5"
            >
              {inviteLinkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {inviteLinkCopied ? t("team.inviteLinkCopied") : t("team.inviteLinkCopy")}
            </button>
          </div>
          <DialogFooter>
            <button onClick={() => setInviteLink(null)} className="px-4 py-2 rounded-xl bg-secondary text-sm font-medium hover:opacity-80 transition">
              {t("team.inviteLinkClose")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
