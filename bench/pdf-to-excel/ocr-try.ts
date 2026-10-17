// Try OCR settings on a PNG: bun bench/pdf-to-excel/ocr-try.ts page.png
import { createWorker, PSM } from "tesseract.js";

for (const [name, psm] of [["AUTO", PSM.AUTO], ["SINGLE_BLOCK", PSM.SINGLE_BLOCK], ["SPARSE", PSM.SPARSE_TEXT]] as const) {
  const worker = await createWorker("eng", 1);
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const t0 = performance.now();
  const { data } = await worker.recognize(process.argv[2]);
  const text = data.text.split("\n").filter((l) => /oil|filter|clamp|fluid/i.test(l));
  console.log(name, Math.round(performance.now() - t0), "ms", JSON.stringify(text));
  await worker.terminate();
}
