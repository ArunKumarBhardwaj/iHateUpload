// Head-to-head: ours vs ihatepdf.cv on split-by-bookmarks / split-by-text / Bates / metadata, same synthetic files.
// Usage: node bench/pdf-tools/h2h.mjs <fixtureDir> <outDir> [--ours http://localhost:43141] [--only split-bookmarks,...]
// Outputs land in <outDir>/<task>/<side>/ plus timings.json; verify.ts reads them.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

const req = createRequire(import.meta.url);
function findPlaywright() {
  try { return req.resolve("playwright-core"); } catch {}
  const npx = join(homedir(), ".npm/_npx");
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const p = join(npx, d, "node_modules/playwright-core/index.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright-core not found");
}
const { chromium } = await import(findPlaywright());
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const [fixDir, outDir] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.startsWith("http"));
const OURS = arg("ours", "http://localhost:43141");
const RIVAL = "https://www.ihatepdf.cv";
const only = (arg("only", "") || "").split(",").filter(Boolean);
const fx = (n) => join(fixDir, n);

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const timings = {};

async function open(side, url) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1500 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (side === "rival") await page.waitForTimeout(3500); // their pages ignore clicks right after load
  return { ctx, page };
}

async function save(dl, dir) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, dl.suggestedFilename());
  await dl.saveAs(target);
  return dl.suggestedFilename();
}

// Click `trigger`, wait for a download control to appear (processing time), then download it.
async function run(page, trigger, dlName, dir) {
  const t0 = performance.now();
  await trigger.click();
  const control = page.getByRole("button", { name: dlName }).or(page.getByRole("link", { name: dlName })).first();
  await control.waitFor({ timeout: 60000 });
  const ms = Math.round(performance.now() - t0);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), control.click()]);
  await save(dl, dir);
  return ms;
}

async function task(name, side, fn) {
  if (only.length && !only.includes(name)) return;
  const dir = join(outDir, name, side);
  mkdirSync(dir, { recursive: true });
  try {
    const t = await fn(dir);
    timings[`${name}/${side}`] = t;
    console.log(name, side, JSON.stringify(t));
  } catch (e) {
    timings[`${name}/${side}`] = { error: String(e).slice(0, 300) };
    console.log(name, side, "ERROR", String(e).slice(0, 300));
  }
}

// ---- split by bookmarks -----------------------------------------------------
for (const [name, fixture] of [["split-bookmarks", "bookmarks.pdf"], ["split-bookmarks-big", "big.pdf"]]) {
await task(name, "ours", async (dir) => {
  const { ctx, page } = await open("ours", `${OURS}/tools/split-pdf`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.getByRole("button", { name: "By bookmarks" }).click();
  await page.getByTestId("split-parts").waitFor();
  await page.screenshot({ path: join(outDir, `ours-${name}.png`), fullPage: true });
  const preview = await page.getByTestId("split-parts").innerText();
  const ms = await run(page, page.getByRole("button", { name: /^Split PDF$/ }), /^Download (all|PDF)/, dir);
  await page.screenshot({ path: join(outDir, `ours-${name}-done.png`), fullPage: true });
  await ctx.close();
  return { ms: Math.round(ms), preview };
});
await task(name, "rival", async (dir) => {
  const { ctx, page } = await open("rival", `${RIVAL}/split-pdf-by-bookmarks`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.getByText("Will produce").waitFor();
  const ms = await run(page, page.getByRole("button", { name: "Split PDF", exact: true }), /Download all/, dir);
  await ctx.close();
  return { ms: Math.round(ms) };
});

// ---- split by text ----------------------------------------------------------
}
for (const [name, fixture] of [["split-text", "bookmarks.pdf"], ["split-text-big", "big.pdf"]]) {
await task(name, "ours", async (dir) => {
  const { ctx, page } = await open("ours", `${OURS}/tools/split-pdf`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.getByRole("button", { name: "By text" }).click();
  await page.locator("#split-phrase").fill("chapter");
  await page.getByTestId("split-parts").waitFor();
  await page.screenshot({ path: join(outDir, `ours-${name}.png`), fullPage: true });
  const preview = await page.getByTestId("split-parts").innerText();
  const ms = await run(page, page.getByRole("button", { name: /^Split PDF$/ }), /^Download (all|PDF)/, dir);
  await ctx.close();
  return { ms: Math.round(ms), preview };
});
await task(name, "rival", async (dir) => {
  const { ctx, page } = await open("rival", `${RIVAL}/split-pdf-by-text`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.locator("#split-text").fill("chapter");
  const ms = await run(page, page.getByRole("button", { name: "Split PDF", exact: true }), /Download all/, dir);
  await ctx.close();
  return { ms: Math.round(ms) };
});
}

// ---- Bates ------------------------------------------------------------------
await task("bates", "ours", async (dir) => {
  const { ctx, page } = await open("ours", `${OURS}/tools/bates-numbering`);
  await page.locator("input[type=file]").first().setInputFiles([fx("bates1.pdf"), fx("bates2.pdf")]);
  await page.locator("#bates-prefix").waitFor();
  await page.locator("#bates-prefix").fill("ABC");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "ours-bates.png"), fullPage: true });
  const ms = await run(page, page.getByRole("button", { name: /Apply Bates numbers/ }), /^Download (all|PDF)/, dir);
  await ctx.close();
  return { ms: Math.round(ms) };
});
await task("bates", "rival", async (dir) => {
  const { ctx, page } = await open("rival", `${RIVAL}/bates-numbering`);
  await page.locator("input[type=file]").first().setInputFiles([fx("bates1.pdf"), fx("bates2.pdf")]);
  await page.locator("#bates-prefix").waitFor();
  const t0 = performance.now();
  await page.getByRole("button", { name: /Apply Bates numbers/ }).click();
  const buttons = page.getByRole("button", { name: /Download (stamped PDF|production log)/ });
  await buttons.first().waitFor({ timeout: 60000 });
  const ms = Math.round(performance.now() - t0);
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), buttons.nth(i).click()]);
    await save(dl, dir);
  }
  await page.screenshot({ path: join(outDir, "rival-bates-done.png"), fullPage: true });
  await ctx.close();
  return { ms, downloads: n };
});

// ---- Bates on one long file ------------------------------------------------
await task("bates-big", "ours", async (dir) => {
  const { ctx, page } = await open("ours", `${OURS}/tools/bates-numbering`);
  await page.locator("input[type=file]").first().setInputFiles(fx("big.pdf"));
  await page.locator("#bates-prefix").waitFor();
  await page.waitForTimeout(800);
  const ms = await run(page, page.getByRole("button", { name: /Apply Bates numbers/ }), /^Download (all|PDF)/, dir);
  await ctx.close();
  return { ms };
});
await task("bates-big", "rival", async (dir) => {
  const { ctx, page } = await open("rival", `${RIVAL}/bates-numbering`);
  await page.locator("input[type=file]").first().setInputFiles(fx("big.pdf"));
  await page.locator("#bates-prefix").waitFor();
  const ms = await run(page, page.getByRole("button", { name: /Apply Bates numbers/ }), /Download stamped PDF/, dir);
  await ctx.close();
  return { ms };
});

// ---- metadata ---------------------------------------------------------------
for (const [name, fixture] of [["metadata", "meta.pdf"], ["metadata-xmp", "meta-xmp.pdf"]]) {
await task(name, "ours", async (dir) => {
  const { ctx, page } = await open("ours", `${OURS}/tools/edit-metadata`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.locator("#meta-title").waitFor();
  await page.waitForTimeout(500);
  await page.locator("#meta-title").fill("Edited Title");
  await page.getByRole("button", { name: "Clear Author" }).click();
  await page.screenshot({ path: join(outDir, `ours-${name}.png`), fullPage: true });
  const ms = await run(page, page.getByRole("button", { name: /Save metadata/ }), /^Download (all|PDF)/, dir);
  await ctx.close();
  return { ms: Math.round(ms) };
});
await task(name, "rival", async (dir) => {
  const { ctx, page } = await open("rival", `${RIVAL}/edit-pdf-metadata`);
  await page.locator("input[type=file]").first().setInputFiles(fx(fixture));
  await page.locator("#meta-title").waitFor();
  await page.waitForTimeout(500);
  await page.locator("#meta-title").fill("Edited Title");
  await page.locator("#meta-author").fill("");
  const t0 = performance.now();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Save & download PDF/ }).click()]);
  const ms = performance.now() - t0;
  await save(dl, dir);
  await ctx.close();
  return { ms: Math.round(ms) };
});
}

writeFileSync(join(outDir, "timings.json"), JSON.stringify(timings, null, 2));
await browser.close();
