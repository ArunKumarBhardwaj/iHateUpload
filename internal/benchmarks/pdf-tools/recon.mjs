// Dumps the rival's controls before and after loading a synthetic file. Usage: node internal/benchmarks/pdf-tools/recon.mjs <fixtureDir> <outDir>
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
const [fixDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const PAGES = [
  ["split-pdf-by-bookmarks", "bookmarks.pdf"],
  ["split-pdf-by-text", "bookmarks.pdf"],
  ["bates-numbering", "bates1.pdf"],
  ["edit-pdf-metadata", "meta.pdf"],
];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const dump = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("input,select,textarea,button,label")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    out.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""} name=${el.name || ""} id=${el.id || ""} ph=${el.placeholder || ""} val=${(el.value || "").slice(0, 40)} :: ${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80)}`);
  }
  return out.join("\n") + "\n--- TEXT ---\n" + document.body.innerText.slice(0, 4000);
});
for (const [slug, fixture] of PAGES) {
  const page = await ctx.newPage();
  await page.goto(`https://www.ihatepdf.cv/${slug}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  writeFileSync(join(outDir, `${slug}.before.txt`), await dump(page));
  await page.screenshot({ path: join(outDir, `${slug}.before.png`), fullPage: true });
  await page.locator("input[type=file]").first().setInputFiles(join(fixDir, fixture));
  await page.waitForTimeout(4000);
  writeFileSync(join(outDir, `${slug}.after.txt`), await dump(page));
  await page.screenshot({ path: join(outDir, `${slug}.after.png`), fullPage: true });
  await page.close();
}
await browser.close();
