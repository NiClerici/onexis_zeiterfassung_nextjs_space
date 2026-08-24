"use client";

// Plan wechseln + Trial verlängern für eine Organisation, aufgerufen von
// app/(dev)/dev/orgs/[slug]/page.tsx (Server Component — die eigentliche
// Mutation braucht Interaktivität, deshalb hier als eigene Client-
// Komponente statt die ganze Seite "use client" zu machen).
//
// Ruft POST /api/dev/orgs/[slug]/{plan,trial} (app/api/dev/**/route.ts,
// Fachlogik in lib/dev-actions.ts). Nach Erfolg router.refresh() statt
// eigenem State — die Seite liest ohnehin bei jedem Aufruf frisch aus der
// DB (force-dynamic), ein Neu-Fetch der Server-Daten ist einfacher als
// den lokalen State synchron zu halten.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PLAN_OPTIONS = ["trial", "starter", "pro"] as const;

export function OrgPlanActions({ slug, currentPlan, isTrial }: { slug: string; currentPlan: string; isTrial: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedPlan, setSelectedPlan] = useState(currentPlan);

  async function changePlan() {
    if (selectedPlan === currentPlan) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/dev/orgs/${slug}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: selectedPlan }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data?.error ?? "Planwechsel fehlgeschlagen");
          return;
        }
        toast.success(
          `Plan geändert: ${currentPlan} → ${selectedPlan}. Hinweis: das Session-Token betroffener Nutzer trägt den alten Plan bis zu 1h nach (lib/auth-options.ts).`
        );
        router.refresh();
      } catch (err) {
        console.error(err);
        toast.error("Planwechsel fehlgeschlagen");
      }
    });
  }

  async function extendTrial(days: number) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/dev/orgs/${slug}/trial`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data?.error ?? "Trial-Verlängerung fehlgeschlagen");
          return;
        }
        toast.success(`Trial um ${days} Tage verlängert.`);
        router.refresh();
      } catch (err) {
        console.error(err);
        toast.error("Trial-Verlängerung fehlgeschlagen");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selectedPlan} onValueChange={setSelectedPlan} disabled={pending}>
        <SelectTrigger className="w-32 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLAN_OPTIONS.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={pending || selectedPlan === currentPlan} onClick={changePlan}>
        Plan übernehmen
      </Button>
      {isTrial && (
        <>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => extendTrial(14)}>
            +14 Tage
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => extendTrial(30)}>
            +30 Tage
          </Button>
        </>
      )}
    </div>
  );
}
