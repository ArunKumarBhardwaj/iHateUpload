// Opens a rival tool page, uploads a file, waits, dumps visible controls and a screenshot.
// Usage: node internal/benchmarks/page-tools/rival.mjs <slug> <input.pdf> <shot.png>
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const root = join(homedir(), ".npm/_npx");
const dir = readdirSync(root).find((d) => { try { readdirSync(join(root, d, "node_modules/playwright-core")); return true; } catch { return false; } });
const { chromium } = createRequire(join(root, dir, "node_modules/x.js"))("playwright-core");
const [slug, input, shot] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
await page.goto(`https://www.ihatepdf.cv/${slug}`);
await page.waitForTimeout(3500);
await page.setInputFiles("input[type=file]", resolve(input));
await page.waitForTimeout(5000);
console.log(await page.evaluate(() => [...document.querySelectorAll("button,input,select,label")].filter((e) => e.offsetParent).map((e) => `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || e.placeholder || e.type || "").trim().slice(0, 40)}`).join(" | ")));
await page.screenshot({ path: shot });
await browser.close();
