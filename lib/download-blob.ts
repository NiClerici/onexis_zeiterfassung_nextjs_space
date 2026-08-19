"use client";

// Gemeinsamer Download-Helfer für Excel-/CSV-Exporte (fetch → Blob →
// programmatischer <a download>-Klick). Extrahiert aus
// app/(app)/profile/page.tsx (dort für den regulären Export, ARG-Kontroll-
// export und Lohnexport genutzt), damit app/(app)/calendar/page.tsx (Export
// des Stundenrapports pro Kunde) dieselbe Logik nutzt statt sie zu
// duplizieren. Nimmt die Fehlermeldung als Parameter statt selbst t() zu
// rufen — reine Utility-Funktion, kein Hook, kein i18n-Context nötig.
export async function downloadBlob(
  url: string,
  filename: string,
  onError?: (msg: string) => void,
  fallbackErrorMessage = "Download fehlgeschlagen."
): Promise<void> {
  try {
    const res = await fetch(url);
    if (res?.ok) {
      const blob = await res?.blob?.();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob ?? new Blob());
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      const data = await res?.json?.().catch(() => ({}));
      onError?.(data?.error ?? fallbackErrorMessage);
    }
  } catch (err: any) {
    console.error(err);
    onError?.(fallbackErrorMessage);
  }
}
