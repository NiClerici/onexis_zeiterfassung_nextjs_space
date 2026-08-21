"use client";

import { tagessollBasis } from "@/lib/calc";
import { useI18n } from "@/lib/i18n";

// Live-Vorschau unter den Wochenstunden-/Pensum-Feldern: zeigt, was aus der
// Eingabe wird, BEVOR gespeichert wird. Grund: "Wochenstunden" ist immer die
// Vollzeit-Basis (100%), nicht die bereits reduzierte Wochenarbeitszeit — wer
// hier versehentlich die reduzierten Stunden einträgt, kürzt das Tagessoll
// doppelt (Pensum wirkt ein zweites Mal). Dieselbe Formel wie in
// lib/calc.ts:sollStundenTag, damit die Vorschau nie von der echten
// Berechnung abweicht.
export function PensumPreview({ weeklyHours, pensum }: { weeklyHours: string; pensum: string }) {
  const { t } = useI18n();
  const wh = parseFloat(weeklyHours);
  const p = parseFloat(pensum);
  if (!isFinite(wh) || !isFinite(p) || wh <= 0) return null;
  const daily = tagessollBasis(wh, p);
  const weekly = (wh * p) / 100;
  return (
    <p className="text-xs text-muted-foreground mt-1">
      → {t("profile.pensumPreview", { daily: daily.toFixed(1), weekly: weekly.toFixed(1) })}
    </p>
  );
}
