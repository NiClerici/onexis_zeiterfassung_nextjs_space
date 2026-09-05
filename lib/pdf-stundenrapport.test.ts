// Unit-Test für renderStundenrapportPdf() direkt (kein Prisma/Next.js-Request
// nötig, siehe Modulkopf-Kommentar) — deckt speziell das Logo-Rendering ab,
// das lib/export-stundenrapport-route.test.ts (integrationsnah, mit echter
// Test-DB) nicht prüft, weil dort kein Logo hinterlegt wird.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { renderStundenrapportPdf } from "./pdf-stundenrapport";

const baseInput = {
  personName: "Nico Clerici, ONEXIS GmbH",
  monthLabel: "Juli 2026",
  customerName: "Swissgrid",
  catalogRows: [{ label: "Testprojekt", hours: 5 }],
  detailRows: [
    { date: new Date(Date.UTC(2026, 6, 1)), kuerzel: "CLN", projektName: "Testprojekt", task: "Test", hours: 5 },
  ],
};

// Echtes PNG aus public/ statt eines handgebauten Fixtures — pdfkit parst
// die Bilddaten tatsächlich (nicht nur Magic Bytes wie lib/org-logo.ts), ein
// unvollständiges Fake-PNG würde hier durchfallen, ohne etwas über den
// Produktivpfad auszusagen.
const realPng = fs.readFileSync(path.join(__dirname, "..", "public", "logo-onexis.png"));

describe("renderStundenrapportPdf", () => {
  it("rendert ohne Logo unverändert (kein logo-Feld übergeben)", async () => {
    const buf = await renderStundenrapportPdf(baseInput);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("rendert mit Logo, ohne zu werfen, und bettet die Bilddaten ein", async () => {
    const buf = await renderStundenrapportPdf({ ...baseInput, logo: { data: realPng, mimeType: "image/png" } });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // pdfkit bettet Bilder als eigenes XObject ein — /Subtype /Image ist der
    // verlässliche Beleg, dass das Logo tatsächlich im PDF gelandet ist statt
    // nur schweigend übersprungen zu werden.
    expect(buf.toString("latin1")).toContain("/Subtype /Image");
  });

  it("lässt den Rapport nicht scheitern, wenn die Logo-Bytes kein gültiges Bild sind", async () => {
    const garbage = Buffer.from("das ist kein bild");
    const buf = await renderStundenrapportPdf({ ...baseInput, logo: { data: garbage, mimeType: "image/png" } });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.toString("latin1")).not.toContain("/Subtype /Image");
  });
});
