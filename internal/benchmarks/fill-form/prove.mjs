// Drives the real Fill PDF form page on a production build. Usage: node internal/benchmarks/fill-form/prove.mjs [port]
// Needs playwright-core (npx cache) and system Chrome. Fixtures from gen.ts; outputs to ./out/.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");

const port = process.argv[2] ?? "43127";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const origin = port.startsWith("http") ? port : `http://localhost:${port}`;
const url = `${origin}/tools/fill-pdf-form`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests = [];
page.on("request", (r) => requests.push(r.method() + " " + r.url()));
const log = [];
const check = (name, ok, detail = "") => {
  log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  console.log(log.at(-1));
};

async function open(file) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', fx + file);
}

async function fillAll() {
  const f = (name) => page.locator(`[data-field="${name}"]`);
  await f("applicant.name").waitFor({ timeout: 20000 });
  const status = await page.getByTestId("fill-form-status").textContent();
  check("field count shown", /10 fields found/.test(status ?? ""), status ?? "");
  const save = page.getByRole("button", { name: "Save filled PDF" });
  check("save blocked while required name is empty", await save.isDisabled());
  check("required field flagged", (await f("applicant.name").getAttribute("aria-invalid")) === "true");
  check("read-only field locked", await f("case.id").isDisabled());
  await f("applicant.name").fill("Ada Example");
  await f("applicant.address").fill("12 Test Lane\nSampletown");
  await f("pin").pressSequentially("482199");
  check("max length stops typing at 4", (await f("pin").inputValue()) === "4821", await f("pin").inputValue());
  await f("start.date").fill("2026-11-05");
  await f("subscribe").check();
  await page.locator('[data-field="plan"][value="plus"]').check();
  await f("country").selectOption("Kenya");
  await f("topics").selectOption(["Privacy", "Support"]);
  await f("notes").fill("Second page note");
  check("save enabled once required is filled", await save.isEnabled());
  return save;
}

async function saveAs(mode, fileName) {
  if (mode === "flatten") await page.getByLabel(/Flatten/).check();
  const started = Date.now();
  await page.getByRole("button", { name: "Save filled PDF" }).click();
  const button = page.getByRole("button", { name: "Download PDF" });
  await button.waitFor({ timeout: 20000 });
  const ms = Date.now() - started;
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  await download.saveAs(out + fileName);
  check(`${mode} download saved`, true, `${download.suggestedFilename()} in ${ms} ms`);
  return ms;
}

// 1. Keep editable
await open("form.pdf");
await fillAll();
await page.screenshot({ path: out + "ui-filled.png", fullPage: true });
const msEditable = await saveAs("editable", "filled-editable.pdf");

// 2. Flatten
await open("form.pdf");
await fillAll();
const msFlat = await saveAs("flatten", "filled-flat.pdf");

// 3. Non-Latin letters need the embedded Unicode font.
await open("form.pdf");
await page.locator('[data-field="applicant.name"]').waitFor({ timeout: 20000 });
await page.locator('[data-field="applicant.name"]').fill("Łukasz Ωmega Дмитрий");
await page.getByLabel(/Flatten/).check();
await saveAs("unicode", "filled-unicode.pdf");

// 4. No fields
await open("plain.pdf");
const notice = page.getByText("This PDF has no fillable fields");
await notice.waitFor({ timeout: 15000 });
check("no-fields message", await notice.isVisible());
check("suggests Edit PDF", await page.getByRole("link", { name: /Edit PDF/ }).isVisible());
check("suggests Sign PDF", await page.getByRole("link", { name: /Sign PDF/ }).isVisible());
check("save disabled with no fields", await page.getByRole("button", { name: "Save filled PDF" }).isDisabled());
await page.screenshot({ path: out + "ui-no-fields.png" });

const uploads = requests.filter((r) => r.startsWith("POST") || r.startsWith("PUT"));
check("no POST/PUT requests", uploads.length === 0, uploads.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));

writeFileSync(out + "prove.log", log.join("\n") + `\nsave editable ${msEditable} ms, flatten ${msFlat} ms\n`);
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
