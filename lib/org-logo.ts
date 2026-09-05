// Validiert ein hochgeladenes Firmenlogo (Data-URL aus FileReader.readAsDataURL)
// für app/api/admin/organization/logo/route.ts. Reine Funktion, kein Prisma
// (gleiches Trennungsprinzip wie lib/calc.ts) — testbar ohne DB/Next.js-Request.
//
// pdfkit (lib/pdf-stundenrapport.ts) akzeptiert ausschliesslich PNG und JPEG
// und wirft bei allem anderen mitten im Export. Der Magic-Byte-Check hier ist
// deshalb kein Zierrat: ein falsch deklarierter Mime-Typ (z.B. eine
// umbenannte .webp) würde sonst erst beim Rapport-Download eines Kunden
// auffallen, nicht schon beim Hochladen.

export const LOGO_MAX_BYTES = 512 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function hatMagicBytes(data: Buffer, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  return magic.every((byte, i) => data[i] === byte);
}

export interface ParsedLogo {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg";
}

export function parseLogoDataUrl(dataUrl: unknown): ParsedLogo | { error: string } {
  if (typeof dataUrl !== "string" || !dataUrl) {
    return { error: "Keine Bilddaten übergeben" };
  }

  const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return { error: "Nur PNG oder JPEG werden unterstützt" };
  }
  const mimeType = match[1] as "image/png" | "image/jpeg";

  let data: Buffer;
  try {
    data = Buffer.from(match[2], "base64");
  } catch {
    return { error: "Ungültige Bilddaten" };
  }
  // Buffer.from ignoriert bei "base64" ungültige Zeichen statt zu werfen —
  // ein leeres Ergebnis aus nicht-leerer Eingabe ist deshalb der verlässliche
  // Hinweis auf kaputtes Base64, nicht die Abwesenheit eines throws.
  if (data.length === 0) {
    return { error: "Ungültige Bilddaten" };
  }

  if (data.length > LOGO_MAX_BYTES) {
    return { error: `Logo ist zu gross (max. ${Math.round(LOGO_MAX_BYTES / 1024)} KB)` };
  }

  const magicOk = mimeType === "image/png" ? hatMagicBytes(data, PNG_MAGIC) : hatMagicBytes(data, JPEG_MAGIC);
  if (!magicOk) {
    return { error: "Datei entspricht nicht dem angegebenen Bildformat" };
  }

  return { data, mimeType };
}
