// Drives /tools/scan-to-pdf on the dev server with synthetic photos.
// env: PORT, FX (dir with page-1.jpg page-2.jpg from make-fixture.ts), OUT, PLAYWRIGHT_CORE
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const port = process.env.PORT ?? "43154";
const fx = process.env.FX;
const out = process.env.OUT;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`http://localhost:${port}/tools/scan-to-pdf`);
await page.waitForTimeout(2500);
await page.setInputFiles('input[type="file"]', [`${fx}/page-1.jpg`, `${fx}/page-2.jpg`]);
await page.waitForSelector('[data-testid="scan-crop"]');
await page.waitForTimeout(2500);

async function corners() {
  return page.$$eval('[data-testid^="scan-handle-"]', (hs) => {
    const frame = document.querySelector('[data-testid="scan-crop"]').getBoundingClientRect();
    return hs.map((h) => {
      const r = h.getBoundingClientRect();
      return [Math.round(r.left + r.width / 2 - frame.left), Math.round(r.top + r.height / 2 - frame.top), Math.round(frame.width), Math.round(frame.height)];
    });
  });
}
console.log("auto corners page 1 (px in displayed frame, frame w,h last):", JSON.stringify(await corners()));
await page.screenshot({ path: `${out}/1-detected.png` });

// Drag one corner a little, check it moved.
const before = await corners();
const h0 = await page.$('[data-testid="scan-handle-0"]');
const box = await h0.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 12, { steps: 4 });
await page.mouse.up();
const after = await corners();
console.log("handle 0 moved:", before[0].slice(0, 2), "->", after[0].slice(0, 2));
// put it back with the auto button
await page.getByRole("button", { name: /Find edges/ }).click();
await page.waitForTimeout(1500);

async function run(label, { filter, searchable, size }) {
  if (filter) await page.getByRole("button", { name: filter, exact: true }).click();
  if (size) await page.getByRole("button", { name: size, exact: true }).click();
  const box = page.getByLabel("Searchable PDF");
  if ((await box.isChecked()) !== !!searchable) await box.setChecked(!!searchable);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${label}-ui.png` });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Make PDF" }).click();
  const dl = page.waitForEvent("download", { timeout: 180000 });
  await page.getByRole("button", { name: /Download PDF/ }).click({ timeout: 180000 });
  const d = await dl;
  const path = `${out}/${label}.pdf`;
  await d.saveAs(path);
  console.log(label, "ms", Date.now() - t0, path);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.setInputFiles('input[type="file"]', [`${fx}/page-1.jpg`, `${fx}/page-2.jpg`]);
  await page.waitForSelector('[data-testid="scan-crop"]');
  await page.waitForTimeout(2500);
}

await run("document", { filter: "Document", searchable: false, size: "A4" });
await run("bw", { filter: "B&W", searchable: false, size: "A4" });
await run("bw-searchable", { filter: "B&W", searchable: true, size: "Letter" });
await browser.close();
