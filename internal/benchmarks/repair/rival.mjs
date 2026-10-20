// Head-to-head: runs every damaged fixture through ihatepdf.cv/repair-pdf and saves what it returns.
// Usage: node internal/benchmarks/repair/rival.mjs [damage]   (fixtures from write.ts)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const only = process.argv[2];
const damages = readdirSync(fx).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).filter((d) => !only || d === only);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
const lines = [];
for (const d of damages) {
  await page.goto("https://www.ihatepdf.cv/repair-pdf", { waitUntil: "networkidle" });
  const start = Date.now();
  await page.locator("input[type=file]").first().setInputFiles(fx + d + ".pdf");
  await page.getByRole("button", { name: "Scan & Repair PDF" }).click();
  // The download button appears when their engine is done (or never, if it gives up).
  const download = page.getByText("Download Repaired PDF", { exact: true });
  const ready = await download.waitFor({ timeout: 30000 }).then(() => true, () => false);
  const ms = Date.now() - start;
  let got = false;
  if (ready) {
    const event = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await download.click();
    const file = await event;
    if (file) {
      await file.saveAs(out + "rival-" + d + ".pdf");
      got = true;
    } else {
      got = await page.waitForFunction(() => window._lastDownloadedFile?.bytes, null, { timeout: 8000 }).then(() => true, () => false);
      if (got) writeFileSync(out + "rival-" + d + ".pdf", Buffer.from(await page.evaluate(() => Array.from(window._lastDownloadedFile.bytes))));
    }
  }
  const text = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
  if (only) await page.screenshot({ path: out + `rival-${d}-done.png`, fullPage: true });
  const message = (text.match(/Repair Strategies (.*?) Repair Log/) ?? ["", ""])[1];
  lines.push(`${d}\t${got ? "file" : "no file"}\t${ms} ms\t${message}`);
  console.log(lines.at(-1));
}
writeFileSync(out + "rival.log", lines.join("\n") + "\n");
await browser.close();
