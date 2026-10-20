// Head-to-head: converts fx/deck.pdf and fx/report.pdf on ihatepdf.cv/pdf-to-pptx in each of their modes.
// Usage: node internal/benchmarks/pdf-to-pptx/rival.mjs   → out/rival-<file>-<mode>.pptx (check with check.ts rival)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
const lines = [];
const MODES = { editable: /Fully Editable|Full Reconstruction/, hybrid: /Smart Hybrid/ };
for (const file of ["deck", "report"]) {
  for (const [mode, label] of Object.entries(MODES)) {
    await page.goto("https://www.ihatepdf.cv/pdf-to-pptx", { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(fx + file + ".pdf");
    await page.getByText(label).first().click().catch((e) => console.log("mode click", e.message));
    const start = Date.now();
    await page.getByRole("button", { name: /Convert to PPTX/ }).click();
    const button = page.getByText("Download .pptx").first();
    const ready = await button.waitFor({ timeout: 120000 }).then(() => true, () => false);
    const ms = Date.now() - start;
    let saved = false;
    if (ready) {
      const event = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await button.click();
      const d = await event;
      if (d) { await d.saveAs(out + `rival-${file}-${mode}.pptx`); saved = true; }
      else if (await page.waitForFunction(() => window._lastDownloadedFile?.bytes, null, { timeout: 8000 }).then(() => true, () => false)) {
        writeFileSync(out + `rival-${file}-${mode}.pptx`, Buffer.from(await page.evaluate(() => Array.from(window._lastDownloadedFile.bytes))));
        saved = true;
      }
    }
    if (!saved) await page.screenshot({ path: out + `rival-${file}-${mode}-fail.png`, fullPage: true });
    lines.push(`${file}\t${mode}\t${saved ? "file" : "no file"}\t${ms} ms`);
    console.log(lines.at(-1));
  }
}
writeFileSync(out + "rival.log", lines.join("\n") + "\n");
await browser.close();
