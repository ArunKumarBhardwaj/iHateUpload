import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { POST } from "@/app/share-target/route";
import { cachePolicy } from "@/lib/sw-cache";
import { TOOLS } from "@/lib/tools";

import { SHARE_ACTION, SHARE_FIELD, sharedFiles } from "./share-inbox";

const manifest = JSON.parse(readFileSync(`${process.cwd()}/public/manifest.webmanifest`, "utf8"));

test("the manifest shares files to the action the service worker answers", () => {
  const target = manifest.share_target;
  expect(target.action).toBe(SHARE_ACTION);
  expect(target.method).toBe("POST");
  expect(target.enctype).toBe("multipart/form-data");
  expect(target.params.files[0].name).toBe(SHARE_FIELD);
  expect(manifest.file_handlers[0].action).toBe("/share");
});

test("every file type a tool takes can be shared to the app and opened with it", () => {
  const shareable = new Set<string>(manifest.share_target.params.files[0].accept);
  const handled = new Set<string>(Object.entries(manifest.file_handlers[0].accept as Record<string, string[]>).flatMap(([type, exts]) => [type, ...exts]));
  const missing: string[] = [];
  for (const tool of TOOLS) {
    for (const rule of tool.accept.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)) {
      if (rule === "text/plain") continue; // markdown and CSV also say text/plain; .md and .csv cover them for "Open with"
      if (!shareable.has(rule)) missing.push(`${tool.id}: ${rule} (share)`);
      if (!handled.has(rule)) missing.push(`${tool.id}: ${rule} (open with)`);
    }
  }
  expect(missing).toEqual([]);
});

test("a share holds only real files: empty slots and text fields are skipped", () => {
  const form = new FormData();
  form.append("files", new File([new Uint8Array([37, 80, 68, 70])], "scan.pdf", { type: "application/pdf" }));
  form.append("files", new File([], "empty.pdf"));
  form.append("files", "https://example.com/not-a-file");
  expect(sharedFiles(form.getAll("files")).map((f) => f.name)).toEqual(["scan.pdf"]);
});

test("without the service worker, the server turns a share away unread", async () => {
  const response = POST();
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("/share?offline=1");
  expect(response.body).toBeNull();
});

test("the share post is never cached", () => {
  expect(cachePolicy({ method: "POST", mode: "navigate", url: "https://x.test/share-target", origin: "https://x.test" })).toBe("skip");
});
