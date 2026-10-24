// Head-to-head: runs one synthetic corpus PDF through iLovePDF's AI Summarizer, signed out, and saves
// the summary text it shows. Stops at any paywall instead of working around it.
// Usage: node internal/benchmarks/summarize/rival-ilovepdf.mjs [doc]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const out = new URL("./out/ilovepdf/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const doc = process.argv[2] ?? "invoice";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
await page.goto("https://www.ilovepdf.com/pdf-summarize", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /reject|decline|only necessary/i }).first().click({ timeout: 2000 }).catch(() => {});
await page.locator("input[type=file]").first().setInputFiles(corpus + doc + ".pdf");
await page.waitForTimeout(3500);
await page.screenshot({ path: out + doc + "-1-options.png" });
const options = (await page.locator("body").innerText()).replace(/\s+/g, " ");
writeFileSync(out + doc + "-options.txt", options);
const start = Date.now();
// Their settings dialog: Medium length and Standard AI (Advanced AI is marked Premium), then Continue.
await page.getByRole("button", { name: /Continue/ }).first().click();
await page.waitForTimeout(2000);
await page.locator("#processTask, button:has-text('Summarize')").first().click({ timeout: 8000 }).catch(() => {});
let body = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  body = await page.locator("body").innerText();
  if (/Premium/i.test(body) && /upgrade/i.test(body) && !/summary/i.test(body)) break;
  if (/summary/i.test(body) && Date.now() - start > 8000) break;
}
const ms = Date.now() - start;
await page.screenshot({ path: out + doc + "-2-after.png", fullPage: true });
writeFileSync(out + doc + "-result.txt", body);
console.log(doc, ms, "ms");
console.log(body.slice(0, 4000));
await browser.close();
