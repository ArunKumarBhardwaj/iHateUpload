import { expect, test } from "bun:test";
import {
  PDFDocument,
  PDFName,
  type PDFPage,
  StandardFonts,
  rgb,
} from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { stripTextInRects, type UserRect } from "./pdf-text-strip";

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item && item.str.trim()) out.push(item.str);
    }
  }
  await doc.loadingTask.destroy();
  return out;
}

/** Embedded fonts only exist as objects after a flush, as in any loaded file. */
async function strip(doc: PDFDocument, page: PDFPage, rects: UserRect[]) {
  await doc.flush();
  return stripTextInRects(doc, page, rects);
}

async function twoLines() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText("Hello World", { x: 50, y: 200, size: 20, font, color: rgb(0, 0, 0) });
  page.drawText("Keep me", { x: 50, y: 100, size: 20, font });
  return { doc, page };
}

test("glyphs inside the rectangle leave the content stream, the rest stays", async () => {
  const { doc, page } = await twoLines();
  const removed = await strip(doc, page, [{ x0: 40, y0: 190, x1: 300, y1: 230 }]);
  expect(removed).toBe(11);
  const words = await textOf(await doc.save());
  expect(words.join(" ")).not.toContain("Hello");
  expect(words.join(" ")).toContain("Keep me");
});

test("only the glyphs under the rectangle go, neighbours keep their place", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText("AAAA BBBB CCCC", { x: 50, y: 200, size: 20, font });
  const cWidth = font.widthOfTextAtSize("AAAA BBBB ", 20);
  // Cut out the middle word only.
  const x0 = 50 + font.widthOfTextAtSize("AAAA ", 20) + 1;
  const x1 = 50 + cWidth - 1;
  await strip(doc, page, [{ x0, y0: 190, x1, y1: 230 }]);
  const reread = await getDocument({ data: (await doc.save()).slice() }).promise;
  const items = (await (await reread.getPage(1)).getTextContent()).items;
  const strs = items.flatMap((i) => ("str" in i ? [i] : []));
  const joined = strs.map((i) => i.str).join("");
  expect(joined).toContain("AAAA");
  expect(joined).toContain("CCCC");
  expect(joined).not.toContain("BBBB");
  const c = strs.find((i) => i.str.includes("CCCC"));
  // CCCC is still drawn where it was, not slid left.
  expect(c).toBeDefined();
  const expectedX = 50 + font.widthOfTextAtSize("AAAA BBBB ", 20);
  const cStart = c!.transform[4] + (c!.str.indexOf("CCCC") > 0 ? font.widthOfTextAtSize(c!.str.slice(0, c!.str.indexOf("CCCC")), 20) : 0);
  expect(cStart).toBeCloseTo(expectedX, 0);
});

test("TJ arrays, hex strings and quotes are handled", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  const key = page.node.newFontDictionary("F1", font.ref).decodeText();
  const stream = doc.context.stream(
    [
      `BT /${key} 20 Tf 50 200 Td [(Gone) -80 (Word)] TJ ET`,
      `BT /${key} 20 Tf 50 150 Td <4B656570> Tj ET`,
      `BT /${key} 20 Tf 20 TL 50 100 Td (Line1) Tj (Line2) ' ET`,
    ].join("\n"),
  );
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  const removed = await strip(doc, page, [{ x0: 40, y0: 190, x1: 380, y1: 230 }]);
  expect(removed).toBe(8);
  const words = (await textOf(await doc.save())).join(" ");
  expect(words).not.toContain("Gone");
  expect(words).not.toContain("Word");
  expect(words).toContain("Keep");
  expect(words).toContain("Line1");
  expect(words).toContain("Line2");
});

test("text inside a form XObject is stripped too", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  const form = doc.context.stream("BT /F1 20 Tf 10 10 Td (Inside form) Tj ET", {
    Type: "XObject",
    Subtype: "Form",
    BBox: doc.context.obj([0, 0, 300, 50]),
    Matrix: doc.context.obj([1, 0, 0, 1, 40, 200]),
    Resources: doc.context.obj({ Font: { F1: font.ref } }),
  });
  const formRef = doc.context.register(form);
  page.node.setXObject(PDFName.of("Fm1"), formRef);
  const contents = doc.context.stream("/Fm1 Do");
  page.node.set(PDFName.of("Contents"), doc.context.register(contents));
  const removed = await strip(doc, page, [{ x0: 40, y0: 190, x1: 380, y1: 270 }]);
  expect(removed).toBe(11);
  expect((await textOf(await doc.save())).join(" ")).not.toContain("Inside");
});

test("a rectangle with no text under it removes nothing", async () => {
  const { doc, page } = await twoLines();
  expect(await strip(doc, page, [{ x0: 0, y0: 0, x1: 30, y1: 30 }])).toBe(0);
});
