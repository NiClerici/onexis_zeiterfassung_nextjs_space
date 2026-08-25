"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Calendar, BarChart3, UserCircle, Users, CalendarDays, Gauge, CalendarOff, AlertTriangle, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isTrialExpired } from "@/lib/billing-rules";
import { ThemeToggle } from "@/components/theme-toggle";

const baseTabs = [
  { href: "/calendar", icon: Calendar, labelKey: "nav.calendar" },
  // Absenzanträge (MIGRATION.md Punkt 9) — für jede Rolle, auch admin/owner/
  // manager brauchen Ferien; deshalb in baseTabs statt einer der
  // rollen-gefilterten Listen unten.
  { href: "/absences", icon: CalendarOff, labelKey: "nav.absences" },
  { href: "/analytics", icon: BarChart3, labelKey: "nav.analytics" },
  { href: "/profile", icon: UserCircle, labelKey: "nav.profile" },
];
// Teamsicht (MIGRATION.md Punkt 8) — für owner/admin/manager, im Unterschied
// zur reinen Mitgliederverwaltung (teamTab, /admin/team) rein lesend/
// Kennzahlen-orientiert und deshalb auch für manager freigegeben.
const teamsichtTab = { href: "/team", icon: Gauge, labelKey: "nav.teamsicht" };
const teamTab = { href: "/admin/team", icon: Users, labelKey: "nav.team" };
const holidaysTab = { href: "/admin/holidays", icon: CalendarDays, labelKey: "nav.holidays" };
const legalTab = { href: "/admin/legal", icon: ShieldAlert, labelKey: "nav.legal" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  // Bestandsnutzer nach der Migration von Vorname+Code auf E-Mail+Passwort:
  // vor jedem anderen Inhalt zum Setzen eines neuen, richtlinienkonformen
  // Passworts zwingen (MIGRATION.md Punkt 2).
  const mustSetPassword = (session?.user as any)?.mustSetPassword;
  const role = (session?.user as any)?.role;
  const plan = (session?.user as any)?.plan;
  const trialEndsAt = (session?.user as any)?.trialEndsAt;
  const trialExpired = isTrialExpired(plan, trialEndsAt);
  const trialEndsAtDate = trialEndsAt ? new Date(trialEndsAt) : null;
  const tabs =
    role === "owner" || role === "admin"
      ? [...baseTabs, teamsichtTab, teamTab, holidaysTab, legalTab]
      : role === "manager"
      ? [...baseTabs, teamsichtTab]
      : baseTabs;

  // router.replace() darf nicht während des Renderns aufgerufen werden — das
  // löst eine setState-Kaskade in einer fremden Komponente (dem Router) aus
  // (React-Warnung "Cannot update a component while rendering a different
  // component"). Beide Redirects gehören deshalb in einen Effect, nicht in
  // den Render-Pfad selbst.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (mustSetPassword && pathname !== "/set-password") {
      router.replace("/set-password");
    }
  }, [status, mustSetPassword, pathname, router]);

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]"><div className="animate-pulse text-muted-foreground text-sm">{t("common.loading")}</div></div>;
  }
  if (status === "unauthenticated") return null;
  if (mustSetPassword && pathname !== "/set-password") return null;

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex flex-col">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* dark:brightness-0 dark:invert faerbt das dunkelgraue Logo-PNG im
              Dark Mode einfarbig weiss (das tuerkise X geht dabei bewusst
              verloren) — sonst wäre der dunkelgraue Text auf dunklem
              Hintergrund fast unsichtbar. */}
          <div className="relative w-24 h-8"><Image src="/logo-onexis.png" alt="ONEXIS" fill className="object-contain object-left dark:brightness-0 dark:invert" /></div>
          <div className="flex items-center gap-1">
            <nav className="hidden sm:flex items-center gap-1">
              {tabs?.map?.((tab: any) => { const Icon = tab?.icon; const isActive = pathname?.startsWith?.(tab?.href); return (<Link key={tab?.href} href={tab?.href} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>{Icon && <Icon className="w-4 h-4" />}{t(tab?.labelKey ?? "")}</Link>); })}
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {/* Trial-Hinweis (MIGRATION.md Punkt 12) — sichtbar für alle Rollen,
          da der Schreibschutz die ganze Organisation betrifft, nicht nur
          admin/owner. */}
      {plan === "trial" && (
        <div className={cn("px-4 py-2 text-xs text-center", trialExpired ? "bg-red-50 text-red-800 dark:bg-red-950/30" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30")}>
          {trialExpired ? (
            <span className="flex items-center justify-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {t("billing.trialExpired")}</span>
          ) : trialEndsAtDate ? (
            <span>{t("billing.trialActive", { date: trialEndsAtDate.toLocaleDateString("de-CH") })}</span>
          ) : null}
        </div>
      )}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 pb-20 sm:pb-4">{children}</main>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border/50 safe-area-pb">
        {/* HARDENING.md C2: bei 8 Tabs (owner/admin) ergab justify-around
            ohne Scroll-Möglichkeit ~520px Breite in 375px Viewport —
            "Feiertage"/"Rechtliches" liefen über den rechten Rand hinaus
            und waren nicht erreichbar. overflow-x-auto macht die Leiste
            horizontal scrollbar (dasselbe Muster wie die Team-Tabelle);
            justify-around bleibt für die kurzen Tab-Listen (member/manager)
            erhalten, wo es ohnehin nicht überläuft. */}
        <div className={cn("flex items-center h-16 max-w-md mx-auto overflow-x-auto", (tabs?.length ?? 0) > 5 ? "justify-start px-2" : "justify-around")}>
          {tabs?.map?.((tab: any) => { const Icon = tab?.icon; const isActive = pathname?.startsWith?.(tab?.href); return (<Link key={tab?.href} href={tab?.href} className={cn("flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition shrink-0", isActive ? "text-primary" : "text-muted-foreground")}>{Icon && <Icon className="w-5 h-5" />}<span className="text-[10px] font-medium">{t(tab?.labelKey ?? "")}</span></Link>); })}
        </div>
      </nav>
    </div>
  );
}
