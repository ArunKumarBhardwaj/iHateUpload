// Screenshots outputs in Chrome's built-in PDF viewer (PDFium). Usage: node internal/benchmarks/fill-form/render-chrome.mjs
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";

const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const out = new URL("./out/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=-2400,0"] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
for (const name of ["filled-editable", "filled-flat"]) {
  await page.goto("file://" + out + name + ".pdf");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + name + ".chrome.png" });
}
await browser.close();
