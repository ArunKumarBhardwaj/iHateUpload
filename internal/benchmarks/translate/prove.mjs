// Drives the real Translate PDF page with corpus PDFs into Spanish, then checks each output.
// Usage: node internal/benchmarks/translate/prove.mjs [port | https://origin] [--stub]
//   --stub answers /api/translate in the browser with a stand-in (for a local build with no Gemini key).
// Checks: one PDF per input, same page count, source words replaced, every number kept, Spanish words present,
// and nothing but JSON text sent (only POSTs to /api/translate, no PDF bytes).
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
const out = new URL(stub ? "./out/stub/" : "./out/ours/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const DOCS = ["invoice", "letter", "memo-pdflib", "brochure", "report-chart", "contract"];
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

async function pdfText(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ") + "\n";
  return { text: text.replace(/\s+/g, " "), pages: pdf.numPages };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const page = await context.newPage();
const posts = [];
const errors = [];
let pdfBytesSent = false;
page.on("request", (r) => {
  if (!["POST", "PUT"].includes(r.method()) || r.url().includes("vercel")) return;
  posts.push(new URL(r.url()).pathname);
  if ((r.postData() ?? "").includes("%PDF")) pdfBytesSent = true;
});
page.on("pageerror", (e) => errors.push(e.message));
if (stub) {
  // A stand-in that "translates" by tagging words, about as long as Spanish runs.
  await page.route("**/api/translate", async (route) => {
    const { texts } = JSON.parse(route.request().postData());
    const translations = texts.map((t) => t.split(" ").map((w) => (/\p{L}{4,}/u.test(w) ? `${w}ción` : w)).join(" "));
    await route.fulfill({ json: { translations } });
  });
}
await page.goto(`${origin}/tools/translate-pdf`, { waitUntil: "networkidle" });
await page.setInputFiles('input[aria-label="Choose files"]', DOCS.map((d) => corpus + d + ".pdf"));
await page.locator("#tr-target").selectOption("es");
const start = Date.now();
await page.getByRole("button", { name: "Translate PDF", exact: true }).click();
const all = page.getByRole("button", { name: /Download all/ });
await all.waitFor({ timeout: 600000 });
const ms = Date.now() - start;
await page.screenshot({ path: out + "ui-results.png", fullPage: true });
const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
await download.saveAs(out + "all.zip");
execFileSync("unzip", ["-o", "-q", out + "all.zip", "-d", out]);
rmSync(out + "all.zip");
const got = readdirSync(out).filter((f) => f.endsWith("-es.pdf"));
check(`${DOCS.length} PDFs translated into Spanish`, got.length === DOCS.length, `${got.length} files in ${ms} ms`);

const SPANISH = /\b(de|la|el|los|las|para|por|con|una|del|que|y)\b/gi;
const rows = [];
let allOk = true;
for (const doc of DOCS) {
  const src = await pdfText(corpus + doc + ".pdf");
  const dst = await pdfText(out + doc + "-es.pdf");
  const numbers = [...new Set(src.text.match(/\d[\d.,:/%$-]*\d|\d/g) ?? [])];
  const kept = numbers.filter((n) => dst.text.includes(n)).length / Math.max(1, numbers.length);
  // English words of 5+ letters that survive, counted only in real sentences (two or more English
  // function words): the corpus pads pages with random word lists that have nothing to translate.
  const sentences = src.text.split(/(?<=[.!?:])\s+/).filter((s) => (s.match(/\b(the|and|with|of|to|for|is|are|on|by|your|our)\b/gi) ?? []).length >= 2);
  const words = [...new Set(sentences.join(" ").match(/\b[a-z]{5,}\b/g) ?? [])];
  const left = words.filter((w) => new RegExp(`\\b${w}\\b`).test(dst.text)).length / Math.max(1, words.length);
  const spanish = (dst.text.match(SPANISH) ?? []).length;
  rows.push({ doc, pages: `${src.pages}->${dst.pages}`, numbersKept: +kept.toFixed(2), englishLeft: +left.toFixed(2), spanishWords: spanish });
  if (src.pages !== dst.pages || kept < 0.95) allOk = false;
}
console.table(rows);
check("same page count, every number kept (>= 95%)", allOk);
if (!stub) check("output reads as Spanish, little English left", rows.every((r) => r.spanishWords > 3 && r.englishLeft < 0.35), rows.map((r) => `${r.doc} ${r.englishLeft}`).join(", "));
check("only text was sent: POSTs to /api/translate only, no PDF bytes", posts.every((p) => p === "/api/translate") && !pdfBytesSent, `${posts.length} requests`);
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "rows.json", JSON.stringify(rows, null, 1));
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
