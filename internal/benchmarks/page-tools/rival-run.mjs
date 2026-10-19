// Drives a rival tool: upload, run click sequence (names of buttons, in order), capture the download.
// Usage: node internal/benchmarks/page-tools/rival-run.mjs <slug> <in.pdf> <out.pdf> "<btn1>|<btn2>|..."  (a button text containing "!" prefix = regex-free substring; last click should trigger the download)
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const root = join(homedir(), ".npm/_npx");
const dir = readdirSync(root).find((d) => { try { readdirSync(join(root, d, "node_modules/playwright-core")); return true; } catch { return false; } });
const { chromium } = createRequire(join(root, dir, "node_modules/x.js"))("playwright-core");
const [slug, input, out, seq] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
await page.goto(`https://www.ihatepdf.cv/${slug}`);
await page.waitForTimeout(3500);
await page.setInputFiles("input[type=file]", resolve(input));
await page.waitForTimeout(5000);
const steps = seq.split("|");
let t0 = Date.now();
for (let i = 0; i < steps.length; i++) {
  const last = i === steps.length - 1;
  const click = (last ? page.locator("button", { hasText: steps[i] }).last() : page.locator("button", { hasText: steps[i] }).first()).click();
  if (last) {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click]);
    await d.saveAs(resolve(out));
    console.log("download in", Date.now() - t0, "ms");
  } else { await click; await page.waitForTimeout(1500); }
}
await browser.close();
