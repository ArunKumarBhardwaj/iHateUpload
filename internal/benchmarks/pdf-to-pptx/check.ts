// Opens each out/*.pptx in LibreOffice (headless, converted to PDF) and reads slides and text back.
// Usage: bun internal/benchmarks/pdf-to-pptx/check.ts [prefix]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

const out = new URL("./out/", import.meta.url).pathname;
const lo = out + "lo/";
mkdirSync(lo, { recursive: true });
const prefix = process.argv[2] ?? "";
// With a second argument, read PDFs another app already exported (e.g. out/keynote/) instead of running LibreOffice.
const APP_PDFS = process.argv[3];
const EXPECT: Record<string, string[]> = {
  deck: ["Northwind Field Survey", "Quarterly results", "What we found", "Coverage grew in every region", "Next survey starts in March", "Readings per region", "North", "290", "Sites at a glance", "Dogwood", "95.2%"],
  report: ["Quarterly Report", "The quick brown fox", "First bullet item", "Pears", "Closing line"],
};
for (const file of readdirSync(out).filter((f) => f.endsWith(".pptx") && f.startsWith(prefix)).sort()) {
  const pdf = (APP_PDFS ?? lo) + file.replace(/\.pptx$/, ".pdf");
  if (!APP_PDFS) execFileSync("soffice", [`-env:UserInstallation=file://${out}lo-profile`, "--headless", "--convert-to", "pdf", "--outdir", lo, out + file], { stdio: "ignore", timeout: 120000 });
  if (!existsSync(pdf)) { console.log(`${file}\tLibreOffice could not open it`); continue; }
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: VerbosityLevel.ERRORS }).promise;
  let text = "";
  for (let n = 1; n <= doc.numPages; n++) text += (await (await doc.getPage(n)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + " ";
  const key = file.includes("deck") ? "deck" : "report";
  const want = EXPECT[key].filter((s) => !file.includes("range") || !["Northwind Field Survey", "Quarterly results", "Sites at a glance", "Dogwood", "95.2%"].includes(s));
  const found = want.filter((s) => text.replace(/\s+/g, " ").includes(s));
  console.log(`${file}\tslides ${doc.numPages}\ttext ${found.length}/${want.length}${found.length < want.length ? "\tmissing: " + want.filter((s) => !found.includes(s)).join(" | ") : ""}`);
  await doc.loadingTask.destroy();
}
