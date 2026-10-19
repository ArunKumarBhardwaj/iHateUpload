// Mirrors page 1 of the synthetic PDF through Rotate PDF and saves the result.
// Usage: node internal/benchmarks/redact/run-flip.mjs <fixtureDir> <outDir> [baseUrl]
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [fx, out, base = "http://localhost:43142"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const npx = join(homedir(), ".npm/_npx");
let pw;
for (const d of readdirSync(npx)) {
  const p = join(npx, d, "node_modules/playwright-core/index.mjs");
  if (existsSync(p)) pw = p;
}
const { chromium } = await import(pw);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })).newPage();
await page.goto(`${base}/tools/rotate-pdf`);
await page.setInputFiles('input[type="file"]', join(fx, "kyc-plain.pdf"));
await page.getByRole("button", { name: "No turn" }).click();
await page.getByRole("button", { name: "Left-right" }).click();
await page.getByLabel("Pages").fill("1");
await page.screenshot({ path: join(out, "flip-options.png") });
await page.getByRole("button", { name: /^Rotate PDF/ }).first().click();
const btn = page.getByRole("button", { name: /^Download PDF/ }).first();
await btn.waitFor({ timeout: 60000 });
const dl = page.waitForEvent("download");
await btn.click();
const d = await dl;
await d.saveAs(join(out, "flipped.pdf"));
console.log("saved", d.suggestedFilename());
await browser.close();
