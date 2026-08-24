"use client";

// Gemeinsamer Download-Helfer für Excel-/CSV-Exporte (fetch → Blob →
// programmatischer <a download>-Klick). Extrahiert aus
// app/(app)/profile/page.tsx (dort für den regulären Export, ARG-Kontroll-
// export und Lohnexport genutzt), damit app/(app)/calendar/page.tsx (Export
// des Stundenrapports pro Kunde) dieselbe Logik nutzt statt sie zu
// duplizieren. Nimmt die Fehlermeldung als Parameter statt selbst t() zu
// rufen — reine Utility-Funktion, kein Hook, kein i18n-Context nötig.

// Server-Dateiname aus dem Content-Disposition-Header lesen (RFC 6266,
// beide Varianten: filename*=UTF-8''... bevorzugt, sonst filename="...").
// Nur für Aufrufer relevant, die preferServerFilename setzen — die drei
// bestehenden Aufrufer in profile/page.tsx bauen ihren Dateinamen selbst
// (mit Zeitstempel) und sollen sich dadurch nicht ändern.
function extractServerFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fällt durch zur einfachen Variante
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : null;
}

export async function downloadBlob(
  url: string,
  filename: string,
  onError?: (msg: string) => void,
  fallbackErrorMessage = "Download fehlgeschlagen.",
  preferServerFilename = false
): Promise<void> {
  try {
    const res = await fetch(url);
    if (res?.ok) {
      const blob = await res?.blob?.();
      const serverFilename = preferServerFilename ? extractServerFilename(res.headers?.get?.("Content-Disposition") ?? null) : null;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob ?? new Blob());
      a.download = serverFilename ?? filename;
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
