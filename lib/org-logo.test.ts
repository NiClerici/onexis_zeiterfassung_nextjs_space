import { describe, expect, it } from "vitest";
import { parseLogoDataUrl, LOGO_MAX_BYTES } from "./org-logo";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function pngDataUrl(payloadBytes = 100): string {
  const buf = Buffer.concat([PNG_MAGIC, Buffer.alloc(payloadBytes)]);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function jpegDataUrl(payloadBytes = 100): string {
  const buf = Buffer.concat([JPEG_MAGIC, Buffer.alloc(payloadBytes)]);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

describe("parseLogoDataUrl", () => {
  it("akzeptiert ein gültiges PNG", () => {
    const result = parseLogoDataUrl(pngDataUrl());
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.mimeType).toBe("image/png");
      expect(result.data.subarray(0, 8)).toEqual(PNG_MAGIC);
    }
  });

  it("akzeptiert ein gültiges JPEG", () => {
    const result = parseLogoDataUrl(jpegDataUrl());
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.mimeType).toBe("image/jpeg");
    }
  });

  it("lehnt fehlende Bilddaten ab", () => {
    expect(parseLogoDataUrl(undefined)).toEqual({ error: expect.any(String) });
    expect(parseLogoDataUrl("")).toEqual({ error: expect.any(String) });
  });

  it("lehnt nicht unterstützte Formate (z.B. SVG) ab", () => {
    const result = parseLogoDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
    expect(result).toEqual({ error: expect.any(String) });
  });

  // Bugfix-Fall: eine umbenannte Datei mit falschem, aber syntaktisch
  // gültigem Mime-Typ-Präfix darf nicht durchrutschen — pdfkit würde sonst
  // erst beim Rapport-Export eines Kunden mitten im PDF-Aufbau werfen.
  it("lehnt Daten ab, deren Inhalt nicht zum angegebenen Mime-Typ passt", () => {
    const fakePng = `data:image/png;base64,${JPEG_MAGIC.toString("base64")}`;
    const result = parseLogoDataUrl(fakePng);
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("lehnt ungültiges Base64 ab", () => {
    const result = parseLogoDataUrl("data:image/png;base64,!!!not-base64!!!");
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("lehnt Dateien über dem Grössenlimit ab", () => {
    const result = parseLogoDataUrl(pngDataUrl(LOGO_MAX_BYTES + 1));
    expect(result).toEqual({ error: expect.any(String) });
  });

  it("akzeptiert eine Datei genau am Grössenlimit", () => {
    const result = parseLogoDataUrl(pngDataUrl(LOGO_MAX_BYTES - PNG_MAGIC.length));
    expect("error" in result).toBe(false);
  });
});
