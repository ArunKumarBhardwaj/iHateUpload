// Same synthetic file through ihatepdf.cv/auto-redact-pii. Prints the UI text at each step.
// Usage: node bench/redact/run-rival.mjs <fixtureDir> <outDir>
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [fx, out] = process.argv.slice(2);
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 300)));
page.on("response", (r) => { if (/pdf|worker|cdn/i.test(r.url())) console.log("RESP", r.status(), r.url().slice(0, 150)); });
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().slice(0, 150)));
await page.goto("https://www.ihatepdf.cv/auto-redact-pii", { waitUntil: "networkidle" });
await page.waitForTimeout(3500); // their pages ignore clicks right after load
await page.screenshot({ path: join(out, "rival-0-landing.png"), fullPage: true });
console.log("BUTTONS", await page.$$eval("button", (b) => b.map((x) => x.innerText.trim()).filter(Boolean)));
console.log("INPUTS", await page.$$eval("input", (b) => b.map((x) => x.type + ":" + (x.getAttribute("aria-label") || x.name || ""))));
await page.setInputFiles('input[type="file"]', join(fx, process.argv[4] ?? "kyc-synthetic.pdf"));
await page.waitForTimeout(10000);
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
page.on("requestfailed", (r) => console.log("REQFAIL", r.url()));
await page.screenshot({ path: join(out, "rival-1-loaded.png"), fullPage: true });
const direct = await page.evaluate(() => !!window.pdfjsLib);
console.log("pdfjsLib present after direct landing:", direct);
if (!direct) {
  // Their tool expects a global they only load on some routes. Give it the one it names.
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" });
  await page.evaluate(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; });
}
const t0 = Date.now();
await page.getByRole("button", { name: /INITIATE PRIVACY SCAN/ }).click();
await page.waitForTimeout(500);
await page.waitForFunction(() => !/SCANNING|ANALYZ/i.test(document.body.innerText) && /found|detected|risk|REDACT/i.test(document.body.innerText.split("INITIATE")[0] || document.body.innerText), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);
console.log("scanMs~", Date.now() - t0);
await page.screenshot({ path: join(out, "rival-2-scanned.png"), fullPage: true });
const txt = await page.innerText("main").catch(() => page.innerText("body"));
console.log("RESULT", txt.replace(/\n+/g, " | ").slice(0, 6000));
console.log("BUTTONS2", await page.$$eval("main button", (b) => b.map((x) => x.innerText.trim()).filter(Boolean)));
const t2 = Date.now();
const dl = page.waitForEvent("download", { timeout: 90000 });
await page.getByRole("button", { name: /EXPORT REDACTED PDF/ }).click();
const d = await dl;
await d.saveAs(join(out, "rival-redacted.pdf"));
console.log("exportMs", Date.now() - t2, d.suggestedFilename());
await browser.close();
