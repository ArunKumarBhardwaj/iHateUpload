// Same synthetic invoice.pdf through https://ihatepdf.cv/edit-pdf-text. Prints measured facts; saves outputs to out/rival-*.pdf.
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib.mjs";
import { pdfText } from "./text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = (n) => join(HERE, "out", n);
const browser = await launch();

async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1300 }, acceptDownloads: true })).newPage();
  await page.goto("https://ihatepdf.cv/edit-pdf-text");
  await page.waitForTimeout(3500);
  await page.setInputFiles("input[type=file]", join(HERE, "fx/invoice.pdf"));
  await page.waitForTimeout(6000);
  return page;
}
async function download(page, name) {
  const t0 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Download/ }).first().click()]);
  await dl.saveAs(out(name));
  return { ms: Date.now() - t0, bytes: statSync(out(name)).size };
}

// A: click the line and retype it
{
  const page = await open();
  await page.mouse.click(600, 331);
  await page.waitForTimeout(800);
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Bill to: Globex Industries");
  await page.mouse.click(900, 700);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out("rival-A-editing.png") });
  const r = await download(page, "rival-A.pdf");
  console.log("A click-edit", r, await pdfText(out("rival-A.pdf")));
  await page.context().close();
}
// B: find & replace on page 1
{
  const page = await open();
  await page.mouse.click(1189, 113);
  await page.getByPlaceholder("Find on this page").fill("Acme Corp");
  await page.getByPlaceholder("Replace with").fill("Globex");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out("rival-B-find.png") });
  console.log("B find panel text:", (await page.locator("text=/match|found|result/i").allInnerTexts()).slice(0, 5));
  await page.getByRole("button", { name: "Replace all" }).click();
  await page.waitForTimeout(1000);
  const r = await download(page, "rival-B.pdf");
  console.log("B find-replace (page 1 only)", r, await pdfText(out("rival-B.pdf")));
  await page.context().close();
}
await browser.close();
