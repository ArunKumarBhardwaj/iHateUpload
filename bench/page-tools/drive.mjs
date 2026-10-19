// Drives a tool page in system Chrome, saves the download. Port 43152.
// Usage: node bench/page-tools/drive.mjs <slug> <input.pdf> <out.pdf> [script.mjs]
// script.mjs default-exports async (page) => {} run after the file is loaded and before the action button.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = join(homedir(), ".npm/_npx");
const dir = readdirSync(root).find((d) => {
  try {
    readdirSync(join(root, d, "node_modules/playwright-core"));
    return true;
  } catch {
    return false;
  }
});
const require = createRequire(join(root, dir, "node_modules/x.js"));
const { chromium } = require("playwright-core");

const [slug, input, out, script, shot] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.goto(`http://localhost:43152/tools/${slug}`);
await page.setInputFiles('input[type=file]', resolve(input));
await page.waitForTimeout(1500);
if (script) await (await import(resolve(script))).default(page);
if (shot) await page.screenshot({ path: shot, fullPage: true });
const btn = page.locator("button.h-12.flex-1");
const t0 = Date.now();
await btn.click();
const done = page.locator("button.h-12", { hasText: /Download/ });
await done.waitFor({ timeout: 120000 });
console.log("processed in", Date.now() - t0, "ms");
const [d] = await Promise.all([page.waitForEvent("download"), done.click()]);
await d.saveAs(resolve(out));
console.log("done in", Date.now() - t0, "ms");
await browser.close();
