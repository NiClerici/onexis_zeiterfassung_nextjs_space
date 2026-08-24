// Kompakte Kennzahl-Kachel für /dev — bewusst ohne Framer-Motion/Animate-
// Wrapper (anders als die Produktseiten): eine Betriebsseite soll beim Laden
// sofort feststehen, nicht einfaden.

import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-semibold tracking-tight",
          tone === "warning" && "text-amber-600 dark:text-amber-500",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-emerald-600 dark:text-emerald-500"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
