/** Node-side helpers for tests and the bench: read a PDF into page inputs the way the browser does. */
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { extractPage } from "../pdf-to-word/extract";
import type { PageInput } from "../pdf-to-word/lines";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

export async function loadPages(data: Uint8Array): Promise<PageInput[]> {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const pages: PageInput[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const extracted = await extractPage(page as never, OPS as unknown as Record<string, number>, n);
    pages.push(extracted.input);
    page.cleanup();
  }
  await pdf.loadingTask.destroy();
  return pages;
}

/** A ruled, shaded table with a merged group header, IDs with leading zeros, negatives, percents and dates. */
export async function makeLedgerPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Regional Sales", { x: 54, y: 700, size: 22, font: bold });
  page.drawText("Prepared for the board. Figures in dollars.", { x: 54, y: 676, size: 11, font: regular });

  const rows = [
    ["", "", "Q1 results", "", "", ""],
    ["Code", "Region", "Units", "Revenue", "Change", "Date"],
    ["00123", "North", "1,200", "$45,000.50", "12.5%", "2026-03-03"],
    ["00456", "South", "(300)", "($1,200.00)", "-3.2%", "2026-03-04"],
    ["00789", "East", "980", "$12,300.00", "4.8%", "2026-03-05"],
  ];
  const widths = [70, 90, 80, 100, 80, 90];
  const xs = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [54]);
  const top = 640;
  const rowH = 24;
  const ink = rgb(0, 0, 0);
  for (const r of [0, 1]) {
    page.drawRectangle({ x: xs[0], y: top - (r + 1) * rowH, width: xs[6] - xs[0], height: rowH, color: rgb(0.85, 0.89, 0.95) });
  }
  for (let r = 0; r <= rows.length; r++) {
    page.drawLine({ start: { x: xs[0], y: top - r * rowH }, end: { x: xs[6], y: top - r * rowH }, thickness: 1, color: ink });
  }
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c <= 6; c++) {
      // The group header spans Units to Date, so no rules cross it on the first row.
      if (r === 0 && c > 2 && c < 6) continue;
      page.drawLine({ start: { x: xs[c], y: top - r * rowH }, end: { x: xs[c], y: top - (r + 1) * rowH }, thickness: 1, color: ink });
    }
  }
  rows.forEach((row, r) =>
    row.forEach((text, c) => {
      if (text) page.drawText(text, { x: xs[c] + 6, y: top - r * rowH - 16, size: 11, font: r < 2 ? bold : regular });
    }),
  );
  return doc.save();
}
