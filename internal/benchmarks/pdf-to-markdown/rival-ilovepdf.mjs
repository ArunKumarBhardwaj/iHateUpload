// Head-to-head: runs corpus PDFs (synthetic) through iLovePDF's PDF to Markdown as a signed-out visitor.
// Stops at any paywall or limit instead of working around it. Usage: node internal/benchmarks/pdf-to-markdown/rival-ilovepdf.mjs [doc,doc]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const out = new URL("./out/ilovepdf/", import.meta.url).pathname;
const shots = new URL("./out/ilovepdf-shots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
mkdirSync(shots, { recursive: true });
const only = process.argv[2]?.split(",");
const docs = readdirSync(corpus).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).filter((d) => !only || only.includes(d));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
const log = [];
for (const doc of docs) {
  const page = await context.newPage();
  await page.goto("https://www.ilovepdf.com/pdf-to-markdown", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /reject|decline|only necessary/i }).first().click({ timeout: 2000 }).catch(() => {});
  await page.locator("input[type=file]").first().setInputFiles(corpus + doc + ".pdf");
  await page.waitForTimeout(3000);
  const start = Date.now();
  const download = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  await page.locator("#processTask, button:has-text('Convert')").first().click();
  await page.waitForTimeout(6000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: shots + doc + ".png" });
  if (/Premium|Upgrade|limit|sign up to continue/i.test(body) && !/processed successfully/i.test(body)) {
    log.push(`${doc}\tblocked\t${body.slice(0, 200)}`);
    console.log(doc, "blocked:", body.match(/[^.]*(Premium|Upgrade|limit)[^.]*/i)?.[0]);
    await page.close();
    break;
  }
  const file = await download;
  const ms = Date.now() - start;
  if (!file) {
    log.push(`${doc}\tno file\t${body.slice(0, 200)}`);
    console.log(doc, "no file", body.slice(0, 200));
  } else {
    const name = file.suggestedFilename();
    const tmp = out + doc + "-" + name;
    await file.saveAs(tmp);
    if (name.endsWith(".zip")) {
      const unz = out + doc + "-zip/";
      execFileSync("unzip", ["-o", "-q", tmp, "-d", unz]);
      const md = readdirSync(unz, { recursive: true }).find((f) => String(f).endsWith(".md"));
      if (md) writeFileSync(out + doc + ".md", readFileSync(unz + md));
    } else if (name.endsWith(".md")) {
      writeFileSync(out + doc + ".md", readFileSync(tmp));
    }
    log.push(`${doc}\t${name}\t${ms} ms`);
    console.log(doc, name, ms, "ms");
  }
  await page.close();
}
writeFileSync(out + "run.log", log.join("\n") + "\n");
await browser.close();
