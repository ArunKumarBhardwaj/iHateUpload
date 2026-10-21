import { expect, test } from "bun:test";
import { PDFArray, PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";

import { buildAlternateMix, planAlternateMix, type MixSource } from "./alternate-mix";

const src = (pages: number, over: Partial<MixSource> = {}): MixSource => ({ pages, take: 1, reverse: false, ...over });
const label = (plan: { file: number; page: number }[]) => plan.map((p) => `${"ABC"[p.file]}${p.page + 1}`).join(" ");

test("takes one page from each file in turn", () => {
  expect(label(planAlternateMix([src(3), src(3)], "append"))).toBe("A1 B1 A2 B2 A3 B3");
});

test("duplex scan: fronts in order plus backs reversed", () => {
  expect(label(planAlternateMix([src(4), src(4, { reverse: true })], "append"))).toBe("A1 B4 A2 B3 A3 B2 A4 B1");
});

test("reversing the first file works too", () => {
  expect(label(planAlternateMix([src(3, { reverse: true }), src(3)], "append"))).toBe("A3 B1 A2 B2 A1 B3");
});

test("unequal lengths: append keeps the rest of the longer file", () => {
  expect(label(planAlternateMix([src(4), src(2)], "append"))).toBe("A1 B1 A2 B2 A3 A4");
  expect(label(planAlternateMix([src(2), src(4)], "append"))).toBe("A1 B1 A2 B2 B3 B4");
});

test("unequal lengths: stop ends with the last complete turn", () => {
  expect(label(planAlternateMix([src(4), src(2)], "stop"))).toBe("A1 B1 A2 B2");
});

test("N pages per turn, per file", () => {
  expect(label(planAlternateMix([src(4, { take: 2 }), src(4, { take: 2 })], "append"))).toBe("A1 A2 B1 B2 A3 A4 B3 B4");
  expect(label(planAlternateMix([src(4, { take: 2 }), src(2)], "append"))).toBe("A1 A2 B1 A3 A4 B2");
});

test("append: a partial last turn is kept, stop drops it", () => {
  expect(label(planAlternateMix([src(3, { take: 2 }), src(4, { take: 2 })], "append"))).toBe("A1 A2 B1 B2 A3 B3 B4");
  expect(label(planAlternateMix([src(3, { take: 2 }), src(4, { take: 2 })], "stop"))).toBe("A1 A2 B1 B2");
});

test("three files keep rotating while two remain", () => {
  expect(label(planAlternateMix([src(1), src(3), src(2)], "append"))).toBe("A1 B1 C1 B2 C2 B3");
});

test("empty or invalid sources are rejected", () => {
  expect(() => planAlternateMix([src(3)], "append")).toThrow();
  expect(() => planAlternateMix([src(3), src(0)], "append")).toThrow();
  expect(() => planAlternateMix([src(3), src(3, { take: 0 })], "append")).toThrow();
});

async function donor(widths: number[], link = false) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  if (link) {
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [0, 0, 50, 50],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com/") },
    });
    doc.getPage(0).node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
  }
  return doc;
}

test("builds the interleaved document, page for page", async () => {
  const a = await donor([101, 102, 103, 104]);
  const b = await donor([201, 202, 203, 204]);
  const out = await buildAlternateMix([a, b], [src(4), src(4, { reverse: true })], "append");
  expect(out.getPages().map((p) => p.getWidth())).toEqual([101, 204, 102, 203, 103, 202, 104, 201]);
});

test("keeps link annotations on copied pages", async () => {
  const a = await donor([101, 102], true);
  const b = await donor([201, 202]);
  const out = await buildAlternateMix([a, b], [src(2), src(2)], "append");
  const annots = out.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  expect(annots.size()).toBe(1);
});
