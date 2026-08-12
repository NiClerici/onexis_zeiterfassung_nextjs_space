"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Calendar, BarChart3, UserCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/calendar", icon: Calendar, labelKey: "nav.calendar" },
  { href: "/analytics", icon: BarChart3, labelKey: "nav.analytics" },
  { href: "/profile", icon: UserCircle, labelKey: "nav.profile" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]"><div className="animate-pulse text-muted-foreground text-sm">{t("common.loading")}</div></div>;
  }
  if (status === "unauthenticated") { router.replace("/login"); return null; }

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex flex-col">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="relative w-24 h-8"><Image src="/logo-onexis.png" alt="ONEXIS" fill className="object-contain object-left" /></div>
          <nav className="hidden sm:flex items-center gap-1">
            {tabs?.map?.((tab: any) => { const Icon = tab?.icon; const isActive = pathname?.startsWith?.(tab?.href); return (<Link key={tab?.href} href={tab?.href} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>{Icon && <Icon className="w-4 h-4" />}{t(tab?.labelKey ?? "")}</Link>); })}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-4 pb-20 sm:pb-4">{children}</main>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border/50 safe-area-pb">
        <div className="flex items-center justify-around h-16 max-w-md mx-auto">
          {tabs?.map?.((tab: any) => { const Icon = tab?.icon; const isActive = pathname?.startsWith?.(tab?.href); return (<Link key={tab?.href} href={tab?.href} className={cn("flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition", isActive ? "text-primary" : "text-muted-foreground")}>{Icon && <Icon className="w-5 h-5" />}<span className="text-[10px] font-medium">{t(tab?.labelKey ?? "")}</span></Link>); })}
        </div>
      </nav>
    </div>
  );
}
