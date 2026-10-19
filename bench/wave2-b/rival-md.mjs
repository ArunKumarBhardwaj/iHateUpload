// Rival Markdown preview with the same synthetic input: node bench/wave2-b/rival-md.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const out = new URL("./out/", import.meta.url).pathname;
const md = readFileSync(new URL("./fx/math.md", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1400 } })).newPage();
await page.goto("https://www.ihatepdf.cv/markdown-to-pdf", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("textarea").first().fill(md);
await page.getByRole("button", { name: "Preview", exact: true }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: out + "rival-markdown-preview.png", fullPage: false });
const t0 = Date.now();
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }).catch(() => null), page.getByRole("button", { name: /Save as PDF/ }).click()]);
console.log(dl ? "DOWNLOAD fired in " + (Date.now() - t0) + " ms" : "no download event");
if (dl) { await dl.saveAs(out + "rival-md.pdf"); }
await browser.close();
