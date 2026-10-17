// Convert the synthetic corpus on ours and the rival in a real browser; writes ./results/<side>/<doc>.xlsx and timings.
// Usage: node bench/pdf-to-excel/run.mjs [--only a,b] [--sides ours,rival] [--ours URL] [--corpus DIR]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };

function findPlaywright() {
  try { return req.resolve("playwright-core"); } catch {}
  const npx = join(homedir(), ".npm/_npx");
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const p = join(npx, d, "node_modules/playwright-core/index.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright-core not found (try: npx playwright --version once)");
}
const { chromium } = await import(findPlaywright());

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OURS = arg("ours", "http://localhost:43143/tools/pdf-to-excel");
const only = arg("only", "").split(",").filter(Boolean);
const sides = arg("sides", "ours,rival").split(",");
const corpus = arg("corpus", join(HERE, "../pdf-to-word/realistic/corpus"));
const names = readdirSync(corpus).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).filter((n) => !only.length || only.includes(n)).sort();
const SIDE = { ours: { url: OURS }, rival: { url: "https://www.ihatepdf.cv/pdf-to-excel" } };
const browser = await chromium.launch({ executablePath: CHROME });
const ctxs = {};
for (const s of sides) ctxs[s] = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function convertOnce(side, file) {
  const page = await ctxs[side].newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(SIDE[side].url, { waitUntil: "networkidle" });
    // The rival's page ignores clicks for a couple of seconds after load.
    if (side === "rival") await sleep(3500);
    const t0 = performance.now();
    await page.locator("input[type=file]").first().setInputFiles(file);
    const download = page.waitForEvent("download", { timeout: 120000 }); download.catch(() => {});
    if (side === "ours") {
      await page.getByRole("button", { name: /Convert to Excel/ }).click();
      const dl = page.getByRole("button", { name: /^\s*Download/i }).or(page.getByRole("link", { name: /^\s*Download/i })).first();
      await dl.waitFor({ state: "visible", timeout: 120000 });
      await dl.click();
      const d = await download;
      return { ms: performance.now() - t0, bytes: readFileSync(await d.path()), errors };
    }
    const exportBtn = page.getByRole("button", { name: /^Export \d+ tables? as Excel/ });
    await exportBtn.waitFor({ state: "visible", timeout: 30000 });
    await exportBtn.click();
    const d = await download;
    return { ms: performance.now() - t0, bytes: readFileSync(await d.path()), errors };
  } catch (e) {
    mkdirSync(join(HERE, "results"), { recursive: true });
    await page.screenshot({ path: join(HERE, "results", `${side}-${file.split("/").pop()}-fail.png`) }).catch(() => {});
    return { ms: null, bytes: null, errors: [...errors, String(e).slice(0, 300)] };
  } finally {
    await page.close();
  }
}

const timings = {};
for (const side of sides) mkdirSync(join(HERE, "results", side), { recursive: true });
for (const name of names) {
  for (const side of sides) {
    const runs = [];
    let bytes = null;
    for (let i = 0; i < Number(arg("runs", 3)); i++) {
      const r = await convertOnce(side, join(corpus, name + ".pdf"));
      if (r.bytes) { runs.push(r.ms); bytes ??= r.bytes; }
      else console.log(name, side, "FAILED", r.errors.slice(-1)[0]);
      if (side === "rival") await sleep(1500);
    }
    if (bytes) writeFileSync(join(HERE, "results", side, name + ".xlsx"), bytes);
    runs.sort((a, b) => a - b);
    timings[`${side}/${name}`] = runs.length ? Math.round(runs[Math.floor(runs.length / 2)]) : null;
    console.log(name, side, runs.map(Math.round).join(" "), "ms");
  }
}
const prior = existsSync(join(HERE, "results/timings.json")) ? JSON.parse(readFileSync(join(HERE, "results/timings.json"), "utf8")) : {};
writeFileSync(join(HERE, "results/timings.json"), JSON.stringify({ ...prior, ...timings }, null, 1));
await browser.close();
