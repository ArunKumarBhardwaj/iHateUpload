// Drives our PDF to Word tool and ihatepdf.cv with Playwright, one fixture at a time, sides alternating.
// Usage: node bench/pdf-to-word/run.mjs [--runs 5] [--long-runs 3] [--only a,b] [--sides ours,rival,rival-exact] [--ours URL]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

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
const JSZip = req("jszip");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OURS = arg("ours", "http://localhost:43127/tools/pdf-to-word");
const RUNS = Number(arg("runs", 5));
const LONG_RUNS = Number(arg("long-runs", 3));
const only = arg("only", "")?.split(",").filter(Boolean);
const sides = arg("sides", "ours,rival,rival-exact").split(",");
const fixDir = join(HERE, "fixtures");
const names = readdirSync(fixDir).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).filter((n) => !only.length || only.includes(n)).sort();

const SIDE = {
  ours: { url: OURS, mode: /^Editable text/, ihp: false },
  rival: { url: "https://ihatepdf.cv/pdf-to-word", mode: /^Editable/, ihp: true },
  "rival-exact": { url: "https://ihatepdf.cv/pdf-to-word", mode: /^Exact layout/, ihp: true },
};

const browser = await chromium.launch({ executablePath: CHROME });
const ctxs = {};
for (const s of sides) ctxs[s] = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });

async function convertOnce(side, file) {
  const cfg = SIDE[side];
  const page = await ctxs[side].newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(cfg.url, { waitUntil: "networkidle" });
    const timeout = file.includes("long") ? 600000 : 120000;
    const t0 = performance.now();
    await page.locator("input[type=file]").first().setInputFiles(file);
    await page.getByRole("button", { name: cfg.mode }).first().click();
    if (cfg.ihp) {
      // Turn every option on (they are on by default; this makes it explicit).
      for (const box of await page.locator("input[type=checkbox]").all()) if (!(await box.isChecked())) await box.check();
    }
    const convert = page.getByRole("button", { name: /Convert to Word/ });
    await convert.waitFor({ state: "visible", timeout });
    const dl = page.waitForEvent("download", { timeout }).catch(() => null);
    await convert.click();
    const dlBtn = page.getByRole("button", { name: /^\s*Download/i }).or(page.getByRole("link", { name: /^\s*Download/i })).first();
    const ready = await Promise.race([
      dl.then((d) => (d ? { d } : new Promise(() => {}))),
      dlBtn.waitFor({ state: "visible", timeout }).then(() => ({ btn: true })),
    ]);
    const tReady = performance.now();
    let download = ready.d;
    if (!download) {
      const again = page.waitForEvent("download", { timeout: 30000 });
      await dlBtn.click();
      download = await again;
    }
    const tmp = await download.path();
    const bytes = readFileSync(tmp);
    return { ms: tReady - t0, bytes, errors };
  } catch (e) {
    await page.screenshot({ path: join(HERE, "results", `${side}-${file.split("/").pop()}-fail.png`) }).catch(() => {});
    return { ms: null, bytes: null, errors: [...errors, String(e).slice(0, 300)] };
  } finally {
    await page.close();
  }
}

async function docHash(bytes) {
  const z = await JSZip.loadAsync(bytes);
  const x = await z.file("word/document.xml").async("string");
  return createHash("sha1").update(x).digest("hex").slice(0, 12);
}

for (const side of sides) mkdirSync(join(HERE, "results", side), { recursive: true });
for (const name of names) {
  const file = join(fixDir, name + ".pdf");
  const isLong = name === "long";
  const rec = Object.fromEntries(sides.map((s) => [s, { times: [], hashes: [], errors: [], failures: 0 }]));
  // rival-exact is for scoring only: one run.
  const runs = isLong ? LONG_RUNS : RUNS;
  for (let i = 0; i < runs; i++) {
    for (const side of sides) {
      if (side === "rival-exact" && i > 0) continue;
      const r = await convertOnce(side, file);
      const sr = rec[side];
      if (r.bytes) {
        if (i === 0) writeFileSync(join(HERE, "results", side, name + ".docx"), r.bytes);
        sr.times.push(Math.round(r.ms));
        sr.hashes.push(await docHash(r.bytes));
      } else sr.failures++;
      sr.errors.push(...r.errors);
      console.log(name, side, `run ${i + 1}`, r.ms == null ? "FAILED " + r.errors.slice(-1) : Math.round(r.ms) + " ms");
      if (SIDE[side].ihp) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  for (const side of sides) writeFileSync(join(HERE, "results", side, name + ".json"), JSON.stringify(rec[side], null, 1));
}
await browser.close();
