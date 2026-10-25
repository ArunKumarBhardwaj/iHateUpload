import { byteBand } from "./fit";
import { readJpegInfo } from "./jpeg";
import type { SlotSpec } from "./types";

export type Check = {
  id: "format" | "size" | "pixels" | "dpi";
  label: string;
  ok: boolean;
  /** What the file has, e.g. "48.2 KB". */
  value: string;
  /** What the notice asks for, e.g. "20–50 KB". */
  wanted: string;
};

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function range(min: number, max: number | undefined, unit = ""): string {
  if (max === undefined) return `${min}${unit}+`;
  return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
}

/** Re-reads the finished file and checks it against the slot's rules. */
export function checkOutput(bytes: Uint8Array, slot: SlotSpec): Check[] {
  const info = readJpegInfo(bytes);
  const band = byteBand(slot);
  const checks: Check[] = [
    {
      id: "format",
      label: "Format",
      ok: info !== null,
      value: info ? "JPG" : "Not a JPG",
      wanted: "JPG",
    },
    {
      id: "size",
      label: "File size",
      ok: bytes.length >= band.min && bytes.length <= band.max,
      value: kb(bytes.length),
      wanted: slot.minKb > 0 ? `${range(slot.minKb, slot.maxKb)} KB` : `up to ${slot.maxKb} KB`,
    },
  ];

  const px = slot.pixels;
  checks.push({
    id: "pixels",
    label: "Pixels",
    ok:
      info !== null &&
      (!px ||
        (info.width >= px.minWidth &&
          info.width <= (px.maxWidth ?? Infinity) &&
          info.height >= px.minHeight &&
          info.height <= (px.maxHeight ?? Infinity))),
    value: info ? `${info.width} × ${info.height}` : "—",
    wanted: px
      ? `${range(px.minWidth, px.maxWidth)} × ${range(px.minHeight, px.maxHeight)}`
      : "not set by the notice",
  });

  if (slot.dpi) {
    checks.push({
      id: "dpi",
      label: "Print density",
      ok: slot.minDpi ? (info?.dpi ?? 0) >= slot.minDpi : info?.dpi === slot.dpi,
      value: info?.dpi ? `${info.dpi} DPI` : "Not set",
      wanted: slot.minDpi ? `${slot.minDpi}+ DPI` : `${slot.dpi} DPI`,
    });
  }
  return checks;
}
