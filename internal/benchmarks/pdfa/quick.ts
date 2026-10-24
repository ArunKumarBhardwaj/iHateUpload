// Fast loop for development: converts every fixture with a stand-in picture renderer
// (a grey JPEG) and asks veraPDF. The real run, with real pictures, is prove.mjs in the browser.
// Usage: bun internal/benchmarks/pdfa/quick.ts [1b|2b|3b ...]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
import { convertToPdfA, type PdfALevel } from "../../../src/lib/pdfa/convert";

const here = new URL(".", import.meta.url).pathname;
const out = here + "out/quick/";
mkdirSync(out, { recursive: true });
const levels = (process.argv.slice(2).length ? process.argv.slice(2) : ["1b", "2b", "3b"]) as PdfALevel[];
const jpeg = new Uint8Array(readFileSync(here + "tiny-grey.jpg"));
const loadFont = async (f: string) => new Uint8Array(readFileSync("node_modules/pdfjs-dist/standard_fonts/" + f));
for (const file of readdirSync(here + "fx").filter((f) => f.endsWith(".pdf")).sort()) {
  for (const level of levels) {
    const doc = await PDFDocument.load(readFileSync(here + "fx/" + file), { updateMetadata: false });
    const t = performance.now();
    const report = await convertToPdfA(doc, level, { loadFont, picture: async () => ({ jpeg, text: [] }) });
    const ms = Math.round(performance.now() - t);
    const target = `${out}${file.replace(/\.pdf$/, "")}-${level}.pdf`;
    writeFileSync(target, report.bytes);
    const v = spawnSync("verapdf", ["-f", level, "--format", "text", "-v", target], { encoding: "utf8" }).stdout.trim();
    const rules = v.split("\n").slice(1).map((l) => l.trim().replace(/^FAIL /, "")).join(" ");
    console.log(`${v.startsWith("PASS") ? "PASS" : "FAIL"} ${level} ${file.padEnd(24)} ${ms}ms pics=${report.pagesAsPictures.join(",") || "-"} ${rules} ${report.changes.filter((c) => c.startsWith("Drew page")).join(" | ")}`);
  }
}
