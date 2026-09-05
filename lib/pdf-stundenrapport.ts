// Reines Rendering für den Kundenrapport-PDF (Bugfix "falsche Projekte" +
// "Betrag/MwSt raus" + Nutzerwunsch "direkt PDF" statt Excel) — getrennt von
// der Route, analog zur bestehenden Trennung lib/calc.ts ↔ Route: Layout ist
// hier testbar ohne Prisma/Next.js-Request, die Route bereitet nur die
// Daten auf (siehe app/api/export/stundenrapport/route.ts).
//
// Ersetzt den früheren ExcelJS-Export vollständig. Übernommen aus dem alten
// Layout: Kopf (Person/Monat/Kunde), Projektkatalog, Detailzeilen, Stunden-
// Total. Bewusst NICHT übernommen: die Spalte "Betrag ohne MwSt" und die
// Zeile "Total (o. MwSt)" (Nutzerwunsch) sowie 0.00h-Katalogzeilen (die
// Route filtert sie vor dem Aufruf hier heraus, siehe dortiger Kommentar).
//
// pdfkit hat keine eingebaute Tabellenunterstützung — die paar Hilfsfunktionen
// unten (ensureSpace/drawRow) sind die minimale Eigenimplementierung dafür,
// kein Ersatz für eine allgemeine Tabellen-Bibliothek, die diese App sonst
// nirgends braucht.
import PDFDocument from "pdfkit";

export interface StundenrapportCatalogRow {
  label: string;
  hours: number;
}

export interface StundenrapportDetailRow {
  // UTC-Mitternacht, wie aus Prisma (@db.Date) — wird über getUTCDate() etc.
  // formatiert, NIE über lokale Date-Methoden (siehe formatDateUTC unten).
  date: Date;
  kuerzel: string;
  projektName: string;
  task: string;
  hours: number;
}

export interface StundenrapportPdfInput {
  personName: string;
  monthLabel: string;
  customerName: string;
  catalogRows: StundenrapportCatalogRow[];
  detailRows: StundenrapportDetailRow[];
  // Firmenlogo (lib/org-logo.ts), optional — ohne Logo bleibt das Layout
  // bit-genau wie vorher. pdfkit akzeptiert nur PNG/JPEG (siehe dort).
  logo?: { data: Buffer; mimeType: string };
}

const PAGE_MARGIN = 50;
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#474747";
const COLOR_BORDER = "#c0c0c0";
const COLOR_BORDER_STRONG = "#1a1a1a";
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 45;
const LOGO_GAP = 12;

// dd.mm.yyyy aus den UTC-Datumsteilen — new Date(row.date).toLocaleDateString()
// würde je nach Serverzeitzone auf den Vor- oder Folgetag verrutschen (der
// Excel-Export hatte genau diesen Fehler bereits einmal, siehe Kommentar in
// der Vorgängerversion dieser Datei / app/api/export/stundenrapport).
function formatDateUTC(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

const fmtHours = (n: number) => n.toFixed(2);

interface Column {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
}

// Bricht auf eine neue Seite um, falls für die nächste Zeile nicht mehr
// genug Platz auf der aktuellen ist — inklusive erneuter Tabellenkopfzeile,
// damit eine mehrseitige Detailtabelle nicht kopflos weiterläuft.
function ensureSpace(doc: PDFKit.PDFDocument, needed: number, onNewPage?: () => void): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    onNewPage?.();
  }
}

function rowHeight(doc: PDFKit.PDFDocument, columns: Column[], values: string[], fontSize: number): number {
  let max = 0;
  doc.fontSize(fontSize);
  for (let i = 0; i < columns.length; i++) {
    const h = doc.heightOfString(values[i] ?? "", { width: columns[i].width - 8 });
    if (h > max) max = h;
  }
  return Math.max(max + 8, 18);
}

function drawRow(
  doc: PDFKit.PDFDocument,
  x: number,
  columns: Column[],
  values: string[],
  opts: { bold?: boolean; color?: string; fontSize?: number; borderColor?: string; borderWidth?: number } = {}
): number {
  const fontSize = opts.fontSize ?? 9;
  const height = rowHeight(doc, columns, values, fontSize);
  const y = doc.y;

  doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(opts.color ?? COLOR_TEXT);

  let cx = x;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    doc.text(values[i] ?? "", cx + 4, y + 4, { width: col.width - 8, align: col.align ?? "left" });
    cx += col.width;
  }

  doc
    .strokeColor(opts.borderColor ?? COLOR_BORDER)
    .lineWidth(opts.borderWidth ?? 0.5)
    .moveTo(x, y + height)
    .lineTo(x + columns.reduce((s, c) => s + c.width, 0), y + height)
    .stroke();

  doc.y = y + height;
  return height;
}

function drawHeaderRow(doc: PDFKit.PDFDocument, x: number, columns: Column[]): void {
  drawRow(
    doc,
    x,
    columns,
    columns.map((c) => c.header),
    { bold: true, fontSize: 9.5, borderColor: COLOR_BORDER_STRONG, borderWidth: 1 }
  );
}

export async function renderStundenrapportPdf(input: StundenrapportPdfInput): Promise<Buffer> {
  // compress: false — der Rapport ist ein kurzes, ein- bis zweiseitiges
  // internes Dokument (kein Gewicht bei Dateigrösse), und unkomprimierte
  // Content-Streams lassen sich in lib/pdf-stundenrapport-route.test.ts per
  // Regex auf enthaltenen/fehlenden Text prüfen, ohne zusätzlich eine
  // PDF-Parsing-Bibliothek einzuführen, die diese App sonst nirgends braucht.
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true, compress: false });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left;

  // Logo oben rechts, fest positioniert (doc.y bleibt unberührt) — vor dem
  // Textkopf gezeichnet, damit dessen Wertspalte (unten) bereits weiss, ob
  // sie dem Logo ausweichen muss. Ein defektes Bild darf den Rapport nicht
  // scheitern lassen (pdfkit wirft bei kaputten Bilddaten mitten im Aufbau);
  // lib/org-logo.ts fängt den Normalfall (falsches Format) schon vorher ab,
  // dieser catch ist nur das letzte Netz.
  let hasLogo = false;
  if (input.logo) {
    try {
      doc.image(input.logo.data, doc.page.width - doc.page.margins.right - LOGO_WIDTH, doc.page.margins.top, {
        fit: [LOGO_WIDTH, LOGO_HEIGHT],
      });
      hasLogo = true;
    } catch {
      hasLogo = false;
    }
  }

  // Kopf: Person / Monat / Kunde
  const headerLines: [string, string][] = [
    ["Stundenrapport:", input.personName],
    ["Monat:", input.monthLabel],
    ["Kunde:", input.customerName],
  ];
  // Breite dynamisch aus dem längsten Label ("Stundenrapport:") messen statt
  // eines festen Werts — eine zu schmale labelWidth liess pdfkit "Stunden-
  // rapport:" innerhalb der Spalte automatisch umbrechen, wodurch der Wert
  // ("Nico Clerici, …") neben die falsche (erste) statt die zweite Zeile
  // des Labels rutschte. lineBreak: false zusätzlich als zweite Absicherung.
  doc.font("Helvetica-Bold").fontSize(11);
  const labelWidth = Math.max(...headerLines.map(([label]) => doc.widthOfString(label))) + 10;
  // Bei vorhandenem Logo weicht die Wertspalte ihm aus (Breite abzüglich
  // Logo + Abstand) — sonst unverändert wie vorher.
  const valueWidth = contentWidth - labelWidth - (hasLogo ? LOGO_WIDTH + LOGO_GAP : 0);
  for (const [label, value] of headerLines) {
    const y = doc.y;
    doc.font("Helvetica-Bold").text(label, x, y, { width: labelWidth, lineBreak: false });
    doc.font("Helvetica").text(value, x + labelWidth, y, { width: valueWidth });
    doc.moveDown(0.3);
  }
  if (hasLogo) {
    doc.y = Math.max(doc.y, doc.page.margins.top + LOGO_HEIGHT + LOGO_GAP);
  }
  doc.moveDown(1);

  // Projektkatalog: nur STD | Projekt (Betrag/MwSt entfallen bewusst, siehe
  // Modulkopf-Kommentar). Aufrufer filtert bereits auf hours > 0.
  const catalogColumns: Column[] = [
    { header: "STD", width: 60, align: "right" },
    { header: "Projekt", width: contentWidth - 60, align: "left" },
  ];
  doc.font("Helvetica-Bold").fontSize(11).text("Projekte", x, doc.y);
  doc.moveDown(0.3);
  doc.x = x;
  drawHeaderRow(doc, x, catalogColumns);
  if (input.catalogRows.length === 0) {
    drawRow(doc, x, catalogColumns, ["", "(keine gebuchten Projekte in diesem Monat)"], { color: COLOR_MUTED });
  } else {
    for (const row of input.catalogRows) {
      ensureSpace(doc, 24, () => {
        doc.x = x;
        drawHeaderRow(doc, x, catalogColumns);
      });
      doc.x = x;
      drawRow(doc, x, catalogColumns, [fmtHours(row.hours), row.label]);
    }
  }
  doc.moveDown(1.2);

  // Detailzeilen: Datum | Kürzel | Projekt | Tasks | Std
  const detailColumns: Column[] = [
    { header: "Datum", width: 65, align: "left" },
    { header: "Kürzel", width: 45, align: "left" },
    { header: "Projekt", width: 120, align: "left" },
    { header: "Tasks", width: contentWidth - 65 - 45 - 120 - 45, align: "left" },
    { header: "Std", width: 45, align: "right" },
  ];
  doc.font("Helvetica-Bold").fontSize(11).text("Detail", x, doc.y);
  doc.moveDown(0.3);
  doc.x = x;
  drawHeaderRow(doc, x, detailColumns);
  for (const row of input.detailRows) {
    ensureSpace(doc, 24, () => {
      doc.x = x;
      drawHeaderRow(doc, x, detailColumns);
    });
    doc.x = x;
    drawRow(doc, x, detailColumns, [
      formatDateUTC(row.date),
      row.kuerzel,
      row.projektName,
      row.task,
      fmtHours(row.hours),
    ]);
  }

  // TOTAL — Summe der Stunden, jetzt als ausgerechneter Wert statt einer
  // Excel-Formel (es gibt in einem PDF nichts, das eine Formel nachrechnen
  // könnte).
  const total = input.detailRows.reduce((s, r) => s + r.hours, 0);
  ensureSpace(doc, 24);
  doc.x = x;
  drawRow(doc, x, detailColumns, ["TOTAL", "", "", "", fmtHours(total)], { bold: true, borderColor: COLOR_BORDER_STRONG, borderWidth: 1 });

  doc.end();
  return done;
}
