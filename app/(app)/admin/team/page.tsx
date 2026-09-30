"use client";

// "Team" und "Teamsicht" sind zum Team-Hub (app/(app)/team/page.tsx)
// zusammengeführt — dieser alte Pfad leitet nur noch auf dessen
// Verwaltung-Tab weiter, damit bestehende Lesezeichen/Links weiterhin
// funktionieren.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminTeamRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/team?tab=verwaltung");
  }, [router]);
  return null;
}
