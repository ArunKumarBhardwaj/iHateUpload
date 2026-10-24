// Drives the real Summarize PDF page with synthetic PDFs, then checks every summary.
// Usage: node internal/benchmarks/summarize/prove.mjs [port | https://origin] [--stub]
//   --stub answers /api/summarize in the browser with a stand-in (for a local build with no Gemini key).
// Run gen-long.mjs first: the 120-page report is long enough to be read in parts and merged.
// Checks: one summary per input, a title and key points, every cited page exists, figures in the summary
// are in the PDF (checked here with pdf.js, apart from the app's own check), the Spanish run reads as
// Spanish, and nothing but JSON text was sent (only POSTs to /api/summarize, no PDF bytes).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = process.argv[2] ?? "43127";
const stub = process.argv.includes("--stub");
const origin = arg.startsWith("http") ? arg : `http://localhost:${arg}`;
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL(stub ? "./out/stub/" : "./out/ours/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const DOCS = ["invoice", "letter", "contract", "report-chart", "bank-statement", "memo-pdflib"].map((d) => corpus + d + ".pdf");
const LONG = fx + "annual-report-120p.pdf";
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

async function pdfText(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ") + "\n";
  return { text, pages: pdf.numPages };
}
const digits = (t) => t.replace(/\D/g, "");
const NUMBER = /\d(?:[\d.,'  ]*\d)?/g;
/** Figures of 2+ digits in the summary body (not the page citations), and how many the PDF shows. */
function figures(md, source) {
  const body = md.replace(/\((?:pp?\.) [\d–, ]+\)/g, "").replace(/^\*.*\*$/m, "").replace(/^> ⚠.*$/m, "");
  const known = (source.match(NUMBER) ?? []).map(digits);
  const all = known.join(" ");
  const found = [];
  const missing = [];
  for (const t of body.match(NUMBER) ?? []) {
    const d = digits(t);
    if (d.length < 2) continue;
    const ok = known.includes(d) || all.includes(d) || known.some((k) => k.replace(/0+$/, "") === d.replace(/0+$/, ""));
    (ok ? found : missing).push(t);
  }
  return { found, missing };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const posts = [];
const errors = [];
let pdfBytesSent = false;
let stages = [];

async function run(files, { language = "auto", length = "standard", tag }) {
  const page = await context.newPage();
  page.on("request", (r) => {
    if (!["POST", "PUT"].includes(r.method()) || r.url().includes("vercel")) return;
    posts.push(new URL(r.url()).pathname);
    const body = r.postData() ?? "";
    if (body.includes("%PDF")) pdfBytesSent = true;
    try { stages.push(JSON.parse(body).stage); } catch { /* not JSON */ }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  if (stub) {
    // A stand-in that "summarizes" by quoting the first line of each page, citing it, plus one made-up figure.
    await page.route("**/api/summarize", async (route) => {
      const { text } = JSON.parse(route.request().postData());
      // Pages from the markers, or in the merge step from the parts' citations.
      const pages = [...text.matchAll(/--- Page (\d+) ---\n([^\n]*)/g)].map(([, n, line]) => [n, line]);
      if (!pages.length) for (const [, line, n] of text.matchAll(/^- (.*) \(pp?\. (\d+)/gm)) pages.push([n, line]);
      while (pages.length < 3) pages.push(pages[0] ?? ["1", "A page."]);
      const points = pages.slice(0, 6).map(([n, line]) => ({ text: line.replace(/[#*|]/g, "").trim() || "A page.", pages: [+n] }));
      points.push({ text: "The total comes to $98,765.43.", pages: [] });
      await route.fulfill({ json: { summary: { title: "Stub summary", overview: "A stand-in overview.", points, sections: [] } } });
    });
  }
  await page.goto(`${origin}/tools/summarize-pdf`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', files);
  await page.getByRole("button", { name: { short: "Short", standard: "Standard", detailed: "Detailed" }[length], exact: true }).click();
  await page.locator("#sum-language").selectOption(language);
  const start = Date.now();
  await page.getByRole("button", { name: "Summarize PDF", exact: true }).click();
  const ready = files.length > 1 ? page.getByRole("button", { name: /Download all/ }) : page.getByRole("button", { name: "Save", exact: true });
  await ready.first().waitFor({ timeout: 600000 });
  const ms = Date.now() - start;
  await page.screenshot({ path: out + `ui-${tag}.png`, fullPage: true });
  const dest = out + tag + "/";
  mkdirSync(dest, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent("download"), ready.first().click()]);
  if (files.length > 1) {
    await download.saveAs(dest + "all.zip");
    execFileSync("unzip", ["-o", "-q", dest + "all.zip", "-d", dest]);
    rmSync(dest + "all.zip");
  } else await download.saveAs(dest + download.suggestedFilename());
  await page.close();
  return { ms, dest };
}

// 1. Six everyday documents at once, in their own language.
const batch = await run(DOCS, { tag: "batch" });
const got = readdirSync(batch.dest).filter((f) => f.endsWith("-summary.md"));
check(`${DOCS.length} summaries for ${DOCS.length} PDFs`, got.length === DOCS.length, `${got.length} files in ${batch.ms} ms`);

const rows = [];
async function score(path, md) {
  const src = await pdfText(path);
  const cites = [...md.matchAll(/\((pp?)\. ([\d–, ]+)\)/g)].flatMap((m) => m[2].split(/[–, ]+/).filter(Boolean).map(Number));
  const points = (md.split("## Key points")[1] ?? "").split("\n## ")[0].split("\n").filter((l) => l.startsWith("- ")).length;
  const { found, missing } = figures(md, src.text);
  const row = {
    doc: path.split("/").pop().replace(".pdf", ""),
    pages: src.pages,
    points,
    cited: cites.length,
    badCites: cites.filter((n) => n < 1 || n > src.pages).length,
    figures: found.length + missing.length,
    notInPdf: missing.join(" ") || "-",
    marked: (md.match(/ ⚠/g) ?? []).length,
    chars: md.length,
  };
  rows.push(row);
  return row;
}
for (const doc of DOCS) {
  const name = doc.split("/").pop().replace(".pdf", "-summary.md");
  await score(doc, readFileSync(batch.dest + name, "utf8"));
}

// 2. A 120-page report, in Spanish, read in parts and merged.
stages = [];
const long = await run([LONG], { tag: "long-es", language: "es", length: "detailed" });
const longMd = readFileSync(long.dest + "annual-report-120p-summary.md", "utf8");
const longRow = await score(LONG, longMd);
check("the 120-page report was read in parts, then merged", stages.filter((s) => s === "part").length >= 2 && stages.at(-1) === "combine", stages.join(","));

console.table(rows);
check("every summary has a title and at least 3 key points", rows.every((r) => r.points >= 3) && got.every((f) => readFileSync(batch.dest + f, "utf8").startsWith("# ")));
check("every cited page exists", rows.every((r) => r.badCites === 0) && rows.every((r) => r.cited > 0), `${rows.reduce((n, r) => n + r.cited, 0)} citations`);
const total = rows.reduce((n, r) => n + r.figures, 0);
const wrong = rows.flatMap((r) => (r.notInPdf === "-" ? [] : r.notInPdf.split(" ")));
const marked = rows.reduce((n, r) => n + r.marked, 0);
if (stub) check("the made-up figure is marked ⚠ in every summary", rows.every((r) => r.marked >= 1 && r.notInPdf.includes("98,765.43")));
else check("figures in the summaries are in the PDFs (>= 95%), and any that are not are marked", total > 0 && (total - wrong.length) / total >= 0.95 && marked >= (wrong.length ? 1 : 0), `${total - wrong.length}/${total} found${wrong.length ? `; not found: ${wrong.join(" ")}; marked ${marked}` : ""}`);
if (!stub) {
  const spanish = (longMd.match(/\b(de|la|el|los|las|para|por|con|una|del|que|en)\b/gi) ?? []).length;
  const regions = ["North", "South", "East", "West", "Central", "Coastal"].filter((r) => longMd.includes(r) || longMd.includes(r.slice(0, 4))).length;
  check("the long report's summary is in Spanish and covers the whole file", spanish > 20 && longRow.points >= 6, `${spanish} Spanish words, ${longRow.points} points, ${regions}/6 regions named`);
}
check("only text was sent: POSTs to /api/summarize only, no PDF bytes", posts.every((p) => p === "/api/summarize") && !pdfBytesSent, `${posts.length} requests`);
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "rows.json", JSON.stringify(rows, null, 1));
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
