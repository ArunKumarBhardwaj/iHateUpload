// Makes fx/mini-chrome.pdf: a three-element page printed by Chrome (Skia/PDF), to see whether ihatepdf.cv handles Chrome PDFs at all.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.setContent('<html><body style="font:16px Arial"><h1>Hello heading</h1><p>Plain paragraph text for a minimal check.</p><ul><li>one</li><li>two</li></ul></body></html>');
await page.pdf({ path: new URL("./fx/mini-chrome.pdf", import.meta.url).pathname, format: "Letter" });
await browser.close();
