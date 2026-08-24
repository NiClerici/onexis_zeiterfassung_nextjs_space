// Eigenes, minimales Layout für die Developer-Übersicht — bewusst getrennt
// von app/(app)/layout.tsx: kein Org-Tab-Nav, kein Trial-Banner, kein
// mustSetPassword-Redirect, weil /dev nicht an eine Organisation gebunden
// ist. Der Zugriffsschutz selbst passiert nicht hier, sondern serverseitig
// in jeder Seite über requireDeveloper() (lib/dev-access.ts) — ein Layout
// kann eine Route nicht vor dem Rendern der Seite abbrechen.

import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-semibold tracking-tight">Developer</span>
            <span className="text-xs text-muted-foreground">Plattform-Übersicht</span>
          </div>
          <Link href="/calendar" className="text-sm text-muted-foreground hover:text-foreground transition">
            Zurück zur App
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
