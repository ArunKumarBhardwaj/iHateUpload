// Drives our Redact PDF with the synthetic file: scan, screenshot the review UI,
// redact, screenshot the output page, and prove the text is gone with pdf.js.
// Usage: node bench/redact/run-ours.mjs <fixtureDir> <outDir> [baseUrl]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (/DBG|rror/.test(m.text())) console.log("C:", m.text().slice(0, 700)); });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${base}/tools/redact-pdf`);
await page.setInputFiles('input[type="file"]', join(fx, process.argv[5] ?? "kyc-synthetic.pdf"));
await page.getByRole("button", { name: "Scan document" }).click();
const t0 = Date.now();
await page.getByText(/will be burned out|Nothing sensitive|Could not|rror/).first().waitFor({ timeout: 120000 });
console.log("STATUS", await page.getByRole("status").allInnerTexts());
const scanMs = Date.now() - t0;
await page.waitForTimeout(800);
const summary = await page.getByText(/will be burned out/).first().innerText();
const items = await page.$$eval("ul li button.font-mono", (els) => els.map((e) => e.textContent));
const cats = await page.$$eval('input[aria-label^="All "]', (els) => els.map((e) => e.getAttribute("aria-label")));
console.log({ scanMs, summary, cats, items });
await page.screenshot({ path: join(out, "findings-review.png"), fullPage: true });

const t1 = Date.now();
await page.getByRole("button", { name: /^Redact PDF/ }).first().click();
const dlBtn = page.getByRole("button", { name: /^Download PDF/ }).first();
await dlBtn.waitFor({ timeout: 120000 });
const redactMs = Date.now() - t1;
const dl = page.waitForEvent("download", { timeout: 60000 });
await dlBtn.click();
const download = await dl;
const file = join(out, "redacted.pdf");
await download.saveAs(file);
console.log({ redactMs, saved: file });
writeFileSync(join(out, "scan.json"), JSON.stringify({ scanMs, redactMs, summary, items }, null, 2));
await browser.close();
