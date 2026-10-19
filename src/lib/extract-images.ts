import type { FileItem, ResultItem } from "@/lib/job";
import {
  filterBySize,
  IMAGE_MIME,
  scanPdfImages,
  type ExtractedImage,
  type ImageScan,
} from "@/lib/pdf-images";
import type { ToolOptions } from "@/lib/tool-options";

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
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to pull images from.");
  const opts =
    options.kind === "extract-images"
      ? options
      : { minEdge: 0, excluded: [] as string[] };
  onProgress(0.1);
  const scan = await scanFileImages(item.file);
  if (scan.images.length === 0) {
    throw new Error("This PDF has no embedded images to extract.");
  }
  const shown = filterBySize(scan.images, opts.minEdge);
  const picked = shown.filter((image) => !opts.excluded.includes(image.id));
  if (picked.length === 0) {
    throw new Error("No image passes the size filter. Lower it or select more.");
  }
  const base = item.name.replace(/\.[^.]+$/, "");
  onProgress(1);
  return picked.map((image) => {
    const blob = new Blob([image.bytes as BlobPart], {
      type: IMAGE_MIME[image.format],
    });
    return {
      id: crypto.randomUUID(),
      name: imageFileName(base, image, shown.indexOf(image)),
      size: blob.size,
      blob,
      originalSize: item.size,
      note: `${image.width} x ${image.height} px`,
    };
  });
}
