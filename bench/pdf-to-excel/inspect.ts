// Print what an .xlsx holds: sheets, merges, widths, freeze, filter and the first cells with their types and formats.
// Usage: bun bench/pdf-to-excel/inspect.ts file.xlsx [cells]
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const bytes = readFileSync(process.argv[2]);
const wb = XLSX.read(bytes, { cellNF: true, cellStyles: true });
const zip = await JSZip.loadAsync(bytes);
const limit = Number(process.argv[3] ?? 14);
let i = 0;
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const xml = (await zip.file(`xl/worksheets/sheet${++i}.xml`)?.async("string")) ?? "";
  console.log(
    `--- ${name} ref=${ws["!ref"]} merges=${JSON.stringify(ws["!merges"] ?? [])} cols=${JSON.stringify((ws["!cols"] ?? []).map((c) => c.wch ?? c.wpx))}`,
    `frozen=${/state="frozen"/.test(xml)} filter=${/<autoFilter/.test(xml)}`,
  );
  for (const k of Object.keys(ws).filter((k) => !k.startsWith("!")).slice(0, limit)) {
    console.log("  ", k, JSON.stringify(ws[k].v), ws[k].t, ws[k].z ?? "", ws[k].s ? JSON.stringify(ws[k].s).slice(0, 80) : "");
  }
}
const styles = await zip.file("xl/styles.xml")?.async("string");
console.log("styles: fills", (styles?.match(/<fill>/g) ?? []).length, "borders", (styles?.match(/<border>/g) ?? []).length, "bold", /<b\/>/.test(styles ?? ""));
