// Runs a PDF through our own Compress PDF page (dev server) in Chrome at each level and saves the downloads.
// Usage: node internal/benchmarks/compress-bilevel/run-ours-browser.mjs <in.pdf> <outDir> [Light,Medium,Smallest,"200 KB"] [baseUrl]
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const req = createRequire(import.meta.url);
function findPlaywright() {
  try {
    return req.resolve("playwright-core");
  } catch {}
  const npx = join(homedir(), ".npm/_npx");
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const p = join(npx, d, "node_modules/playwright-core/index.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright-core not found");
}
const { chromium } = await import(findPlaywright());
const [input, outDir, levelArg, base] = process.argv.slice(2);
const levels = (levelArg ?? "Light,Medium,Smallest").split(",");
const url = (base ?? "http://localhost:43140") + "/tools/compress-pdf";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
for (const level of levels) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(input);
  await page.getByText(new RegExp("^" + level)).first().click();
  const t0 = performance.now();
  await page.getByRole("button", { name: /^Compress PDF$/ }).click();
  const dl = page.getByRole("button", { name: /Download PDF/ }).first();
  await dl.waitFor({ state: "visible", timeout: 300000 });
  const ms = performance.now() - t0;
  const pending = page.waitForEvent("download", { timeout: 60000 });
  await dl.click();
  const download = await pending;
  const dest = join(outDir, `browser-${level.replace(/\W+/g, "").toLowerCase()}.pdf`);
  copyFileSync(await download.path(), dest);
  console.log(level.padEnd(10), String(statSync(dest).size).padStart(9), "bytes", Math.round(ms), "ms", errors.length ? "ERRORS " + errors.join("|") : "");
  await ctx.close();
}
await browser.close();
