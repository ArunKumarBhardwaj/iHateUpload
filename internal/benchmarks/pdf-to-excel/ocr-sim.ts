// Node stand-in for the browser's OCR path: rasterise page 1 at a width, read it with Tesseract, build the workbook.
// Usage: bun internal/benchmarks/pdf-to-excel/ocr-sim.ts scan.pdf [width=2448]
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, PSM } from "tesseract.js";

import { pagesToWorkbook } from "../../../src/lib/pdf-to-excel/convert";
import { lineText } from "../../../src/lib/pdf-to-word/lines";
import { readPages } from "../../../src/lib/pdf-to-excel/grid";
import { buildLines } from "../../../src/lib/pdf-to-word/lines";
import { ocrBlocksToItems } from "../../../src/lib/pdf-to-word/ocr";
import { keepShortWords } from "../../../src/lib/pdf-to-excel/ocr";

const width = Number(process.argv[3] ?? 2448);
const dir = join(tmpdir(), "ocr-sim");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const swift = join(dirname(fileURLToPath(import.meta.url)), "../pdf-to-word/realistic/pdf2png.swift");
spawnSync("swift", [swift, process.argv[2], dir, String(width)]);
const worker = await createWorker("eng", 1);
await worker.setParameters({ tessedit_pageseg_mode: process.env.PSM === "auto" ? PSM.AUTO : PSM.SINGLE_BLOCK });
const { data } = await worker.recognize(join(dir, "p1.png"), {}, { blocks: true });
await worker.terminate();
const scale = width / 612;
const items = ocrBlocksToItems(keepShortWords(data.blocks as never) as never, scale, 792);
const input = { width: 612, height: 792, items, rules: [], images: [] };
console.log("lines:", buildLines(items).map((l) => lineText(l)).join(" | "));
const parts = readPages([input], [1], [1]);
for (const g of parts[0].grids) for (const row of g.rows) console.log(JSON.stringify(row.map((c) => c.text)));
console.log("rest:", parts[0].rest.map((l) => lineText(l)).join(" | "));
void pagesToWorkbook;
