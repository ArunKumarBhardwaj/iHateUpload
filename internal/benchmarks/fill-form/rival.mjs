// Head-to-head: fills the synthetic form on ihatepdf.cv/fill-pdf-form with the same values as prove.mjs.
// Usage: node internal/benchmarks/fill-form/rival.mjs   (then bun verify.ts on out/rival-*.pdf)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=-2400,0", "--disable-blink-features=AutomationControlled"] });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
// Their save does not fire a browser download event, so keep every PDF blob the page makes.
await page.addInitScript(() => {
  window.__pdfs = [];
  // Their save goes through the File System Access picker; record what it writes.
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: async () => ({
      kind: "file",
      name: "out.pdf",
      createWritable: async () => ({
        write: async (data) => { window.__pdfs.push(data instanceof Blob ? data : new Blob([data?.data ?? data])); },
        close: async () => {},
        abort: async () => {},
      }),
      getFile: async () => window.__pdfs.at(-1),
    }),
  });
  window.__saves = [];
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__saves.push(`a.click ${this.download} ${this.href.slice(0, 60)}`);
    return click.call(this);
  };
  const open = window.open;
  window.open = (...args) => { window.__saves.push(`open ${String(args[0]).slice(0, 60)}`); return open(...args); };
  const make = URL.createObjectURL;
  URL.createObjectURL = (obj) => {
    if (obj instanceof Blob) window.__pdfs.push(obj);
    return make(obj);
  };
});
const cdp = await browser.newBrowserCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: out + "dl", eventsEnabled: true });
const cdpEvents = [];
cdp.on("Browser.downloadWillBegin", (e) => cdpEvents.push(`begin ${e.suggestedFilename} ${e.url.slice(0, 50)}`));
cdp.on("Browser.downloadProgress", (e) => { if (e.state !== "inProgress") cdpEvents.push(`${e.state} ${e.guid}`); });
const log = [];
const note = (s) => { log.push(s); console.log(s); };

async function run(lock, file) {
  await page.goto("https://www.ihatepdf.cv/fill-pdf-form", { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(fx + "form.pdf");
  const texts = page.locator('input[type=text]:visible');
  await texts.first().waitFor({ timeout: 20000 });
  // Required check: try to save with the required name empty.
  if (lock) {
    await page.getByRole("button", { name: /Fill & download/ }).click();
    const saved = await page.getByText("All done").waitFor({ timeout: 8000 }).then(() => true, () => false);
    note(`required name empty -> saved anyway: ${saved}`);
    await page.goto("https://www.ihatepdf.cv/fill-pdf-form", { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(fx + "form.pdf");
    await texts.first().waitFor({ timeout: 20000 });
  }
  note(`text inputs: ${await texts.count()}, textareas: ${await page.locator("textarea:visible").count()}, date inputs: ${await page.locator("input[type=date]:visible").count()}`);
  await texts.nth(0).fill("Ada Example");
  await texts.nth(1).fill("12 Test Lane\nSampletown");
  note(`address after newline fill: ${JSON.stringify(await texts.nth(1).inputValue())}`);
  await texts.nth(2).pressSequentially("482199");
  note(`pin after typing 482199: ${await texts.nth(2).inputValue()}`);
  await texts.nth(3).fill("11/05/2026");
  note(`read-only Case ID editable: ${await texts.nth(4).isEditable()}`);
  await page.locator("input[type=checkbox]:visible").first().check();
  const selects = page.locator("select:visible");
  await selects.nth(0).selectOption("plus");
  await selects.nth(1).selectOption("Kenya");
  note(`topics multiple: ${await selects.nth(2).evaluate((s) => s.multiple)}`);
  await selects.nth(2).selectOption("Privacy");
  await texts.nth(5).fill("Second page note");
  const lockBox = page.locator("input[type=checkbox]:visible").last();
  if (lock) await lockBox.check(); else await lockBox.uncheck();
  const started = Date.now();
  await page.getByRole("button", { name: /Fill & download/ }).click();
  // Their tool keeps the result here before handing it to the site's save helper.
  await page.waitForFunction(() => window._lastDownloadedFile?.bytes, null, { timeout: 20000 });
  const ms = Date.now() - started;
  const bytes = await page.evaluate(() => Array.from(window._lastDownloadedFile.bytes));
  writeFileSync(out + file, Buffer.from(bytes));
  note(`${lock ? "locked" : "editable"}: ${bytes.length} bytes in ${ms} ms`);
}
// Non-Latin letters: same synthetic name in Polish/Greek/Russian letters.
await page.goto("https://www.ihatepdf.cv/fill-pdf-form", { waitUntil: "networkidle" });
await page.locator("input[type=file]").first().setInputFiles(fx + "form.pdf");
await page.locator("input[type=text]:visible").first().waitFor({ timeout: 20000 });
await page.locator("input[type=text]:visible").first().fill("Łukasz Ωmega Дмитрий");
await page.getByRole("button", { name: /Fill & download/ }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: out + "rival-unicode.png" });
const unicodeSaved = await page.evaluate(() => !!window._lastDownloadedFile?.bytes);
const toast = await page.getByText(/Could not save|error/i).first().textContent().catch(() => "");
note(`unicode name -> saved: ${unicodeSaved}; message: ${toast}`);
if (unicodeSaved) writeFileSync(out + "rival-unicode.pdf", Buffer.from(await page.evaluate(() => Array.from(window._lastDownloadedFile.bytes))));
await run(false, "rival-editable.pdf");
await run(true, "rival-flat.pdf");
writeFileSync(out + "rival.log", log.join("\n") + "\n");
await browser.close();
