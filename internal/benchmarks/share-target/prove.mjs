// Proves the installed app's share target in real Chrome: the manifest parses with a share target and file
// handlers, a share (the multipart POST Android's share sheet makes) is answered by the service worker on the
// device, /share lists the files with matching tools, a tool opens with them loaded, the inbox empties after,
// and without a service worker the server turns the share away unread.
// Usage: node internal/benchmarks/share-target/prove.mjs [port | https://origin]
//   A port means a local `next start`, served as http://ihu.test:<port> (the app skips its service worker on localhost).
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = process.argv[2] ?? "43127";
const local = !arg.startsWith("http");
const origin = local ? `http://ihu.test:${arg}` : arg;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

// A normal (not incognito) profile, since an app cannot be installed from incognito.
const profile = mkdtempSync(join(tmpdir(), "ihu-share-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: true,
  viewport: { width: 420, height: 900 },
  args: local ? [`--host-resolver-rules=MAP ihu.test 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`] : [],
});
const browser = context;
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(origin + "/", { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: "networkidle" });
check("service worker controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller));

// What Chrome makes of the manifest.
const cdp = await context.newCDPSession(page);
const app = await cdp.send("Page.getAppManifest");
const installErrors = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors.map((e) => e.errorId);
const parsed = app.manifest ?? {};
const target = parsed.shareTarget ?? JSON.parse(app.data ?? "{}").share_target;
check("manifest parses with a share target and file handlers", app.errors.length === 0 && !!target && /share-target/.test(target.action ?? ""), `errors ${JSON.stringify(app.errors)}; action ${target?.action}`);
check("installable as an app", installErrors.length === 0, installErrors.join(", "));

// Share two PDFs the way the share sheet does: a multipart POST navigation to the share action.
async function share(files) {
  const payload = files.map((f) => ({ name: f.split("/").pop(), b64: readFileSync(f).toString("base64") }));
  const nav = page.waitForNavigation({ waitUntil: "networkidle" });
  await page.evaluate(({ payload, action }) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.enctype = "multipart/form-data";
    const input = document.createElement("input");
    input.type = "file";
    input.name = "files";
    input.multiple = true;
    const dt = new DataTransfer();
    for (const f of payload) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    input.files = dt.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  }, { payload, action: "/share-target" });
  return nav;
}
const sent = [];
page.on("request", (r) => { if (r.method() === "POST") sent.push(r); });
await share([corpus + "invoice.pdf", corpus + "letter.pdf"]);
const post = sent.find((r) => r.url().endsWith("/share-target"));
const answer = post ? await post.response() : null;
check("the share is answered by the service worker on the device", !!answer && answer.fromServiceWorker() && answer.status() === 303, `status ${answer?.status()}, from service worker ${answer?.fromServiceWorker()}`);
await page.getByTestId("share-inbox").getByRole("heading").waitFor();
const listed = await page.getByRole("list", { name: "Shared files" }).locator("li").allTextContents();
const tools = await page.getByTestId("share-inbox").getByRole("button").allTextContents();
await page.screenshot({ path: out + `share-${local ? "local" : "live"}.png`, fullPage: true });
check("/share lists both files and the tools that fit", listed.length === 2 && listed[0].includes("invoice.pdf") && tools.includes("Merge PDF"), `${listed.length} files; tools: ${tools.slice(0, 5).join(", ")}`);
const shareUrl = page.url();

await page.getByRole("button", { name: "Merge PDF" }).click();
await page.waitForURL(/\/tools\/merge-pdf/);
await page.getByText("letter.pdf").first().waitFor({ timeout: 15000 });
check("a tool opens with the shared files loaded", await page.getByText("invoice.pdf").first().isVisible());

await page.goto(shareUrl, { waitUntil: "networkidle" });
const again = await page.getByTestId("share-inbox").innerText();
check("the inbox is emptied once the files are taken", /already opened/.test(again));

// No service worker: the server answers with a redirect and keeps nothing.
await page.evaluate(async () => Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister())));
const fresh = await context.newPage();
await fresh.goto(origin + "/share", { waitUntil: "networkidle" });
const before = await fresh.evaluate(() => !!navigator.serviceWorker.controller);
const resp = await fresh.request.post((local ? `http://127.0.0.1:${arg}` : origin) + "/share-target", { multipart: { files: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") } }, maxRedirects: 0 });
check("without the service worker the server turns the share away", !before && resp.status() === 303 && resp.headers().location === "/share?offline=1", `status ${resp.status()} → ${resp.headers().location}`);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
