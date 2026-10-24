// Head-to-head: runs a bundle from gen.mjs through iLovePDF's Split PDF in its "Smart" range mode, signed
// out, and records the ranges it proposes and whether it splits. Stops at any paywall, never works around it.
// Usage: node internal/benchmarks/smart-split/rival-ilovepdf.mjs [bundle]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/ilovepdf/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const bundle = process.argv[2] ?? "office-mix-scan";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
await page.goto("https://www.ilovepdf.com/split_pdf", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /reject|decline|only necessary/i }).first().click({ timeout: 2000 }).catch(() => {});
await page.locator("input[type=file]").first().setInputFiles(fx + bundle + ".pdf");
await page.waitForTimeout(5000);
await page.getByText("Smart", { exact: false }).first().click();
// Their Smart mode asks for a category and a preset. "Scanned document batches" fits a mixed stack.
await page.waitForTimeout(2000);
const selects = page.locator("select");
await selects.nth(0).selectOption({ label: process.argv[3] ?? "Scanned document batches" });
await page.waitForTimeout(1500);
const presets = await selects.nth(1).evaluate((s) => [...s.options].map((o) => o.text));
console.log("presets:", presets.join(" | "));
await selects.nth(1).selectOption({ index: 1 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}${bundle}-0-options.png`, fullPage: true });
const start = Date.now();
const download = page.waitForEvent("download", { timeout: 240000 }).catch(() => null);
await page.locator("#processTask, button:has-text('Split PDF')").last().click();
await page.waitForTimeout(15000);
await page.screenshot({ path: `${out}${bundle}-1-smart.png`, fullPage: true });
const body = await page.locator("body").innerText();
writeFileSync(`${out}${bundle}-smart.txt`, body);
const ranges = await page.locator("input[type=number]").evaluateAll((els) => els.map((e) => e.value));
console.log(bundle, Date.now() - start, "ms; number inputs:", ranges.join(","));
if (!/Premium|Upgrade/i.test(body) || /download/i.test(body)) {
  const file = await download;
  if (file) {
    await file.saveAs(`${out}${bundle}-${file.suggestedFilename()}`);
    console.log("downloaded", file.suggestedFilename());
  }
}
console.log(body.replace(/\s+/g, " ").slice(0, 1500));
await browser.close();
