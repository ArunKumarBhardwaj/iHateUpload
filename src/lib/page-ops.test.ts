import { expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFArray, StandardFonts } from "@cantoo/pdf-lib";

import {
  flipMatrix,
  flipPage,
  pageContentText,
  removeInvisibleTextOps,
  stripInvisibleText,
} from "./page-ops";

const hex = (t: string) =>
  Array.from(t, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();

test("flip matrices mirror around the box and respect page rotation", () => {
  const box = { x0: 0, y0: 0, x1: 600, y1: 800 };
  expect(flipMatrix("h", 0, box)).toEqual([-1, 0, 0, 1, 600, 0]);
  expect(flipMatrix("v", 0, box)).toEqual([1, 0, 0, -1, 0, 800]);
  expect(flipMatrix("hv", 180, box)).toEqual([-1, 0, 0, -1, 600, 800]);
  // On a page shown turned 90 degrees, left-right is the page's own y axis.
  expect(flipMatrix("h", 90, box)).toEqual([1, 0, 0, -1, 0, 800]);
  expect(flipMatrix("v", 270, box)).toEqual([-1, 0, 0, 1, 600, 0]);
});

test("flipPage wraps the original content and keeps text as text", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText("Hello mirror", { x: 50, y: 700, size: 20, font });
  const before = pageContentText(page);
  flipPage(doc, page, "h");
  const after = pageContentText(page);
  expect(after).toContain("-1 0 0 1 600 0 cm");
  expect(after).toContain(hex("Hello mirror"));
  expect(after).toContain(before.trim().split("\n")[0]);
  const re = await PDFDocument.load(await doc.save());
  expect(pageContentText(re.getPage(0))).toContain(hex("Hello mirror"));
});

test("flipPage drops form-like annotations but keeps and mirrors links", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [100, 100, 200, 150],
    }),
  );
  const widget = doc.context.register(
    doc.context.obj({ Type: "Annot", Subtype: "Widget", Rect: [1, 1, 5, 5] }),
  );
  page.node.set(PDFName.of("Annots"), doc.context.obj([link, widget]));
  flipPage(doc, page, "h");
  const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  expect(annots.size()).toBe(1);
  const rect = doc.context
    .lookup(annots.get(0))!
    .toString();
  expect(rect).toContain("400");
  expect(rect).toContain("500");
});

test("invisible text blocks are removed, visible ones stay", () => {
  const src = [
    "q 1 0 0 1 0 0 cm BT /F1 12 Tf (Visible) Tj ET Q",
    "BT 3 Tr /F1 12 Tf 10 10 Td (Hidden OCR layer) Tj ET",
    "q BT 3 Tr (Also hidden) Tj ET Q",
    "BT /F1 12 Tf 0 Tr (After, visible again) Tj ET",
    "BT (A string with ET and 3 Tr inside) Tj ET",
  ].join("\n");
  const { content, removed } = removeInvisibleTextOps(src);
  expect(removed).toBe(2);
  expect(content).toContain("(Visible)");
  expect(content).toContain("(After, visible again)");
  expect(content).toContain("(A string with ET and 3 Tr inside)");
  expect(content).not.toContain("Hidden");
});

test("stripInvisibleText rewrites a real page", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText("Seen", { x: 10, y: 10, size: 12, font });
  const raw = `${pageContentText(page)}\nBT 3 Tr /F1 12 Tf (Ghost) Tj ET`;
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.stream(raw)),
  );
  expect(stripInvisibleText(page)).toBe(1);
  const text = pageContentText(page);
  expect(text).toContain(hex("Seen"));
  expect(text).not.toContain("Ghost");
});
