// Dump the options a rival tool page offers. Usage: node explore.mjs <slug>...
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
for (const slug of process.argv.slice(2)) {
  await page.goto("https://www.ihatepdf.cv/" + slug, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  console.log("=====", slug, page.url());
  console.log((await page.locator("main").innerText().catch(() => "")).slice(0, 3000));
  await page.screenshot({ path: new URL(`./out/rival-${slug}.png`, import.meta.url).pathname, fullPage: true });
}
await browser.close();
