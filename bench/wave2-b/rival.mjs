// Head-to-head helper: node bench/wave2-b/rival.mjs <slug> <fixture> [outName] [--dump]
// Uploads the fixture to https://www.ihatepdf.cv/<slug>, lists visible buttons, clicks the main action, saves any download.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const [, , slug, file, outName, pre] = process.argv; // pre = optional button to click first, e.g. Vector
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
await page.goto("https://www.ihatepdf.cv/" + slug, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("input[type=file]").first().setInputFiles(fx + file);
await page.waitForTimeout(3500);
await page.screenshot({ path: out + `rival-${slug}-1.png` });
const btns = await page.getByRole("button").allInnerTexts();
console.log("BUTTONS:", btns.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | "));
console.log("TEXT:", (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 1500));
if (pre) { await page.getByRole("button", { name: pre, exact: true }).first().click(); await page.waitForTimeout(1500); }
const exp = page.getByRole("button", { name: /Export PDF|Download|Convert|Create/ }).first();
const t0 = Date.now();
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }).catch(() => null), exp.click()]);
if (dl) { await dl.saveAs(out + outName); console.log("DOWNLOADED", outName, statSync(out + outName).size, "bytes in", Date.now() - t0, "ms"); } else console.log("NO DOWNLOAD");
await page.screenshot({ path: out + `rival-${slug}-2.png` });
await browser.close();
