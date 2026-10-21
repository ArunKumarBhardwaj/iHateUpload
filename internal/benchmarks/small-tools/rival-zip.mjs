// Same three PDFs through ihatepdf.cv/pdf-to-zip; lists the archive and compares bytes. Usage: node rival-zip.mjs
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/rival-zip/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1600 } })).newPage();
await page.goto("https://www.ihatepdf.cv/pdf-to-zip", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.locator("input[type=file]").first().setInputFiles(["fronts", "backs", "short"].map((n) => fx + n + ".pdf"));
await page.waitForTimeout(2500);
const start = Date.now();
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 20000 }),
  page.getByRole("button", { name: /Create & Download ZIP/ }).click(),
]);
await download.saveAs(out + "their.zip");
console.log("name:", download.suggestedFilename(), `${Date.now() - start} ms`);
execFileSync("unzip", ["-o", "-q", out + "their.zip", "-d", out + "x"]);
console.log(execFileSync("find", [out + "x", "-type", "f"]).toString());
for (const n of ["fronts", "backs", "short"]) {
  try {
    console.log(n, "byte-identical:", readFileSync(out + "x/my-documents/" + n + ".pdf").equals(readFileSync(fx + n + ".pdf")));
  } catch { console.log(n, "not at my-documents/"); }
}
await browser.close();
