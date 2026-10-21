// Proof run for the Workflow Builder against a production build.
// Usage: node internal/benchmarks/workflows/prove.mjs [--base http://localhost:43161] [--corpus DIR] [--out DIR] [--shots]
// Needs: bun internal/benchmarks/workflows/gen.ts DIR  (synthetic corpus), a running `next start`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const req = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:43161");
const CORPUS = arg("corpus", "corpus");
const OUT = arg("out", "results");
const SHOTS = process.argv.includes("--shots");
mkdirSync(OUT, { recursive: true });

function findPlaywright() {
  try { return req.resolve("playwright-core"); } catch {}
  const npx = join(homedir(), ".npm/_npx");
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const p = join(npx, d, "node_modules/playwright-core/index.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright-core not found");
}
const { chromium } = await import(findPlaywright());
const JSZip = req(join(process.cwd(), "node_modules/jszip"));

const pdfs = readdirSync(join(CORPUS, "pdf")).filter((f) => f.endsWith(".pdf")).sort().map((f) => join(CORPUS, "pdf", f));
const imgs = readdirSync(join(CORPUS, "img")).filter((f) => f.endsWith(".jpg")).sort().map((f) => join(CORPUS, "img", f));

const browser = await chromium.launch({ channel: "chrome" });

async function scenario(name, { preset, files, password }) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 1000 } });
  const page = await ctx.newPage();
  const posts = [];
  page.on("request", (r) => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method())) posts.push(r.method() + " " + r.url()); });
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  await page.goto(BASE + "/tools/workflow", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(preset) }).click();
  if (password) {
    const protect = page.getByTestId("wf-step").filter({ hasText: "Protect PDF" });
    await protect.getByRole("button", { name: /Settings/ }).click();
    await page.locator("#protect-password, input[type=password]").first().fill(password);
    await page.locator("input[type=password]").nth(1).fill(password);
  }
  await page.locator("input[type=file]").setInputFiles(files);
  if (SHOTS) await page.screenshot({ path: join(OUT, `${name}-ready.png`), fullPage: true });
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Run on/ }).click();
  await page.getByTestId("wf-results").waitFor({ timeout: 600000 });
  const ms = Date.now() - t0;
  const summary = await page.getByTestId("wf-results").getByRole("status").innerText();
  if (SHOTS) await page.screenshot({ path: join(OUT, `${name}-done.png`), fullPage: true });
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Download/ }).first().click(),
  ]);
  const saved = join(OUT, `${name}-${dl.suggestedFilename()}`);
  await dl.saveAs(saved);
  const bufs = {};
  let names;
  if (saved.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(readFileSync(saved));
    names = Object.keys(zip.files);
    for (const n of names) bufs[n] = await zip.files[n].async("uint8array");
  } else {
    names = [dl.suggestedFilename()];
    bufs[names[0]] = new Uint8Array(readFileSync(saved));
  }
  console.log(`[${name}] ${ms} ms | ${summary.replace(/\n/g, " ")} | zip entries: ${names.join(", ")} | non-GET requests: ${posts.length}`);
  await ctx.close();
  return { ms, names, bufs, posts };
}

const result = {};
result.mcp = await scenario("merge-compress-protect", { preset: "Merge, compress, protect", files: pdfs, password: "bench-pass-1" });
result.imgs = await scenario("images-pdf-compress", { preset: "Images to PDF, compressed", files: imgs });
await browser.close();

// Verify the outputs with pdf.js, outside the app.
const pdfjs = await import(join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
async function open(bytes, password) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 });
  try { return await task.promise; } catch (e) { return { error: e.name + ": " + e.message }; }
}
const report = {};
{
  const [name] = result.mcp.names;
  const bytes = result.mcp.bufs[name];
  const noPw = await open(bytes);
  const withPw = await open(bytes, "bench-pass-1");
  let text = "";
  if (!withPw.error) {
    for (const p of [1, 30, 60]) text += (await (await withPw.getPage(p)).getTextContent()).items.map((i) => i.str).join(" ") + " | ";
  }
  report.mergeCompressProtect = {
    file: name, bytes: bytes.length,
    withoutPassword: noPw.error ?? "OPENED (unexpected)",
    withPasswordPages: withPw.error ?? withPw.numPages,
    sampleText: text,
    hasEncryptDict: Buffer.from(bytes).includes("/Encrypt"),
    inputBytes: pdfs.reduce((s, f) => s + readFileSync(f).length, 0),
    seconds: result.mcp.ms / 1000, nonGetRequests: result.mcp.posts.length,
  };
}
{
  const [name] = result.imgs.names;
  const bytes = result.imgs.bufs[name];
  const doc = await open(bytes);
  report.imagesPdfCompress = {
    file: name, bytes: bytes.length, pages: doc.error ?? doc.numPages,
    inputBytes: imgs.reduce((s, f) => s + readFileSync(f).length, 0),
    seconds: result.imgs.ms / 1000, nonGetRequests: result.imgs.posts.length,
  };
}
writeFileSync(join(OUT, "ours.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
