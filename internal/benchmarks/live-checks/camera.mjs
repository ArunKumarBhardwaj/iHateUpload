// Scan to PDF through a real camera stream: Chrome's fake camera plays fx/camera.y4m (a synthetic tilted page).
// Usage: node internal/benchmarks/live-checks/camera.mjs [origin]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const origin = process.argv[2] ?? "https://www.ihateupload.com";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${fx}camera.y4m`],
});
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 }, permissions: ["camera"] });
const page = await context.newPage();
const errors = [];
const posts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

await page.goto(`${origin}/tools/scan-to-pdf`, { waitUntil: "networkidle" });
const capture = page.getByRole("button", { name: "Capture page" });
await capture.waitFor();
const live = await page.waitForFunction(() => {
  const v = document.querySelector("video");
  return v && v.videoWidth > 0;
}, null, { timeout: 20000 }).then(() => true, () => false);
const size = await page.evaluate(() => { const v = document.querySelector("video"); return v ? `${v.videoWidth}x${v.videoHeight}` : "none"; });
check("camera stream is live", live, size);
await page.screenshot({ path: out + "camera-live.png" });
await capture.click();
await page.getByRole("button", { name: "Make PDF" }).waitFor({ timeout: 20000 });
check("captured frame becomes a page", true);
// A second capture from the studio's own camera button, if it offers one; otherwise one page is enough.
const again = page.getByRole("button", { name: "Capture page" });
if (await again.isVisible().catch(() => false)) { await again.click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: out + "camera-studio.png", fullPage: true });
const start = Date.now();
await page.getByRole("button", { name: "Make PDF" }).click();
const button = page.getByRole("button", { name: "Download PDF" });
await button.waitFor({ timeout: 180000 });
const ms = Date.now() - start;
const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
await download.saveAs(out + "camera-scan.pdf");
check("PDF made from the camera capture", true, `${ms} ms`);
check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "camera.log", log.join("\n") + "\n");
await browser.close();
