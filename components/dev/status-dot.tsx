// Ampel-Punkt für Statusleiste/Kunden-Tabelle. tone folgt denselben drei
// Zuständen wie StatTile, damit "Farbe bedeutet dasselbe" auf der ganzen
// Seite gilt.

import { cn } from "@/lib/utils";

export function StatusDot({ tone }: { tone: "default" | "warning" | "danger" | "success" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        tone === "success" && "bg-emerald-500",
        tone === "warning" && "bg-amber-500",
        tone === "danger" && "bg-destructive",
        tone === "default" && "bg-muted-foreground/40"
      )}
      aria-hidden
    />
  );
}
