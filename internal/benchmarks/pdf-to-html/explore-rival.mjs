// Prints the controls on ihatepdf.cv/pdf-to-html after a file is added (used once to learn their flow).
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
await page.goto("https://www.ihatepdf.cv/pdf-to-html", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.locator("input[type=file]").first().setInputFiles(process.argv[2]);
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => document.querySelector("main")?.innerText.slice(0, 1500)));
console.log(await page.evaluate(() => [...document.querySelectorAll("main button,main input,main label")].map((e) => e.tagName + ":" + (e.innerText || e.getAttribute("aria-label") || e.type || "").slice(0, 50)).join(" | ")));
await page.screenshot({ path: process.argv[3] ?? "/tmp/rival.png" });
await browser.close();
