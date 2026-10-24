import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { makePng, makeSamplePdf } from "@/lib/pdf-to-word/fixture";

import { batchTexts, buildTranslateBody, parseTranslations } from "./gemini-translate";
import { fitText } from "./layout";
import { collectUnits, translatePdf } from "./translate";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const loadFont = async (file: string) => new Uint8Array(readFileSync(`${process.cwd()}/public/fonts/${file}`));
const deps = {
  OPS: OPS as unknown as Record<string, number>,
  rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" as const }),
};
const open = (data: Uint8Array) => getDocument({ data: data.slice(), fontExtraProperties: true, standardFontDataUrl: FONTS, verbosity: 0 }).promise;

async function textOf(bytes: Uint8Array) {
  const pdf = await open(bytes);
  let all = "";
  for (let n = 1; n <= pdf.numPages; n++) all += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  return { text: all.replace(/\s+/g, " "), pages: pdf.numPages };
}

test("texts are batched in order under the size limit", () => {
  const texts = ["a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(500)];
  const batches = batchTexts(texts, 100);
  expect(batches.map((b) => b.map((i) => texts[i][0]).join(""))).toEqual(["ab", "c", "d"]);
});

test("the request asks for a JSON list of the same length", () => {
  const body = buildTranslateBody("es", ["Hello", "World"]) as { contents: { parts: { text: string }[] }[]; generationConfig: { responseMimeType: string; responseSchema: unknown } };
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.generationConfig.responseSchema).toEqual({ type: "ARRAY", items: { type: "STRING" } });
  expect(JSON.stringify(body)).toContain("Spanish");
  expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(["Hello", "World"]);
});

test("answers are checked for length and shape", () => {
  expect(parseTranslations('["Hola","Mundo"]', 2)).toEqual(["Hola", "Mundo"]);
  expect(parseTranslations('```json\n["Hola","Mundo"]\n```', 2)).toEqual(["Hola", "Mundo"]);
  expect(parseTranslations('["Hola"]', 2)).toBeNull();
  expect(parseTranslations("not json", 2)).toBeNull();
  expect(parseTranslations('[1, "x"]', 2)).toBeNull();
});

test("long text shrinks to fit its box; short text keeps its size", () => {
  const measure = (s: string, size: number) => s.length * size * 0.5;
  const short = fitText("Hola", 200, 14, 12, measure);
  expect(short.size).toBe(12);
  expect(short.lines).toEqual(["Hola"]);
  const long = fitText("una frase bastante larga que no cabe en una sola linea", 120, 30, 12, measure);
  expect(long.size).toBeLessThan(12);
  expect((long.lines.length * 1.15 - 0.15) * long.size).toBeLessThanOrEqual(30.5);
  for (const line of long.lines) expect(measure(line, long.size)).toBeLessThanOrEqual(120.5);
});

test("units cover paragraphs and table cells, with boxes on the page", async () => {
  const pdf = await open(await makeSamplePdf());
  const { units } = await collectUnits(pdf as never, deps, () => {});
  const texts = units.map((u) => u.text);
  expect(texts).toContain("Quarterly Report");
  expect(texts).toContain("Pears");
  for (const u of units) {
    expect(u.box.w).toBeGreaterThan(0);
    expect(u.box.x + u.box.w).toBeLessThanOrEqual(1.001);
  }
});

test("the translated PDF swaps the words and keeps the pages and the picture", async () => {
  const source = await makeSamplePdf();
  const result = await translatePdf(source, {
    deps,
    loadFont,
    script: "latin",
    translate: async (texts) => texts.map((t) => t.toUpperCase()),
    onProgress: () => {},
    open: (data) => open(data) as never,
  });
  const before = await textOf(source);
  const after = await textOf(result.bytes);
  expect(after.pages).toBe(before.pages);
  expect(after.text).toContain("QUARTERLY REPORT");
  expect(after.text).toContain("PEARS");
  expect(after.text).not.toContain("Quarterly Report");
  expect(after.text).not.toContain("The quick brown fox");
  expect(new TextDecoder("latin1").decode(result.bytes)).toContain("/Image");
  expect(result.units).toBeGreaterThan(5);
});
