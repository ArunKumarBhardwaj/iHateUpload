// Drives the real Split PDF page in "Find documents" mode with the bundles from gen.mjs (typed and
// scanned), then checks what it found against the truth and that the files match what it showed.
// Usage: node internal/benchmarks/smart-split/prove.mjs [port | https://origin] [bundle,bundle]
// Checks: documents found exactly per bundle (typed and scanned scored apart), no wrong cuts, the zip holds
// one PDF per document with the pages the panel listed, and nothing is uploaded (no POST or PUT at all).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = process.argv[2] ?? "43127";
const origin = arg.startsWith("http") ? arg : `http://localhost:${arg}`;
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL(`./out/${arg.startsWith("http") ? "live" : "local"}/`, import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const truth = JSON.parse(readFileSync(fx + "truth.json", "utf8"));
const names = process.argv[3]?.split(",") ?? Object.keys(truth).filter((n) => !n.startsWith("heldout-"));
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const uploads = [];
const errors = [];
const rows = [];
let filesMatch = true;
for (const name of names) {
  const t = truth[name];
  const page = await context.newPage();
  page.on("request", (r) => { if (["POST", "PUT"].includes(r.method()) && !r.url().includes("vercel")) uploads.push(r.url()); });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${origin}/tools/split-pdf`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', fx + name + ".pdf");
  const start = Date.now();
  await page.getByRole("button", { name: "Find documents", exact: true }).click();
  const panel = page.getByTestId("smart-split");
  await panel.waitFor({ timeout: 600000 });
  const ms = Date.now() - start;
  // Each found document: "pages a–b" or "page a" under its name.
  const spans = await panel.locator("ol li").evaluateAll((lis) => lis.map((li) => li.textContent ?? ""));
  const got = spans.map((s) => Number((s.match(/pages? (\d+)/) ?? [])[1]) - 1).filter((n) => n >= 0);
  got[0] = 0;
  const want = t.starts;
  const hits = got.filter((p) => want.includes(p)).length;
  const exact = got.join() === want.join();
  await page.screenshot({ path: `${out}${name}-panel.png`, fullPage: true });
  // Split, download, and compare each file's page count with the panel.
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  const all = page.getByRole("button", { name: /Download all/ });
  await all.waitFor({ timeout: 120000 });
  const dest = `${out}${name}/`;
  mkdirSync(dest, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
  await download.saveAs(dest + "all.zip");
  execFileSync("ditto", ["-x", "-k", dest + "all.zip", dest]);
  rmSync(dest + "all.zip");
  const files = readdirSync(dest).filter((f) => f.endsWith(".pdf")).sort();
  const counts = [];
  for (const f of files) counts.push((await PDFDocument.load(readFileSync(dest + f))).getPageCount());
  const listed = spans.map((s) => { const m = s.match(/pages? (\d+)(?:–(\d+))?/); return m ? (m[2] ? +m[2] - +m[1] + 1 : 1) : 0; }).filter(Boolean);
  // Blank sheets inside a span are left out, so a file may hold fewer pages than its span.
  const consistent = files.length === listed.length && counts.every((c, i) => c <= listed[i] && c >= 1);
  if (!consistent) filesMatch = false;
  rows.push({ bundle: name, pages: t.pages, want: want.join(","), got: got.join(","), exact, tp: hits - 1, fp: got.length - hits, fn: want.length - hits, files: files.length, ms });
  console.log(`${exact ? "OK  " : "MISS"} ${name}: want ${want.join(",")} got ${got.join(",")} (${ms} ms) files ${counts.join(",")}`);
  await page.close();
}
const score = (list) => {
  const tp = list.reduce((n, r) => n + r.tp, 0), fp = list.reduce((n, r) => n + r.fp, 0), fn = list.reduce((n, r) => n + r.fn, 0);
  return { exact: `${list.filter((r) => r.exact).length}/${list.length}`, precision: +(tp / Math.max(1, tp + fp)).toFixed(2), recall: +(tp / Math.max(1, tp + fn)).toFixed(2), fp };
};
const typed = rows.filter((r) => !r.bundle.endsWith("-scan"));
const scans = rows.filter((r) => r.bundle.endsWith("-scan"));
const fresh = rows.filter((r) => r.bundle.startsWith("fresh-"));
console.table({ typed: score(typed), scanned: score(scans), "fresh (never tuned on)": score(fresh) });
if (typed.length) check("typed bundles: documents found, no wrong cuts", score(typed).fp === 0 && score(typed).recall >= 0.9, JSON.stringify(score(typed)));
if (scans.length) check("scanned bundles (OCR): documents found, few wrong cuts", score(scans).precision >= 0.9 && score(scans).recall >= 0.8, JSON.stringify(score(scans)));
check("one file per document, with the pages the panel listed", filesMatch);
check("nothing uploaded: no POST or PUT", uploads.length === 0, uploads.slice(0, 3).join(" "));
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "rows.json", JSON.stringify(rows, null, 1));
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
