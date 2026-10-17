// Reads what h2h.mjs downloaded and prints what each side actually produced.
// Usage: bun bench/pdf-tools/verify.ts <h2hDir>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import JSZip from "jszip";

import { readMetadata, loadForMetadata, parseXmpValues } from "../../src/lib/pdf-meta";
import { readPageTexts } from "../../src/lib/split-plan";

const dir = process.argv[2];

async function pdfsIn(folder: string) {
  const out: { name: string; bytes: Uint8Array }[] = [];
  if (!existsSync(folder)) return out;
  for (const file of readdirSync(folder)) {
    const bytes = readFileSync(join(folder, file));
    if (file.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(bytes);
      for (const name of Object.keys(zip.files).sort()) {
        if (name.endsWith(".pdf")) out.push({ name, bytes: await zip.files[name].async("uint8array") });
      }
    } else if (file.endsWith(".pdf")) {
      out.push({ name: file, bytes: new Uint8Array(bytes) });
    } else {
      out.push({ name: file, bytes: new Uint8Array(bytes) });
    }
  }
  return out;
}

for (const task of ["split-bookmarks", "split-text", "bates", "metadata", "metadata-xmp", "split-bookmarks-big", "split-text-big", "bates-big"]) {
  for (const side of ["ours", "rival"]) {
    console.log(`\n=== ${task} / ${side}`);
    for (const { name, bytes } of await pdfsIn(join(dir, task, side))) {
      if (name.endsWith(".csv")) {
        console.log(`${name}\n${new TextDecoder().decode(bytes)}`);
        continue;
      }
      if (task.startsWith("metadata")) {
        const meta = readMetadata(await loadForMetadata(bytes));
        console.log(name, JSON.stringify({ ...meta, xmp: meta.xmp ? parseXmpValues(meta.xmp) : null }));
        continue;
      }
      const texts = await readPageTexts(bytes);
      if (task.endsWith("-big")) { console.log(name, `${texts.length}p`); continue; }
      const label = task === "bates" ? texts.map((t) => t.split("\n").pop()).join(" | ") : texts.map((t) => t.split("\n")[0]).join(" | ");
      console.log(`${name} (${texts.length}p): ${label}`);
    }
  }
}
