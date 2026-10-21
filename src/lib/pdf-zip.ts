import JSZip from "jszip";
import { PDFDocument } from "@cantoo/pdf-lib";

export type ZipLevel = "store" | "fast" | "balanced" | "max";

export type PdfZipSettings = {
  /** 0 packs each file whole; N cuts every file into parts of N pages (1 = one PDF per page). */
  split: number;
  /** File name pattern without ".pdf": {name} {index} {part} {from} {to}. */
  template: string;
  /** Folder inside the archive; "a/b" nests. Empty puts files at the top. */
  folder: string;
  /** When splitting, put each source file's parts in a folder named after it. */
  fileFolders: boolean;
  level: ZipLevel;
};

export const DEFAULT_PDF_ZIP: PdfZipSettings = {
  split: 0,
  template: "{name}",
  folder: "",
  fileFolders: false,
  level: "balanced",
};

export type ZipEntryPlan = {
  file: number;
  /** One-based, inclusive. A whole file covers 1 to its page count. */
  from: number;
  to: number;
  path: string;
};

const DEFLATE_LEVEL: Record<Exclude<ZipLevel, "store">, number> = { fast: 1, balanced: 6, max: 9 };

function safeSegment(text: string) {
  return text
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "")
    .replace(/[. ]+$/, "")
    .trim();
}

function safeFolder(text: string) {
  return text
    .split(/[\\/]+/)
    .map(safeSegment)
    .filter(Boolean)
    .join("/");
}

function baseName(name: string) {
  return name.replace(/\.pdf$/i, "");
}

/** Where every output file goes, without reading any PDF (only page counts are needed). */
export function planZipEntries(
  files: { name: string; pages: number }[],
  settings: PdfZipSettings,
): ZipEntryPlan[] {
  const splitting = settings.split >= 1;
  const size = Math.floor(settings.split);
  let template = settings.template.trim() || "{name}";
  if (splitting && !/\{(part|from|to)\}/.test(template)) template += "-{part}";
  const top = safeFolder(settings.folder);

  const out: ZipEntryPlan[] = [];
  files.forEach((file, index) => {
    const name = baseName(file.name);
    const parts: [number, number][] = [];
    if (splitting) {
      for (let from = 1; from <= file.pages; from += size) parts.push([from, Math.min(file.pages, from + size - 1)]);
    } else {
      parts.push([1, file.pages]);
    }
    const width = String(parts.length).length;
    parts.forEach(([from, to], partIndex) => {
      const label = template
        .replace(/\{name\}/g, name)
        .replace(/\{index\}/g, String(index + 1))
        .replace(/\{part\}/g, String(partIndex + 1).padStart(width, "0"))
        .replace(/\{from\}/g, String(from))
        .replace(/\{to\}/g, String(to));
      const leaf = (safeSegment(label) || safeSegment(name) || "file") + ".pdf";
      const dirs = [top, splitting && settings.fileFolders ? safeSegment(name) : ""].filter(Boolean);
      out.push({ file: index, from, to, path: [...dirs, leaf].join("/") });
    });
  });

  // Never let two entries share a path (case-insensitive, like most unzip tools).
  const seen = new Map<string, number>();
  for (const entry of out) {
    const key = entry.path.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) entry.path = entry.path.replace(/\.pdf$/i, ` (${n}).pdf`);
  }
  return out;
}

/** Packs the PDFs, whole (byte for byte) or cut into parts, into one ZIP. */
export async function buildPdfZip(
  files: { name: string; bytes: Uint8Array }[],
  settings: PdfZipSettings,
  onProgress?: (ratio: number) => void,
): Promise<{ bytes: Uint8Array; entries: number }> {
  if (files.length === 0) throw new Error("Add at least one PDF to put in the ZIP.");
  const splitting = settings.split >= 1;
  const donors: (PDFDocument | null)[] = [];
  const counts: number[] = [];
  for (const file of files) {
    if (!splitting) {
      donors.push(null);
      counts.push(1);
      continue;
    }
    const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
    donors.push(doc);
    counts.push(doc.getPageCount());
  }
  const plan = planZipEntries(
    files.map((f, i) => ({ name: f.name, pages: counts[i] })),
    settings,
  );
  const zip = new JSZip();
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    let data = files[entry.file].bytes;
    const donor = donors[entry.file];
    if (donor) {
      const part = await PDFDocument.create();
      const indices = Array.from({ length: entry.to - entry.from + 1 }, (_, k) => entry.from - 1 + k);
      for (const page of await part.copyPages(donor, indices)) part.addPage(page);
      data = await part.save({ useObjectStreams: true });
    }
    zip.file(entry.path, data, { createFolders: false });
    onProgress?.(((i + 1) / plan.length) * 0.8);
  }
  const bytes = await zip.generateAsync(
    {
      type: "uint8array",
      compression: settings.level === "store" ? "STORE" : "DEFLATE",
      compressionOptions: settings.level === "store" ? undefined : { level: DEFLATE_LEVEL[settings.level] },
    },
    (meta) => onProgress?.(0.8 + (meta.percent / 100) * 0.2),
  );
  return { bytes, entries: plan.length };
}
