// Screenshots HTML files in Chrome. Usage: node shot.mjs <out.png> <file.html> [width]
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: Number(process.argv[4] ?? 1000), height: 900 } })).newPage();
await page.goto("file://" + process.argv[3]);
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2], fullPage: true });
await browser.close();
