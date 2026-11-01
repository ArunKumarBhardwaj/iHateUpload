// Converts each synthetic bank statement and scores the transactions against the truth.
// Usage: bun internal/benchmarks/pdf-to-excel/bank-probe.ts [style] [--dump]
import { writeFileSync, mkdirSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

import { BANK_STYLES, makeBankStatement, type BankStyle } from "../../../src/lib/pdf-to-excel/bank-fixtures";
import { scoreStatement } from "../../../src/lib/pdf-to-excel/bank-score";
import { convertPdfToExcel } from "../../../src/lib/pdf-to-excel/index";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const args = process.argv.slice(2);
const styles = (args.filter((a) => !a.startsWith("--")) as BankStyle[]).length ? (args.filter((a) => !a.startsWith("--")) as BankStyle[]) : BANK_STYLES;
const out = `${process.cwd()}/internal/benchmarks/pdf-to-excel/bank-corpus`;
mkdirSync(out, { recursive: true });
for (const style of styles) {
  const { bytes, truth } = await makeBankStatement(style);
  writeFileSync(`${out}/${style}.pdf`, bytes);
  const pdf = await getDocument({ data: bytes.slice(), fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const t0 = performance.now();
  const result = await convertPdfToExcel(pdf as never, style, { layout: "tables", includeText: true, language: "eng", range: "" }, { OPS: OPS as never }, () => {});
  const ms = performance.now() - t0;
  const wb = XLSX.read(result.bytes);
  const s = scoreStatement(wb, truth, XLSX);
  console.log(`${style.padEnd(6)} pages ${truth.pages} sheets [${wb.SheetNames.join(", ")}] txns ${s.found}/${truth.txns.length} exact ${s.exact} (${(100 * s.exact / truth.txns.length).toFixed(1)}%) extra rows ${s.extra} ${Math.round(ms)} ms`);
  if (args.includes("--dump")) {
    for (const name of wb.SheetNames.slice(0, 2)) {
      console.log("--", name);
      console.log(XLSX.utils.sheet_to_csv(wb.Sheets[name]).split("\n").slice(0, 14).join("\n"));
    }
    console.log("notes:", result.notes);
    if (s.misses.length) console.log("misses:", s.misses.slice(0, 4));
  }
}
