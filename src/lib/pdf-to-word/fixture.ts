import { deflateSync } from "node:zlib";

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A small solid-colour RGB PNG, built by hand so tests need no image library. */
export function makePng(width: number, height: number, rgbColor: [number, number, number]) {
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgbColor, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

const PARA_ONE = [
  "The quick brown fox jumps over the lazy dog while the sun sets slowly",
  "behind the hills, and every villager in the valley stops to watch the",
  "sky turn from gold to deep violet.",
];
const PARA_TWO = [
  "A second paragraph begins here after a clear gap. It also wraps across",
  "more than one line so the converter has to merge the lines back into",
  "a single flowing paragraph.",
];

/** One heading, two wrapped paragraphs, both list kinds, a ruled 3x3 table, an image, then a second page. */
export async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const page = doc.addPage([612, 792]);
  const ink = rgb(0, 0, 0);

  page.drawText("Quarterly Report", { x: 72, y: 700, size: 24, font: bold });
  PARA_ONE.forEach((line, i) =>
    page.drawText(line, { x: 72, y: 660 - i * 14, size: 11, font: regular }),
  );
  page.drawText("Emphasis", { x: 72, y: 660 - 3 * 14, size: 11, font: italic });
  PARA_TWO.forEach((line, i) =>
    page.drawText(line, { x: 72, y: 590 - i * 14, size: 11, font: regular }),
  );

  ["First bullet item", "Second bullet item"].forEach((text, i) => {
    page.drawText("•", { x: 80, y: 530 - i * 18, size: 11, font: regular });
    page.drawText(text, { x: 98, y: 530 - i * 18, size: 11, font: regular });
  });
  ["Open the file", "Press convert"].forEach((text, i) => {
    page.drawText(`${i + 1}.`, { x: 80, y: 480 - i * 18, size: 11, font: regular });
    page.drawText(text, { x: 98, y: 480 - i * 18, size: 11, font: regular });
  });

  const cells = [
    ["Item", "Qty", "Price"],
    ["Apples", "3", "4.50"],
    ["Pears", "7", "9.10"],
  ];
  const left = 72;
  const top = 420;
  const colW = 120;
  const rowH = 24;
  for (let i = 0; i <= 3; i++) {
    page.drawLine({
      start: { x: left, y: top - i * rowH },
      end: { x: left + 3 * colW, y: top - i * rowH },
      thickness: 1,
      color: ink,
    });
    page.drawLine({
      start: { x: left + i * colW, y: top },
      end: { x: left + i * colW, y: top - 3 * rowH },
      thickness: 1,
      color: ink,
    });
  }
  cells.forEach((row, r) =>
    row.forEach((text, c) =>
      page.drawText(text, {
        x: left + c * colW + 8,
        y: top - r * rowH - 16,
        size: 11,
        font: r === 0 ? bold : regular,
      }),
    ),
  );

  const png = await doc.embedPng(makePng(60, 40, [200, 40, 40]));
  page.drawImage(png, { x: 72, y: 250, width: 120, height: 80 });
  page.drawText("Closing line after the picture.", { x: 72, y: 220, size: 11, font: regular });

  const second = doc.addPage([612, 792]);
  second.drawText("Appendix", { x: 72, y: 700, size: 24, font: bold });
  second.drawText("Text that lives on the second page.", {
    x: 72,
    y: 660,
    size: 11,
    font: regular,
  });
  return doc.save();
}

/**
 * Two pages: a web link, an internal link (explicit destination) and a named one on page one;
 * "Details" and its sub-heading "More" on page two, listed in the outline; title, author and subject set.
 */
export async function makeLinkedPdf(): Promise<Uint8Array> {
  const { PDFName, PDFNumber, PDFString } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Link Sampler");
  doc.setAuthor("Ada Writer");
  doc.setSubject("Testing links");
  doc.setKeywords(["alpha", "beta"]);
  doc.setCreationDate(new Date("2024-03-05T10:20:30Z"));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const first = doc.addPage([612, 792]);
  const second = doc.addPage([612, 792]);
  const ctx = doc.context;

  first.drawText("Read the manual or jump to the details page.", { x: 72, y: 700, size: 12, font: regular });
  const link = (x: number, y: number, w: number, extra: Record<string, unknown>) => {
    const annot = ctx.register(
      ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y - 3, x + w, y + 10], Border: [0, 0, 0], ...extra }),
    );
    first.node.addAnnot(annot);
  };
  const width = (t: string) => regular.widthOfTextAtSize(t, 12);
  link(72 + width("Read the "), 700, width("manual"), {
    A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com/manual") }),
  });
  link(72 + width("Read the manual or jump to the "), 700, width("details page"), {
    Dest: ctx.obj([second.ref, PDFName.of("XYZ"), 72, 710, null]),
  });

  second.drawText("Details", { x: 72, y: 700, size: 22, font: bold });
  second.drawText("Some text under the details heading, set at body size.", { x: 72, y: 670, size: 12, font: regular });
  second.drawText("More", { x: 72, y: 620, size: 22, font: bold });
  second.drawText("A last line of body text sits here under the sub-heading.", { x: 72, y: 590, size: 12, font: regular });

  const item = (title: string, y: number) =>
    ctx.register(
      ctx.obj({ Title: PDFString.of(title), Dest: [second.ref, PDFName.of("XYZ"), 72, y + 20, null] }),
    );
  const details = item("Details", 700);
  const more = item("More", 620);
  const outlines = ctx.register(ctx.obj({ Type: "Outlines" }));
  const set = (ref: typeof details, entries: Record<string, unknown>) => {
    const dict = ctx.lookup(ref) as unknown as { set(k: unknown, v: unknown): void };
    for (const [k, v] of Object.entries(entries)) dict.set(PDFName.of(k), v);
  };
  set(details, { Parent: outlines, First: more, Last: more, Count: PDFNumber.of(1) });
  set(more, { Parent: details });
  set(outlines, { First: details, Last: details, Count: PDFNumber.of(2) });
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  return doc.save();
}

/** A list whose bullets are drawn as dots, the way browsers print them, with a nested level and a numbered list. */
export async function makeDotListPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Shopping Items", { x: 72, y: 700, size: 18, font: bold });
  const rows: [string, number][] = [
    ["Copper kettle", 0],
    ["Silver ladder", 0],
    ["Timber bundles", 1],
    ["Feather pillows", 1],
    ["Marble anchor", 0],
  ];
  rows.forEach(([text, level], i) => {
    const x = 102 + level * 30;
    const y = 660 - i * 20;
    page.drawCircle({ x: x - 12, y: y + 3.5, size: 2.5, color: rgb(0, 0, 0) });
    page.drawText(text, { x, y, size: 12, font });
  });
  page.drawText("Procedure", { x: 72, y: 520, size: 18, font: bold });
  ["Open the gate", "Light the candle", "Check the compass"].forEach((text, i) => {
    page.drawText(`${i + 1}.`, { x: 90, y: 480 - i * 20, size: 12, font });
    page.drawText(text, { x: 108, y: 480 - i * 20, size: 12, font });
  });
  return doc.save();
}

/** One page of runs set in colour, underlined, struck through, highlighted, raised and lowered. */
export async function makeFormattedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  const width = (t: string, size: number) => font.widthOfTextAtSize(t, size);
  // Plain text, a red word, then a blue one, on one baseline.
  page.drawText("Colours: ", { x: 72, y: 700, size: 12, font });
  const redX = 72 + width("Colours: ", 12);
  page.drawText("red words", { x: redX, y: 700, size: 12, font, color: rgb(1, 0, 0) });
  page.drawText(" and ", { x: redX + width("red words", 12), y: 700, size: 12, font });
  page.drawText("blue", { x: redX + width("red words and ", 12), y: 700, size: 12, font, color: rgb(0, 0, 1) });
  // Underline and strike are lines drawn after the word.
  page.drawText("Lines: ", { x: 72, y: 640, size: 12, font });
  const uX = 72 + width("Lines: ", 12);
  page.drawText("underlined", { x: uX, y: 640, size: 12, font });
  page.drawLine({ start: { x: uX, y: 638.8 }, end: { x: uX + width("underlined", 12), y: 638.8 }, thickness: 0.8, color: rgb(0, 0, 0) });
  const sX = uX + width("underlined ", 12);
  page.drawText("struck", { x: sX, y: 640, size: 12, font });
  page.drawLine({ start: { x: sX, y: 644 }, end: { x: sX + width("struck", 12), y: 644 }, thickness: 0.8, color: rgb(0, 0, 0) });
  // A yellow box is painted first, then the word on top.
  page.drawText("Marked: ", { x: 72, y: 580, size: 12, font });
  const hX = 72 + width("Marked: ", 12);
  page.drawRectangle({ x: hX, y: 577, width: width("highlighted", 12), height: 13, color: rgb(1, 1, 0) });
  page.drawText("highlighted", { x: hX, y: 580, size: 12, font });
  // Water H2O and E = mc^2: smaller text off the baseline.
  page.drawText("H", { x: 72, y: 520, size: 12, font });
  page.drawText("2", { x: 72 + width("H", 12), y: 517, size: 8, font });
  page.drawText("O and mc", { x: 72 + width("H", 12) + width("2", 8), y: 520, size: 12, font });
  page.drawText("2", { x: 72 + width("H", 12) + width("2", 8) + width("O and mc", 12), y: 525, size: 8, font });
  return doc.save();
}
