import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function jpegSmaller(
  bytes: Uint8Array,
  quality: number,
): Promise<Uint8Array | null> {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, bitmap.width);
  canvas.height = Math.max(1, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    release(canvas);
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const next = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  release(canvas);
  if (!next || next.size >= bytes.length) return null;
  return new Uint8Array(await next.arrayBuffer());
}

export async function recompressJpegXObjects(
  doc: PDFDocument,
  quality: number,
): Promise<number> {
  let replaced = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict.get(PDFName.of("Subtype"));
    const filter = object.dict.get(PDFName.of("Filter"));
    if (subtype?.toString() !== "/Image") continue;
    const filterName = filter?.toString() ?? "";
    if (!filterName.includes("DCTDecode")) continue;
    const bytes = object.getContents();
    if (bytes.length < 400) continue;
    const smaller = await jpegSmaller(bytes, quality);
    if (!smaller) continue;
    object.contents = smaller;
    object.dict.set(PDFName.of("Length"), doc.context.obj(smaller.length));
    replaced += 1;
  }
  return replaced;
}
