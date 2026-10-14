import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { buildCmap, embeddingFlags, mayEmbed, mergeSubsets, obfuscate, readCmap, readSfnt, retarget, unicodeMap, writeSfnt } from "./sfnt";

const FIXTURES = join(import.meta.dir, "../../../bench/pdf-to-word/fixtures");
const STD = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

/** Every font pdf.js converted on page 1 of a fixture, keyed by the PDF's own font name. */
async function pdfFonts(name: string): Promise<{ name: string; data: Uint8Array }[]> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(join(FIXTURES, name + ".pdf"))), fontExtraProperties: true, standardFontDataUrl: STD }).promise;
  const page = await pdf.getPage(1);
  await page.getOperatorList();
  const content = await page.getTextContent();
  const ids = new Set((content.items as { fontName: string }[]).map((i) => i.fontName));
  return [...ids].map((id) => {
    const font = page.commonObjs.get(id) as { name: string; data: Uint8Array };
    return { name: font.name, data: font.data };
  });
}

const sum32 = (d: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s = (s + (((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | (d[i + 3] ?? 0)) >>> 0)) >>> 0;
  return s;
};

test("a font read and written again keeps its tables and has valid checksums", async () => {
  const [font] = await pdfFonts("rich-formatting");
  const sfnt = readSfnt(font.data)!;
  expect(sfnt).not.toBeNull();
  const again = readSfnt(writeSfnt(sfnt.flavor, sfnt.tables))!;
  expect([...again.tables.keys()].sort()).toEqual([...sfnt.tables.keys()].sort());
  for (const [tag, body] of sfnt.tables) if (tag !== "head") expect(again.tables.get(tag)).toEqual(body);
  expect(sum32(writeSfnt(sfnt.flavor, sfnt.tables))).toBe(0xb1b0afba);
});

test("a cmap built from a map reads back the same, with private-use copies of real characters dropped", () => {
  const map = new Map<number, number>([
    [0x20, 3],
    [0x41, 4],
    [0x42, 5],
    [0xe000, 4], // a private-use copy of "A"
    [0xe001, 9], // a glyph that only has a private-use code
    [0x1f600, 12],
  ]);
  const back = unicodeMap(buildCmap(map));
  expect([...back].sort((a, b) => a[0] - b[0])).toEqual([
    [0x20, 3],
    [0x41, 4],
    [0x42, 5],
    [0xe001, 9],
    [0x1f600, 12],
  ]);
  // Word reads the Windows Unicode BMP subtable
  expect(readCmap(buildCmap(map)).some((s) => s.platform === 3 && s.encoding === 1)).toBe(true);
});

test("obfuscation XORs the first 32 bytes with the key GUID read from its last byte, and undoes itself", () => {
  const font = Uint8Array.from({ length: 64 }, (_, i) => i);
  const guid = "{00112233-4455-6677-8899-AABBCCDDEEFF}";
  const out = obfuscate(font, guid);
  expect(out[0]).toBe(0 ^ 0xff);
  expect(out[1]).toBe(1 ^ 0xee);
  expect(out[15]).toBe(15 ^ 0x00);
  expect(out[16]).toBe(16 ^ 0xff);
  expect(out[32]).toBe(32);
  expect(obfuscate(out, guid)).toEqual(font);
});

test("fonts that forbid embedding stay out", async () => {
  const [font] = await pdfFonts("rich-formatting");
  const sfnt = readSfnt(font.data)!;
  expect(mayEmbed(sfnt.tables)).toBe(true);
  for (const bits of [0x0002, 0x0004]) {
    const os2 = sfnt.tables.get("OS/2")!.slice();
    new DataView(os2.buffer).setUint16(8, bits);
    expect(mayEmbed(new Map(sfnt.tables).set("OS/2", os2))).toBe(false);
  }
  expect(embeddingFlags(sfnt.tables)).toBe(0);
});

test("retargeting names the font and keeps its glyphs", async () => {
  const fonts = await pdfFonts("rich-formatting");
  const georgia = fonts.find((f) => f.name.includes("Georgia"))!;
  const sfnt = readSfnt(georgia.data)!;
  const out = readSfnt(retarget(sfnt, "Georgia", { bold: true, italic: false }, unicodeMap(sfnt.tables.get("cmap"))))!;
  const name = new TextDecoder("utf-16be").decode(out.tables.get("name")!.subarray(out.tables.get("name")!.length - 80));
  expect(name).toContain("Georgia");
  expect(out.tables.get("glyf")).toEqual(sfnt.tables.get("glyf"));
  expect(sum32(writeSfnt(out.flavor, out.tables))).toBe(0xb1b0afba);
  expect(unicodeMap(out.tables.get("cmap")).get(0x47)).toBe(unicodeMap(sfnt.tables.get("cmap")).get(0x47));
});

test("two subsets of one font merge into one that has the characters of both", async () => {
  const fonts = (await pdfFonts("rich-formatting")).filter((f) => f.name.endsWith("TimesNewRomanPSMT"));
  expect(fonts.length).toBeGreaterThan(2);
  let merged = readSfnt(fonts[0].data)!;
  const chars = new Set(unicodeMap(merged.tables.get("cmap")).keys());
  for (const f of fonts.slice(1)) {
    const next = readSfnt(f.data)!;
    for (const c of unicodeMap(next.tables.get("cmap")).keys()) chars.add(c);
    merged = mergeSubsets(merged, next)!;
    expect(merged).not.toBeNull();
  }
  const have = unicodeMap(merged.tables.get("cmap"));
  for (const c of chars) if (c < 0xe000) expect(have.has(c)).toBe(true);
  expect(sum32(writeSfnt(merged.flavor, merged.tables))).toBe(0xb1b0afba);
});

test("subsets that disagree about a glyph do not merge", async () => {
  const fonts = await pdfFonts("rich-formatting");
  const regular = readSfnt(fonts.find((f) => f.name.endsWith("TimesNewRomanPSMT"))!.data)!;
  const georgia = readSfnt(fonts.find((f) => f.name.includes("Georgia"))!.data)!;
  expect(mergeSubsets(regular, georgia)).toBeNull();
});
