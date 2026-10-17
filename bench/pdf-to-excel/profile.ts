// Where the time goes for one PDF in Node: bun bench/pdf-to-excel/profile.ts file.pdf
import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createEditor } from "../../src/lib/pdf-to-excel/edit";
import { pagesToPrepared } from "../../src/lib/pdf-to-excel/convert";
import { extractPage } from "../../src/lib/pdf-to-word/extract";

const data = new Uint8Array(readFileSync(process.argv[2]));
const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
for (let run = 0; run < 3; run++) {
  const t0 = performance.now();
  const pdf = await getDocument({ data: data.slice(), fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const t1 = performance.now();
  const inputs = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    inputs.push((await extractPage(page as never, OPS as unknown as Record<string, number>, n)).input);
  }
  const t2 = performance.now();
  const editor = createEditor(pagesToPrepared(inputs, inputs.map((_, i) => i + 1), { layout: "tables", includeText: true }, "t"));
  const t3 = performance.now();
  await editor.build();
  const t4 = performance.now();
  console.log(`open ${(t1 - t0).toFixed(0)}  extract ${(t2 - t1).toFixed(0)}  detect ${(t3 - t2).toFixed(0)}  write ${(t4 - t3).toFixed(0)}  total ${(t4 - t0).toFixed(0)} ms`);
}
