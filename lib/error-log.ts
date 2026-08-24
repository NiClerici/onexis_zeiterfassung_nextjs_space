// Zentraler Fehler-Logger für API-Routen — schreibt zusätzlich zum
// bisherigen console.error() eine durchsuchbare Kopie in ErrorLog
// (prisma/schema.prisma), damit /dev (app/(dev)/dev/page.tsx) Störungen
// zeigen kann, statt dass sie nur in "docker compose logs" verschwinden, auf
// die der App-Container selbst keinen Zugriff hat.
//
// Ersetzt console.error NICHT: die Container-Logs bleiben die Quelle der
// Wahrheit (funktionieren auch, wenn die DB selbst das Problem ist), diese
// Tabelle ist die durchsuchbare, in der App sichtbare Kopie.

import { prisma } from "@/lib/db";
import { AccessError } from "@/lib/access";

export interface ErrorLogContext {
  orgId?: string | null;
  userId?: string | null;
}

// Darf NIEMALS werfen — ein Fehler beim Loggen des ursprünglichen Fehlers
// darf dessen Response (z.B. 500 mit Fehlermeldung) nicht verhindern. Bei
// jedem internen Problem (DB down, etc.) fällt die Funktion still auf
// console.error zurück, das an dieser Stelle ohnehin schon steht.
//
// AccessError (401/403/404 aus lib/access.ts) wird bewusst NICHT geloggt —
// das sind erwartete Ablehnungen (fehlende Session, falsche Rolle), keine
// Störungen. Nur echte 500er-Fälle sind hier relevant.
export async function logError(source: string, error: unknown, ctx?: ErrorLogContext): Promise<void> {
  if (error instanceof AccessError) return;

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? null : null;

  try {
    await prisma.errorLog.create({
      data: {
        source,
        message,
        stack,
        orgId: ctx?.orgId ?? null,
        userId: ctx?.userId ?? null,
      },
    });
  } catch (loggingError) {
    console.error(`[lib/error-log] Konnte Fehler nicht in ErrorLog schreiben (source=${source}):`, loggingError);
  }
}
