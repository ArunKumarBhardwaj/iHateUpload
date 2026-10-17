// Probe the rival page: node bench/pdf-to-excel/probe.mjs file.pdf
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

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
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })).newPage();
await page.goto(process.argv[3] ?? "https://www.ihatepdf.cv/pdf-to-excel", { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 3500));
await page.locator("input[type=file]").first().setInputFiles(process.argv[2]);
await new Promise((r) => setTimeout(r, 2500));
console.log(await page.locator("body").innerText());
console.log(await page.locator("button, a[download], input").evaluateAll((els) => els.map((e) => `${e.tagName} ${e.type ?? ""} "${(e.innerText || e.value || e.getAttribute("aria-label") || "").slice(0, 50)}"`)));
await page.screenshot({ path: "/private/tmp/claude-501/-Users-arunbhardwaj-Desktop-Projects-iHateUpload/a6dbdd72-a603-407d-a43e-108a8307617f/scratchpad/rival.png" });
await browser.close();
