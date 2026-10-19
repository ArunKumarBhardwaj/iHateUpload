import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { FontCollector, type FontInput } from "./embed";
import { fontFlags } from "./fonts";
import { makeSamplePdf } from "./fixture";
import { readSfnt, unicodeMap } from "./sfnt";

const STD = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

async function fontsOf(data: Uint8Array): Promise<(FontInput & { id: string })[]> {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: STD }).promise;
  const page = await pdf.getPage(1);
  await page.getOperatorList();
  const content = await page.getTextContent();
  const ids = [...new Set((content.items as { fontName: string }[]).map((i) => i.fontName))];
  return ids.map((id) => {
    const f = page.commonObjs.get(id) as { name: string; data: Uint8Array };
    const flags = fontFlags(f.name);
    return { id, name: f.name, data: f.data, ...flags };
  });
}

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dir, "../../../internal/benchmarks/pdf-to-word/fixtures", name + ".pdf")));

test("subsets of one face become one embedded font under the family name", async () => {
  const collector = new FontCollector();
  const names = (await fontsOf(fixture("rich-formatting"))).map((f) => collector.add(f.id, f));
  expect(names.every((n) => n !== null)).toBe(true);
  const fonts = collector.fonts();
  const label = (f: (typeof fonts)[number]) => `${f.family}${f.bold ? " bold" : ""}${f.italic ? " italic" : ""}`;
  expect(fonts.map(label).sort()).toEqual(
    ["Arial", "Courier New", "Georgia", "Times New Roman", "Times New Roman bold", "Times New Roman bold italic", "Times New Roman italic"].sort(),
  );
  // the regular face has the letters of every regular subset (a, e, g, l, m, r, s, u, 2, 3, i ...)
  const regular = fonts.find((f) => f.family === "Times New Roman" && !f.bold && !f.italic)!;
  const chars = unicodeMap(readSfnt(regular.data)!.tables.get("cmap"));
  for (const ch of "aelmsrgu23i") expect(chars.has(ch.charCodeAt(0))).toBe(true);
});

test("a font the PDF did not embed is not embedded either", async () => {
  const collector = new FontCollector();
  for (const f of await fontsOf(await makeSamplePdf())) expect(collector.add(f.id, f)).toBeNull();
  expect(collector.fonts()).toEqual([]);
});

test("a font that forbids embedding is left out", async () => {
  const [font] = await fontsOf(fixture("rich-formatting"));
  const sfnt = readSfnt(font.data!)!;
  const os2 = sfnt.tables.get("OS/2")!.slice();
  new DataView(os2.buffer).setUint16(8, 2);
  const tables = new Map(sfnt.tables).set("OS/2", os2);
  const { writeSfnt } = await import("./sfnt");
  expect(new FontCollector().add("x", { ...font, data: writeSfnt(sfnt.flavor, tables) })).toBeNull();
});

test("the same font id gives the same answer every time", async () => {
  const collector = new FontCollector();
  const [font] = await fontsOf(fixture("rich-formatting"));
  const first = collector.add(font.id, font);
  expect(collector.add(font.id, font)).toBe(first);
  expect(collector.fonts().length).toBe(1);
});
