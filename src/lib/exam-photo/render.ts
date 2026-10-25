import { checkOutput, type Check } from "./check";
import { byteBand, coverCrop, inkBounds, paperLevel, searchQuality } from "./fit";
import { padJpeg, setJpegDpi } from "./jpeg";
import type { CropFraming, Rect, SlotSpec } from "./types";

export type RenderInput = {
  framing: CropFraming;
  /** Print the name and date in a white band under a photo, as some forms ask. */
  stamp?: boolean;
  /** Signatures, thumbs and declarations: trim to the ink (default) or use the whole picture. */
  trim?: boolean;
  name?: string;
  date?: string;
};

export type RenderResult = {
  blob: Blob;
  bytes: Uint8Array;
  checks: Check[];
  /** Comment padding added to reach the size floor, in bytes. */
  padded: number;
};

/** Photos fill the frame; signatures, thumbs and declarations are trimmed to the ink and fitted whole. */
export function usesFraming(slot: SlotSpec): boolean {
  return slot.kind === "photo";
}

const STAMP_BAND = 0.2;

/** The part of the output the photo fills; the rest is the name and date band. */
export function photoArea(slot: SlotSpec, stamp: boolean): { width: number; height: number } {
  const band = stamp && slot.kind === "photo" ? Math.round(slot.height * STAMP_BAND) : 0;
  return { width: slot.width, height: slot.height - band };
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  return { canvas, ctx };
}

function luminance(data: Uint8ClampedArray): Uint8Array {
  const lum = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return lum;
}

/** Finds the ink on a downscaled copy, then maps the box back to the full image. */
function inkRect(bitmap: ImageBitmap): Rect {
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const { canvas, ctx } = canvas2d(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const box = inkBounds(luminance(ctx.getImageData(0, 0, w, h).data), w, h);
  canvas.width = 0;
  if (!box) {
    throw new Error(
      "No signature or ink found. Sign on plain white paper and keep the paper's edges out of the photo, or untick Trim to the ink.",
    );
  }
  return {
    x: box.x / scale,
    y: box.y / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
}

/**
 * Pushes paper to white and ink darker, keeping the ink's colour. Only the
 * drawn image is measured and changed: the white bars beside it would
 * otherwise read as the paper and leave grey phone-photo paper grey.
 */
function whitenPaper(ctx: CanvasRenderingContext2D, area: Rect) {
  const x = Math.floor(area.x);
  const y = Math.floor(area.y);
  const width = Math.max(1, Math.ceil(area.x + area.width) - x);
  const height = Math.max(1, Math.ceil(area.y + area.height) - y);
  const image = ctx.getImageData(x, y, width, height);
  const paper = paperLevel(luminance(image.data));
  const white = Math.max(120, paper - 18);
  const black = Math.min(70, white * 0.35);
  const span = white - black;
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.max(0, Math.min(255, ((d[i + c] - black) / span) * 255));
    }
  }
  ctx.putImageData(image, x, y);
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  top: number,
  bandHeight: number,
  name: string,
  date: string,
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top, width, bandHeight);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = [name.trim().toUpperCase(), date.trim()].filter(Boolean);
  const lineHeight = bandHeight / Math.max(lines.length, 1);
  lines.forEach((line, i) => {
    let size = Math.floor(lineHeight * 0.72);
    ctx.font = `600 ${size}px Arial, Helvetica, sans-serif`;
    while (size > 6 && ctx.measureText(line).width > width * 0.94) {
      size--;
      ctx.font = `600 ${size}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(line, width / 2, top + lineHeight * (i + 0.5));
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the JPG."))),
      "image/jpeg",
      quality,
    ),
  );
}

/** Opens a picked image, turned the right way up from its camera data. */
export function openImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/** Draws one slot from a source image and encodes a JPG that meets its rules. */
export async function renderSlot(
  bitmap: ImageBitmap,
  slot: SlotSpec,
  input: RenderInput,
): Promise<RenderResult> {
  const { canvas, ctx } = canvas2d(slot.width, slot.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slot.width, slot.height);
  ctx.imageSmoothingQuality = "high";

  const stamped = Boolean(input.stamp) && slot.kind === "photo";
  const areaHeight = photoArea(slot, stamped).height;
  const band = slot.height - areaHeight;

  if (usesFraming(slot)) {
    const rect = coverCrop(bitmap.width, bitmap.height, slot.width, areaHeight, input.framing);
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, slot.width, areaHeight);
  } else {
    const rect =
      input.trim === false
        ? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
        : inkRect(bitmap);
    const scale = Math.min(slot.width / rect.width, areaHeight / rect.height);
    const drawn = {
      x: (slot.width - rect.width * scale) / 2,
      y: (areaHeight - rect.height * scale) / 2,
      width: rect.width * scale,
      height: rect.height * scale,
    };
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, drawn.x, drawn.y, drawn.width, drawn.height);
    whitenPaper(ctx, drawn);
  }
  if (stamped) drawStamp(ctx, slot.width, areaHeight, band, input.name ?? "", input.date ?? "");

  const finish = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return slot.dpi ? setJpegDpi(bytes, slot.dpi) : bytes;
  };
  const tries = new Map<number, Uint8Array>();
  const limits = byteBand(slot);
  const fit = await searchQuality(async (quality) => {
    const bytes = await finish(await toBlob(canvas, quality));
    tries.set(quality, bytes);
    return bytes.length;
  }, limits);
  canvas.width = 0;

  if (fit.status === "over-max") {
    throw new Error(
      `${slot.label} is still over ${slot.maxKb} KB at the lowest quality. Try a plainer background.`,
    );
  }
  const best = tries.get(fit.quality)!;
  // A little over the floor, so a portal that rounds or counts headers still sees enough.
  const floor = limits.min > 0 ? Math.min(limits.min + 2048, (limits.min + limits.max) / 2) : 0;
  const bytes = padJpeg(best, Math.ceil(floor));
  return {
    bytes,
    blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }),
    checks: checkOutput(bytes, slot),
    padded: bytes.length - best.length,
  };
}
