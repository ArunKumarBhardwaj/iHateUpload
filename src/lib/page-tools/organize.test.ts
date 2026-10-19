import { expect, test } from "bun:test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import { buildOrganized } from "./organize";
import type { OrganizeEntry } from "./types";

async function donor() {
  const doc = await PDFDocument.create();
  [[100, 200], [300, 150], [120, 120]].forEach(([w, h]) => doc.addPage([w, h]));
  doc.getPage(1).setRotation(degrees(90));
  return doc;
}

const e = (id: string, src: number, turn: OrganizeEntry["turn"] = 0): OrganizeEntry => ({ id, src, turn });

test("reorders, drops, and duplicates pages", async () => {
  const out = await buildOrganized(await donor(), [e("a", 2), e("b", 0), e("c", 0)]);
  expect(out.getPages().map((p) => p.getWidth())).toEqual([120, 100, 100]);
});

test("turns stack on the page's own /Rotate, each copy on its own", async () => {
  const out = await buildOrganized(await donor(), [e("a", 1, 90), e("b", 1), e("c", 0, 270)]);
  expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 90, 270]);
});

test("blank pages copy the previous page's size", async () => {
  const out = await buildOrganized(await donor(), [e("a", 0), e("b", -1), e("c", 2), e("d", -1)]);
  expect(out.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
    [100, 200], [100, 200], [120, 120], [120, 120],
  ]);
});

test("a blank first page borrows the next page's size", async () => {
  const out = await buildOrganized(await donor(), [e("a", -1), e("b", 2)]);
  expect(out.getPage(0).getWidth()).toBe(120);
});

test("rejects pages that do not exist", async () => {
  await expect(buildOrganized(await donor(), [e("a", 9)])).rejects.toThrow();
});
