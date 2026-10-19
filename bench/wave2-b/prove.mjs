// Drives the real tool pages. Usage: node bench/wave2-b/prove.mjs <pptx|markdown|csv> [port]
// Needs playwright-core (npx cache) and system Chrome. Outputs to bench/wave2-b/out/.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");

const tool = process.argv[2];
const port = process.argv[3] ?? "43151";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/tools/`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 200)));

async function open(slug, file) {
  await page.goto(base + slug, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").setInputFiles(fx + file);
}
async function run(label, name) {
  const t0 = Date.now();
  await page.getByRole("button", { name: label }).first().click();
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }),
    page.getByRole("button", { name: /Download/ }).first().click(),
  ]);
  await dl.saveAs(out + name);
  console.log("saved", name, readFileSync(out + name).length, "bytes in", Date.now() - t0, "ms");
}

if (tool === "pptx") {
  await open("pptx-to-pdf", "deck.pptx");
  await page.screenshot({ path: out + "pptx-ui.png" });
  await run("Create PDF", "pptx-site.pdf");
}
if (tool === "markdown") {
  await open("markdown-to-pdf", "math.md");
  await page.screenshot({ path: out + "md-ui.png" });
  await run("Create PDF", "md-site.pdf");
  await open("markdown-to-pdf", "math.md");
  await page.getByRole("button", { name: "2.0", exact: true }).click();
  await page.getByRole("button", { name: "A3", exact: true }).click();
  await page.screenshot({ path: out + "md-options.png" });
  await run("Create PDF", "md-site-double.pdf");
}
if (tool === "csv") {
  await open("csv-to-pdf", "people.csv");
  await page.getByRole("table").waitFor();
  await page.screenshot({ path: out + "csv-ui.png" });
  await run("Create PDF", "csv-site-plain.pdf");
  // sort by amount (twice = descending), search "oslo", hide the note column
  await open("csv-to-pdf", "people.csv");
  await page.getByRole("table").waitFor();
  await page.locator("th button", { hasText: "amount" }).click();
  await page.locator("th button", { hasText: "amount" }).click();
  await page.getByLabel("Search rows").fill("oslo");
  await page.locator("[aria-label='Columns to print'] button", { hasText: "note" }).click();
  console.log("count:", await page.getByTestId("csv-count").innerText());
  console.log("first rows:", (await page.locator("tbody tr").allInnerTexts()).slice(0, 3).map((t) => t.replace(/\s+/g, " ")));
  await page.screenshot({ path: out + "csv-ui-sorted.png" });
  await run("Create PDF", "csv-site-view.pdf");
}
await browser.close();
