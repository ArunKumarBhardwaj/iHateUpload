// Runs a PDF through ihatepdf.cv/compress-pdf in Chrome (Playwright) at each level and saves the downloads.
// Usage: node bench/compress-bilevel/run-rival.mjs <in.pdf> <outDir> [Light,Medium,Heavy]
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
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
const [input, outDir, levelArg] = process.argv.slice(2);
const levels = (levelArg ?? "Light,Medium,Heavy").split(",");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
for (const level of levels) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto("https://www.ihatepdf.cv/compress-pdf", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000); // the page ignores clicks for a moment after load
  await page.locator("input[type=file]").first().setInputFiles(input);
  await page.getByRole("button", { name: new RegExp("^" + level) }).first().click();
  const t0 = performance.now();
  const pending = page.waitForEvent("download", { timeout: 300000 }); // the page downloads on its own when done
  await page.getByRole("button", { name: /Compress PDF Now/ }).click();
  const download = await pending;
  const ms = performance.now() - t0;
  const dest = join(outDir, `rival-${level.toLowerCase()}.pdf`);
  copyFileSync(await download.path(), dest);
  console.log(level, statSync(dest).size, "bytes", Math.round(ms), "ms (to ready)");
  await ctx.close();
}
await browser.close();
