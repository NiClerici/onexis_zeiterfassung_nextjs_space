"use client";

// Team-Hub — ein Menüpunkt statt der beiden bisherigen, kaum unterscheidbaren
// Einträge "Teamsicht" (Kennzahlen) und "Team" (Mitgliederverwaltung, nur
// admin/owner). Vier Tabs bündeln, was vorher über /team, /admin/team und
// den Team-Teil von /absences verstreut war (siehe Plan
// "die-team-ansicht-f-r-majestic-lighthouse.md").

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Users, Download, Lock, Unlock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PeriodPicker } from "@/components/team/period-picker";
import { OverviewTab } from "@/components/team/overview-tab";
import { CustomersTab } from "@/components/team/customers-tab";
import { AbsencesTab } from "@/components/team/absences-tab";
import { AdminTab } from "@/components/team/admin-tab";
import type { TeamData } from "@/components/team/types";
import { defaultPeriod, periodQuery, type PeriodValue } from "@/lib/period";

type TabKey = "uebersicht" | "kunden" | "absenzen" | "verwaltung";

function TeamHubInner() {
  const { t } = useI18n();
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const role = (session?.user as any)?.role;
  const ownUserId = (session?.user as any)?.id;
  const allowed = role === "owner" || role === "admin" || role === "manager";
  const isAdmin = role === "owner" || role === "admin";

  const initialTab = (searchParams?.get?.("tab") as TabKey) ?? "uebersicht";
  const [tab, setTab] = useState<TabKey>(initialTab === "verwaltung" && !isAdmin ? "uebersicht" : initialTab);
  const [focusUserId, setFocusUserId] = useState<string | null>(searchParams?.get?.("member") ?? null);

  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod());
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [exportingOrg, setExportingOrg] = useState(false);
  const [exportingUserId, setExportingUserId] = useState<string | null>(null);
  const [lockingTeam, setLockingTeam] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    if (sessionStatus === "authenticated" && role && !allowed) {
      router.replace("/calendar");
    }
  }, [sessionStatus, role, allowed, router]);

  const changeTab = (next: TabKey) => {
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString?.() ?? "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const fetchTeam = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/team?${periodQuery(period)}`);
      if (res?.ok) {
        const d = await res?.json?.().catch(() => null);
        setData(d ?? null);
      } else {
        setError(true);
      }
    } catch (err: any) { console.error(err); setError(true); } finally { setLoading(false); }
  }, [allowed, period]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleExportOrg = async () => {
    setExportingOrg(true);
    try {
      const res = await fetch(`/api/export?${periodQuery(period)}&scope=org`);
      if (res?.ok) {
        const blob = await res?.blob?.();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob ?? new Blob());
        a.download = `team_export_${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        toast.error(t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setExportingOrg(false); }
  };

  const handleExportMember = async (userId: string) => {
    setExportingUserId(userId);
    try {
      const res = await fetch(`/api/export?${periodQuery(period)}&scope=person&userId=${userId}`);
      if (res?.ok) {
        const blob = await res?.blob?.();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob ?? new Blob());
        a.download = `zeiterfassung_export_${userId}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        toast.error(t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setExportingUserId(null); }
  };

  const handleOpenAdmin = (userId: string) => {
    setFocusUserId(userId);
    changeTab("verwaltung");
  };

  // "Monat für Team abschliessen" — sperrt alle aktuell sichtbaren
  // Mitglieder für den gewählten Monat auf einmal. Nutzt denselben Endpoint
  // wie die Einzelsperre in der Verwaltung (app/api/month-locks/route.ts),
  // nur einmal je sichtbarer Person statt einer eigenen Batch-Route.
  const allLocked = data ? data.members.every((m) => m.monthLocked === true) : false;
  const handleToggleTeamLock = async () => {
    if (!data?.monthLock) return;
    setLockingTeam(true);
    const method = allLocked ? "DELETE" : "POST";
    try {
      const results = await Promise.all(
        data.members.map((m) =>
          fetch("/api/month-locks", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: m.userId, year: data.monthLock!.year, month: data.monthLock!.month }),
          })
        )
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) toast.error(t("team.monthLockTeamPartial", { failed: String(failed) }));
      else toast.success(allLocked ? t("team.monthUnlocked") : t("team.monthLocked"));
      await fetchTeam();
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setLockingTeam(false); }
  };

  if (sessionStatus === "loading" || (role && !allowed)) return null;

  return (
    <div className="space-y-4 pb-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-display font-semibold tracking-tight flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> {t("nav.team")}</h1>
      </motion.div>

      <div className="bg-card rounded-2xl p-4 flex items-start justify-between flex-wrap gap-3" style={{ boxShadow: "var(--shadow-sm)" }}>
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2 flex-wrap">
          {data?.monthLock && (
            <button
              onClick={handleToggleTeamLock}
              disabled={lockingTeam}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-accent transition disabled:opacity-50"
            >
              {allLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {lockingTeam ? t("common.loading") : allLocked ? t("team.monthUnlockTeamButton") : t("team.monthLockTeamButton")}
            </button>
          )}
          <button onClick={handleExportOrg} disabled={exportingOrg} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-accent transition disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {exportingOrg ? t("common.loading") : t("teamsicht.exportButton")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t("common.loading")}</div>
      ) : error ? (
        <div className="bg-card rounded-2xl p-6 text-center space-y-3" style={{ boxShadow: "var(--shadow-sm)" }}>
          <AlertTriangle className="w-6 h-6 text-red-500 mx-auto" />
          <p className="text-sm text-muted-foreground">{t("team.errorLoading")}</p>
          <button onClick={fetchTeam} className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition">{t("team.retry")}</button>
        </div>
      ) : !data ? null : (
        <Tabs value={tab} onValueChange={(v) => changeTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="uebersicht">{t("team.tabOverview")}</TabsTrigger>
            <TabsTrigger value="kunden">{t("team.tabCustomers")}</TabsTrigger>
            <TabsTrigger value="absenzen">
              {t("team.tabAbsences")}
              {pendingApprovals > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] leading-none">{pendingApprovals}</span>}
            </TabsTrigger>
            {isAdmin && <TabsTrigger value="verwaltung">{t("team.tabAdmin")}</TabsTrigger>}
          </TabsList>

          <TabsContent value="uebersicht">
            <OverviewTab data={data} isAdmin={isAdmin} onExportMember={handleExportMember} exportingUserId={exportingUserId} onOpenAdmin={isAdmin ? handleOpenAdmin : undefined} onDatesSaved={fetchTeam} />
          </TabsContent>
          <TabsContent value="kunden">
            <CustomersTab data={data} />
          </TabsContent>
          <TabsContent value="absenzen">
            <AbsencesTab data={data} period={period} onPendingCountChange={setPendingApprovals} />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="verwaltung">
              <AdminTab role={role} ownUserId={ownUserId} focusUserId={focusUserId} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

export default function TeamHubPage() {
  return (
    <Suspense fallback={null}>
      <TeamHubInner />
    </Suspense>
  );
}
