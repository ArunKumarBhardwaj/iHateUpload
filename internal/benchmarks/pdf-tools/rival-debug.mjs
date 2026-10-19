// Quick look at what the rival shows after Split. Usage: node internal/benchmarks/pdf-tools/rival-debug.mjs <slug> <fixture> <outPng>
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
const req = createRequire(import.meta.url);
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
const [slug, fixture, png, click, fill] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1500 } });
const page = await ctx.newPage();
page.on("download", (d) => console.log("DOWNLOAD", d.suggestedFilename()));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`https://www.ihatepdf.cv/${slug}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("input[type=file]").first().setInputFiles(fixture);
await page.waitForTimeout(3000);
if (fill) await page.locator(fill.split("=")[0]).fill(fill.split("=")[1]);
await page.getByRole("button", { name: click, exact: true }).click();
await page.waitForTimeout(8000);
console.log((await page.evaluate(() => document.body.innerText)).split("Choose how to split").pop().slice(0, 1500));
await page.screenshot({ path: png, fullPage: true });
await browser.close();
