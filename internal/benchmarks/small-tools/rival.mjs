// Head-to-head on ihatepdf.cv with the synthetic fixtures. Usage: node rival.mjs
// Records every option visible after files are added, then runs and saves the download.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1600 }, acceptDownloads: true })).newPage();
const posts = [];
page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });

for (const [slug, files] of [
  ["alternate-mix-pdf", ["fronts.pdf", "backs.pdf"]],
  ["pdf-to-zip", ["fronts.pdf", "backs.pdf", "short.pdf"]],
]) {
  await page.goto("https://www.ihatepdf.cv/" + slug, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.locator("input[type=file]").first().setInputFiles(files.map((f) => fx + f));
  await page.waitForTimeout(2500);
  console.log("=====", slug);
  console.log((await page.locator("main").innerText()).replace(/\n+/g, " | "));
  const controls = await page.locator("main input, main select, main button, main textarea").evaluateAll((els) =>
    els.map((e) => `${e.tagName}${e.type ? ":" + e.type : ""} ${(e.getAttribute("aria-label") || e.innerText || e.placeholder || e.value || "").slice(0, 50).replace(/\s+/g, " ")}`));
  console.log(controls.join("\n"));
  await page.screenshot({ path: out + `rival-${slug}-loaded.png`, fullPage: true });
}
console.log("POSTs:", posts);
await browser.close();
