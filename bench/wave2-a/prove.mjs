// Drives the real tool pages. Usage: node bench/wave2-a/prove.mjs <tool> [port]
// Needs playwright-core (npx cache) and system Chrome.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { readdirSync } from "node:fs";

const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => {
  try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; }
});
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");

const tool = process.argv[2];
const port = process.argv[3] ?? "43150";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/tools/`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

async function open(slug, file) {
  await page.goto(base + slug, { waitUntil: "networkidle" });
  await page.locator('input[type=file]').setInputFiles(fx + file);
}
async function download(label, name) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }),
    page.getByRole("button", { name: label }).first().click(),
  ]);
  await dl.saveAs(out + name);
  console.log("saved", name, readFileSync(out + name).length, "bytes");
}

if (tool === "extract-images") {
  await open("extract-images", "photos.pdf");
  await page.getByText(/pictures? selected/).waitFor({ timeout: 15000 });
  console.log(await page.getByText(/pictures? selected/).innerText());
  await page.screenshot({ path: out + "ei-grid.png" });
  await page.getByRole("button", { name: "64 px+" }).click();
  console.log(await page.getByText(/pictures? selected/).innerText());
  const t0 = Date.now();
  await page.getByRole("button", { name: "Extract images" }).click();
  await page.getByText(/files? (is|are) ready$/).first().waitFor();
  console.log("run ms", Date.now() - t0);
  await page.screenshot({ path: out + "ei-done.png" });
  await download(/Download all/, "ei.zip");
  // none case
  await open("extract-images", "noimages.pdf");
  await page.getByText(/no embedded pictures/).waitFor({ timeout: 10000 });
  const t1 = Date.now();
  await page.getByRole("button", { name: "Extract images" }).click();
  await page.locator("div[role=alert].text-destructive").waitFor();
  console.log("no-images alert after ms", Date.now() - t1, await page.locator("div[role=alert].text-destructive").innerText());
}

if (tool === "unlock") {
  await open("unlock-pdf", "owner-only.pdf");
  await page.getByRole("button", { name: "Remove restrictions" }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: out + "ul-owner.png" });
  await page.getByRole("button", { name: "Remove restrictions" }).click();
  await page.getByText("1 file is ready", { exact: true }).waitFor();
  await download(/Download PDF/, "owner-unlocked.pdf");
  await open("unlock-pdf", "user-locked.pdf");
  await page.locator("#pdf-password").waitFor();
  await page.locator("#pdf-password").fill("wrong");
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  await page.locator("div[role=alert].text-destructive").waitFor();
  console.log(await page.locator("div[role=alert].text-destructive").innerText());
  await page.locator("#pdf-password").fill("open-sesame");
  await page.getByRole("button", { name: "Show password" }).click();
  console.log("shown value type:", await page.locator("#pdf-password").getAttribute("type"));
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  await page.getByText("1 file is ready", { exact: true }).waitFor();
  await download(/Download PDF/, "user-unlocked.pdf");
}

if (tool === "protect") {
  await open("protect-pdf", "plain.pdf");
  await page.getByLabel("Password to open").fill("Tr0ub4dor&3xyz!");
  await page.getByLabel("Confirm password").fill("Tr0ub4dor&3xyz!");
  await page.getByLabel("Printing").uncheck();
  await page.getByLabel("Copying text and images").uncheck();
  await page.screenshot({ path: out + "pr-form.png" });
  await page.getByRole("button", { name: "Protect PDF" }).click();
  await page.getByText("1 file is ready", { exact: true }).waitFor();
  await download(/Download PDF/, "protected.pdf");
}

if (tool === "header-footer") {
  await open("header-footer", "plain.pdf");
  await page.waitForTimeout(1500);
  await page.getByLabel("Left").fill("{filename}");
  await page.getByLabel("Center").fill("Page {page} of {pages}");
  await page.getByLabel("Right").fill("Draft");
  await page.getByLabel("Font size").fill("14");
  await page.getByLabel("Bold").check();
  await page.getByLabel("Skip first page").check();
  await page.getByLabel("Pages").fill("1-2");
  await page.screenshot({ path: out + "hf-form.png", fullPage: true });
  await page.getByRole("button", { name: "Add headers" }).click();
  await page.getByText("1 file is ready", { exact: true }).waitFor();
  await download(/Download PDF/, "headed.pdf");
}

if (tool === "extract-text") {
  await open("extract-text", "scan.pdf");
  await page.screenshot({ path: out + "et-form.png" });
  await page.getByRole("button", { name: "Extract text" }).click();
  await page.getByText("Text is ready", { exact: true }).first().waitFor({ timeout: 120000 });
  console.log((await page.locator("p.whitespace-pre-wrap").innerText()).slice(0, 300));
  await page.screenshot({ path: out + "et-done.png" });
  await page.getByRole("button", { name: /Copy/ }).click();
  console.log("copied:", await page.evaluate(() => navigator.clipboard.readText().catch((e) => "ERR " + e)));
  await open("extract-text", "plain.pdf");
  await page.getByRole("button", { name: "Extract text" }).click();
  await page.getByText("Text is ready", { exact: true }).waitFor();
  console.log((await page.locator("p.whitespace-pre-wrap").innerText()).slice(0, 200));
}

if (tool === "extract-text-image") {
  await open("extract-text", "scan.png");
  await page.getByRole("button", { name: "Extract text" }).click();
  await page.getByText("Text is ready", { exact: true }).waitFor({ timeout: 120000 });
  console.log((await page.locator("p.whitespace-pre-wrap").innerText()).slice(0, 200));
}

await browser.close();
