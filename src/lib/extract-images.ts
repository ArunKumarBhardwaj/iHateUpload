import type { FileItem, ResultItem } from "@/lib/job";
import {
  filterBySize,
  IMAGE_MIME,
  scanPdfImages,
  type ExtractedImage,
  type ImageScan,
} from "@/lib/pdf-images";
import type { ToolOptions } from "@/lib/tool-options";
import { batchBaseNames } from "@/lib/batch";

const cache = new WeakMap<File, Promise<ImageScan>>();

/** One scan per file, shared by the grid and the run button. */
export function scanFileImages(file: File): Promise<ImageScan> {
  let hit = cache.get(file);
  if (!hit) {
    hit = file
      .arrayBuffer()
      .then((buffer) => scanWithFallback(new Uint8Array(buffer)));
    cache.set(file, hit);
    hit.catch(() => cache.delete(file));
  }
  return hit;
}

/** Streams the direct decoder cannot read (fax, JBIG2, spot colour) go through pdf.js. */
async function scanWithFallback(bytes: Uint8Array): Promise<ImageScan> {
  const scan = await scanPdfImages(bytes);
  if (scan.skipped.length === 0 || typeof document === "undefined") return scan;
  try {
    const { loadPdfJs } = await import("@/lib/pdfjs");
    const { imageObject, rasterToPng } = await import("@/lib/extra-processors");
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const rescued: ExtractedImage[] = [];
    try {
      const pages = [...new Set(scan.skipped.map((s) => s.page))];
      for (const pageNum of pages) {
        const wanted = scan.skipped.filter((s) => s.page === pageNum);
        const page = await doc.getPage(pageNum);
        const ops = await page.getOperatorList();
        const used = new Set<string>();
        for (let i = 0; i < ops.fnArray.length && wanted.length; i++) {
          if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
          const name = ops.argsArray[i]?.[0];
          if (typeof name !== "string" || used.has(name)) continue;
          used.add(name);
          const img = await Promise.race([
            imageObject(page, name),
            new Promise<null>((r) => setTimeout(() => r(null), 4000)),
          ]);
          if (!img) continue;
          const at = wanted.findIndex(
            (w) => w.width === img.width && w.height === img.height,
          );
          if (at < 0) continue;
          wanted.splice(at, 1);
          const blob = await rasterToPng(img);
          rescued.push({
            id: `p${pageNum}-${name}`,
            page: pageNum,
            pages: [pageNum],
            width: img.width,
            height: img.height,
            format: "png",
            bytes: new Uint8Array(await blob.arrayBuffer()),
          });
        }
        page.cleanup();
      }
    } finally {
      await doc.loadingTask.destroy();
    }
    const images = [...scan.images, ...rescued].sort((a, b) => a.page - b.page);
    return { images, skipped: [] };
  } catch {
    return scan;
  }
}

export function imageFileName(
  base: string,
  image: ExtractedImage,
  index: number,
): string {
  return `${base}-p${image.page}-${index + 1}.${image.format}`;
}

export async function processExtractImages(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (!files[0]) throw new Error("Choose a PDF to pull images from.");
  const opts =
    options.kind === "extract-images"
      ? options
      : { minEdge: 0, excluded: [] as string[] };
  const bases = batchBaseNames(files.map((f) => f.name));
  const results: ResultItem[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    let scan: ImageScan;
    try {
      scan = await scanFileImages(item.file);
    } catch (error) {
      if (files.length === 1) throw error;
      skipped.push(`${item.name} (could not be read)`);
      continue;
    }
    const shown = filterBySize(scan.images, opts.minEdge);
    // The grid shows the first file, so its unticked images only apply there.
    const picked = i === 0 ? shown.filter((image) => !opts.excluded.includes(image.id)) : shown;
    if (files.length === 1) {
      if (scan.images.length === 0) throw new Error("This PDF has no embedded images to extract.");
      if (picked.length === 0) throw new Error("No image passes the size filter. Lower it or select more.");
    }
    if (picked.length === 0) {
      skipped.push(`${item.name} (no images${scan.images.length ? " pass the size filter" : ""})`);
      continue;
    }
    for (const image of picked) {
      const blob = new Blob([image.bytes as BlobPart], { type: IMAGE_MIME[image.format] });
      results.push({
        id: crypto.randomUUID(),
        name: imageFileName(bases[i], image, shown.indexOf(image)),
        size: blob.size,
        blob,
        originalSize: item.size,
        note: `${image.width} x ${image.height} px`,
      });
    }
    onProgress((i + 1) / files.length);
  }
  if (results.length === 0) throw new Error("None of these PDFs has an image to extract.");
  if (skipped.length) {
    const last = results[results.length - 1];
    last.note = `${last.note} · Skipped: ${skipped.join(", ")}.`;
  }
  return results;
}
