// Same files through ihatepdf.cv/alternate-mix-pdf; extracts text per output page. Usage: node rival-mix.mjs
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { pageTexts } from "./pagetext.mjs";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/rival-mix/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1500 } })).newPage();

async function run(label, files, reverseB) {
  await page.goto("https://www.ihatepdf.cv/alternate-mix-pdf", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.locator("input[type=file]").first().setInputFiles(files.map((f) => fx + f));
  await page.waitForTimeout(2500);
  if (reverseB) await page.getByRole("button", { name: /Reverse page order for backs/ }).click();
  const order = (await page.getByText("Resulting order").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  const start = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.getByRole("button", { name: /Interleave/ }).click(),
  ]);
  const path = out + label + ".pdf";
  await download.saveAs(path);
  console.log(label, "|", (await pageTexts(path)).join(" "), `| ${Date.now() - start} ms | their preview: ${order}`);
}
await run("duplex", ["fronts.pdf", "backs.pdf"], true);
await run("unequal", ["fronts.pdf", "short.pdf"], false);
await run("three", ["fronts.pdf", "backs.pdf", "short.pdf"], false);
await browser.close();
