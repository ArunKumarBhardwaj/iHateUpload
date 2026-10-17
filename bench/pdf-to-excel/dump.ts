// Convert a PDF in Node (no browser) and print what each sheet holds. Usage: bun bench/pdf-to-excel/dump.ts file.pdf [out.xlsx]
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

import { pagesToWorkbook } from "../../src/lib/pdf-to-excel/convert";
import { loadPages } from "../../src/lib/pdf-to-excel/testing";
import { writeXlsx } from "../../src/lib/pdf-to-excel/xlsx-writer";

const file = process.argv[2];
const pages = await loadPages(new Uint8Array(readFileSync(file)));
const { book, tables, notes } = pagesToWorkbook(pages, pages.map((_, i) => i + 1), { layout: (process.env.LAYOUT as "tables" | "pages") ?? "tables", includeText: true }, "t");
const bytes = await writeXlsx(book);
if (process.argv[3]) writeFileSync(process.argv[3], bytes);
console.log("tables", tables, notes);
const wb = XLSX.read(bytes, { cellNF: true });
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
  console.log(`--- ${name} (${rows.length} rows) merges=${ws["!merges"]?.length ?? 0}`);
  for (const r of rows.slice(0, Number(process.env.ROWS ?? 12))) console.log("  ", JSON.stringify(r));
  if (rows.length > 12) console.log("   ...", JSON.stringify(rows[rows.length - 1]));
}
