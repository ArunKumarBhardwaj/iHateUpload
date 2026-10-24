// Head-to-head: runs synthetic corpus PDFs through iLovePDF's Translate PDF into Spanish, signed out.
// Stops at any paywall instead of working around it. Usage: node internal/benchmarks/translate/rival-ilovepdf.mjs [doc,doc]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const out = new URL("./out/ilovepdf/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const docs = (process.argv[2] ?? "invoice,letter,memo-pdflib,brochure,report-chart,contract").split(",");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
const log = [];
for (const doc of docs) {
  const page = await context.newPage();
  await page.goto("https://www.ilovepdf.com/translate-pdf", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /reject|decline|only necessary/i }).first().click({ timeout: 2000 }).catch(() => {});
  await page.locator("input[type=file]").first().setInputFiles(corpus + doc + ".pdf");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out + doc + "-1-options.png" });
  // "To:" is the second language list; "From:" stays English. Keep layout is their default.
  const to = page.locator("select").nth(1);
  const picked = await to.selectOption({ label: "Spanish" }).then(() => true, () => false);
  if (!picked) {
    console.log(doc, "could not pick Spanish:", await page.locator("select").evaluateAll((s) => s.map((x) => x.options.length)));
    break;
  }
  const start = Date.now();
  const download = page.waitForEvent("download", { timeout: 180000 }).catch(() => null);
  await page.locator("#processTask, button:has-text('Translate')").first().click();
  await page.waitForTimeout(6000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: out + doc + "-2-after.png" });
  if (/Upgrade to Premium|This is a Premium feature|Premium feature/i.test(body) && !/processed successfully|translated/i.test(body)) {
    log.push(`${doc}\tblocked`);
    console.log(doc, "blocked by the Premium wall");
    await page.close();
    break;
  }
  const file = await download;
  if (file) {
    await file.saveAs(out + doc + "-es.pdf");
    log.push(`${doc}\t${file.suggestedFilename()}\t${Date.now() - start} ms`);
    console.log(doc, file.suggestedFilename(), Date.now() - start, "ms");
  } else {
    log.push(`${doc}\tno file`);
    console.log(doc, "no file:", body.slice(0, 300));
  }
  await page.close();
}
writeFileSync(out + "run.log", log.join("\n") + "\n");
await browser.close();
