// Head-to-head: runs each synthetic fixture through iLovePDF's PDF to PDF/A as a signed-out visitor.
// Usage: node internal/benchmarks/pdfa/rival-ilovepdf.mjs [fixture.pdf]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/ilovepdf/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const only = process.argv[2];
const files = readdirSync(fx).filter((f) => f.endsWith(".pdf") && (!only || f === only)).sort();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
const lines = [];
for (const f of files) {
  const page = await context.newPage();
  await page.goto("https://www.ilovepdf.com/convert-pdf-to-pdfa", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // Decline optional cookies when the banner shows.
  await page.getByRole("button", { name: /reject|decline|only necessary/i }).first().click({ timeout: 3000 }).catch(() => {});
  await page.locator("input[type=file]").first().setInputFiles(fx + f);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out + f.replace(".pdf", "-1-loaded.png") });
  const level = process.env.LEVEL ?? "PDF/A-2b";
  await page.getByText(level, { exact: true }).first().click().catch(() => {});
  const start = Date.now();
  await page.locator("#processTask, button:has-text('Convert to PDF/A')").first().click();
  const dl = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: out + f.replace(".pdf", "-2-after.png") });
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log(f, "|", page.url(), "|", text.slice(0, 700));
  const file = await Promise.race([dl, new Promise((r) => setTimeout(() => r(null), 1000))]);
  if (file) { await file.saveAs(out + f.replace(".pdf", `-${level.slice(6)}.pdf`)); console.log("downloaded in", Date.now() - start, "ms"); }
  lines.push(`${f}\t${text.slice(0, 400)}`);
  await page.close();
}
writeFileSync(out + "probe.log", lines.join("\n"));
await browser.close();
