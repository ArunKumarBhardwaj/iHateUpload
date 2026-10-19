// Drives the real Edit PDF page on a dev server and checks the downloaded PDF.
// Usage: node bench/wave2-d/proof.mjs [baseUrl]   (needs `next dev` running)
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib.mjs";
import { pdfText } from "./text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:43153";
const out = (n) => join(HERE, "out", n);
const fx = (n) => join(HERE, "fx", n);
const checks = [];
const check = (name, ok, extra = "") => { checks.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const render = (pdf, png, scale = 0.8) => execFileSync("node", [resolve(HERE, "../page-tools/render.mjs"), pdf, png, String(scale)], { stdio: "inherit" });

const browser = await launch();

async function open(file) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1500 }, acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`${BASE}/tools/edit-pdf`);
  await page.setInputFiles("input[type=file]", fx(file));
  await page.locator('img[src^="blob:"]').last().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
}
/** Click the page image at a ratio of its size. */
async function clickAt(page, rx, ry) {
  const box = await page.locator('img[src^="blob:"]').last().boundingBox();
  await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
  await page.waitForTimeout(500);
}
async function save(page, name) {
  const t0 = Date.now();
  await page.getByRole("button", { name: "Save PDF" }).click();
  const dlButton = page.getByRole("button", { name: /^Download/ }).first();
  await dlButton.waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), dlButton.click()]);
  const path = out(name);
  await dl.saveAs(path);
  console.log(`  ${name}: ${Date.now() - t0} ms click-to-download, ${statSync(path).size} bytes`);
  return path;
}

// ---- 1. click a line, change it, font family / bold / italic / align / colour ----
{
  const page = await open("invoice.pdf");
  await clickAt(page, 0.15, 0.148); // "Bill to: Acme Corp" (page 1, y=670/792)
  const area = page.getByLabel("Text on the page");
  check("clicking a line opens it for editing", await area.count() === 1, `text=${JSON.stringify(await area.inputValue())}`);
  await area.fill("Bill to: Globex Industries");
  await page.getByLabel("Font", { exact: true }).selectOption({ label: "Times" });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await page.getByRole("button", { name: "Align center" }).click();
  await page.getByRole("button", { name: "#d61f3a" }).click();
  await page.screenshot({ path: out("1-editing.png") });
  const path = await save(page, "1-click-edit.pdf");
  const [p1, p2] = await pdfText(path);
  check("old line text gone from the PDF", !p1.includes("Acme Corp,") === true && !/Bill to: Acme/.test(p1), p1);
  check("new text present", p1.includes("Bill to: Globex Industries"));
  check("neighbour on same row intact", p1.includes("Amount due 1200 USD"));
  check("other lines intact", p1.includes("INVOICE 1042") && p1.includes("Payment is due in 30 days") && p2.includes("Footer line that must survive"));
  render(path, out("1-click-edit.png"));
  await page.context().close();
}

// ---- 2. find & replace: counts, match case, whole word, replace one, replace all, undo, redo ----
{
  const page = await open("invoice.pdf");
  await page.getByRole("button", { name: "Find and replace" }).click();
  const status = page.getByTestId("find-status");
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp");
  await page.getByLabel("Replace with").fill("Globex");
  await page.waitForFunction(() => /Match 1 of 4/.test(document.querySelector('[data-testid="find-status"]')?.textContent ?? ""), null, { timeout: 15000 });
  check("count: 4 matches on 2 pages", /Match 1 of 4, on 2 pages/.test(await status.innerText()), await status.innerText());
  await page.getByLabel("Match case").check();
  await page.getByLabel("Find", { exact: true }).fill("acme corp");
  await page.waitForTimeout(300);
  check("match case: lower-case phrase has no hit", /No matches/.test(await status.innerText()));
  await page.getByLabel("Match case").uncheck();
  await page.waitForTimeout(300);
  check("match case off: 4 again", /of 4/.test(await status.innerText()));
  await page.getByLabel("Find", { exact: true }).fill("Acm");
  await page.getByLabel("Whole word").check();
  await page.waitForTimeout(300);
  check("whole word: partial word has no hit", /No matches/.test(await status.innerText()));
  await page.getByLabel("Whole word").uncheck();
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Next match" }).click();
  check("next match moves", /Match 2 of 4/.test(await status.innerText()), await status.innerText());
  await page.getByRole("button", { name: "Replace", exact: true }).click(); // replace match 2 only
  await page.waitForTimeout(400);
  check("replace one reports 1", /Replaced 1 match/.test(await status.innerText()), await status.innerText());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp ");
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp");
  await page.waitForTimeout(300);
  check("undo restores all 4 matches", /of 4/.test(await status.innerText()), await status.innerText());
  await page.getByRole("button", { name: "Redo" }).click();
  await page.waitForTimeout(300);
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp ");
  await page.getByLabel("Find", { exact: true }).fill("Acme Corp");
  await page.waitForTimeout(300);
  check("redo brings the replacement back (3 left)", /of 3/.test(await status.innerText()), await status.innerText());
  await page.getByRole("button", { name: "Replace all" }).click();
  await page.waitForTimeout(400);
  check("replace all reports 3", /Replaced 3 matches/.test(await status.innerText()), await status.innerText());
  // add a new text box on page 1 empty area
  await page.locator("button[data-slot=button]").filter({ hasText: /^Text$/ }).click();
  await clickAt(page, 0.3, 0.55);
  const boxes = page.getByLabel("Text on the page");
  await boxes.last().fill("Added note: PAID");
  await page.screenshot({ path: out("2-find-replace.png") });
  const path = await save(page, "2-find-replace.pdf");
  const [p1, p2] = await pdfText(path);
  check("no 'Acme' left anywhere", !/Acme/i.test(p1 + p2), `${p1} // ${p2}`);
  check("Globex on both pages", p1.includes("Globex") && p2.includes("Globex"));
  check("page 2 neighbour intact", p2.includes("Footer line that must survive") && p2.includes("Terms"));
  check("page 1 neighbours intact", p1.includes("Amount due 1200 USD") && p1.includes("INVOICE 1042") && p1.includes("sales@example.test"));
  check("new text box present", p1.includes("Added note: PAID"));
  render(path, out("2-find-replace.png"));
  await page.context().close();
}

// ---- 3. embedded (Type0) font file ----
{
  const page = await open("invoice-type0.pdf");
  await clickAt(page, 0.15, 0.148);
  await page.getByLabel("Text on the page").fill("Bill to: Initech");
  const path = await save(page, "3-type0.pdf");
  const [p1] = await pdfText(path);
  check("Type0 font: old text gone, neighbours kept", !p1.includes("Acme") && p1.includes("Initech") && p1.includes("Amount due 1200 USD") && p1.includes("Keep this line as it is"), p1);
  render(path, out("3-type0.png"));
  await page.context().close();
}

// ---- 4. undo / redo (buttons and Ctrl/Cmd+Z) ----
{
  const page = await open("invoice.pdf");
  const pressed = (n) => page.getByRole("button", { name: n, exact: true }).getAttribute("aria-pressed");
  await clickAt(page, 0.15, 0.148);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  check("bold is on", (await pressed("Bold")) === "true");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  await clickAt(page, 0.15, 0.148);
  check("undo turned bold off", (await pressed("Bold")) !== "true");
  await page.getByRole("button", { name: "Redo" }).click();
  await page.waitForTimeout(300);
  await clickAt(page, 0.15, 0.148);
  check("redo turned bold back on", (await pressed("Bold")) === "true");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("two undos leave nothing to save", await page.getByRole("button", { name: "Save PDF" }).isDisabled());
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(300);
  check("shortcut redo brings the edit back", await page.getByRole("button", { name: "Save PDF" }).isEnabled());
  await page.context().close();
}

// ---- 5. scanned page still goes through OCR ----
{
  const page = await open("scan.pdf");
  await page.waitForFunction(() => /OCR/.test(document.body.innerText), null, { timeout: 90000 });
  await clickAt(page, 0.3, 0.19); // "Invoice for Acme Corp" (y=300/1584)
  const area = page.getByLabel("Text on the page");
  const read = await area.inputValue().catch(() => "");
  check("OCR reads a line on a scanned page", /Acme/.test(read), JSON.stringify(read));
  await area.fill("Invoice for Globex");
  const path = await save(page, "5-scan.pdf");
  render(path, out("5-scan.png"));
  await page.context().close();
}

await browser.close();
console.log(checks.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(checks.every(Boolean) ? 0 : 1);
