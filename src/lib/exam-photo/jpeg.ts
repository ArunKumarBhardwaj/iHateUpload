/**
 * Byte-level JPEG helpers. The check reads the real output file through these
 * instead of trusting what the canvas was asked to draw.
 */

export type JpegInfo = { width: number; height: number; dpi: number | null };

const SOI = 0xd8;
const APP0 = 0xe0;
const COM = 0xfe;
const SOS = 0xda;
const MAX_SEGMENT = 0xffff - 2;

function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

type Segment = { marker: number; start: number; end: number };

/** Header segments up to the start of scan; null when the bytes are not a JPEG. */
function headerSegments(bytes: Uint8Array): Segment[] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const segments: Segment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    const end = at + 2 + u16(bytes, at + 2);
    if (end > bytes.length) return null;
    segments.push({ marker, start: at, end });
    if (marker === SOS) return segments;
    at = end;
  }
  return null;
}

function jfifAt(bytes: Uint8Array, seg: Segment): boolean {
  return (
    seg.marker === APP0 &&
    seg.end - seg.start >= 18 &&
    bytes[seg.start + 4] === 0x4a &&
    bytes[seg.start + 5] === 0x46 &&
    bytes[seg.start + 6] === 0x49 &&
    bytes[seg.start + 7] === 0x46 &&
    bytes[seg.start + 8] === 0
  );
}

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  const segments = headerSegments(bytes);
  if (!segments) return null;
  const frame = segments.find((s) => isFrameMarker(s.marker));
  if (!frame) return null;
  const jfif = segments.find((s) => jfifAt(bytes, s));
  let dpi: number | null = null;
  if (jfif) {
    const units = bytes[jfif.start + 11];
    const density = u16(bytes, jfif.start + 12);
    if (units === 1) dpi = density;
    else if (units === 2) dpi = Math.round(density * 2.54);
  }
  return {
    height: u16(bytes, frame.start + 5),
    width: u16(bytes, frame.start + 7),
    dpi,
  };
}

/** Writes the print density into the JFIF header, adding one if the file has none. */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const segments = headerSegments(bytes);
  if (!segments) throw new Error("Not a JPEG file.");
  const density = Math.max(1, Math.min(0xffff, Math.round(dpi)));
  const jfif = segments.find((s) => jfifAt(bytes, s));
  if (jfif) {
    const out = bytes.slice();
    out[jfif.start + 11] = 1;
    out[jfif.start + 12] = density >> 8;
    out[jfif.start + 13] = density & 0xff;
    out[jfif.start + 14] = density >> 8;
    out[jfif.start + 15] = density & 0xff;
    return out;
  }
  const app0 = new Uint8Array([
    0xff, APP0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    density >> 8, density & 0xff, density >> 8, density & 0xff, 0x00, 0x00,
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/**
 * Grows a JPEG to at least `minBytes` with comment segments. Portals reject
 * files under a floor (often 10 or 20 KB) even when a small file looks fine;
 * comments add bytes without touching a pixel.
 */
export function padJpeg(bytes: Uint8Array, minBytes: number): Uint8Array {
  if (bytes.length >= minBytes) return bytes;
  const segments = headerSegments(bytes);
  if (!segments) throw new Error("Not a JPEG file.");
  // JFIF must stay the first segment, so comments go after it.
  const first = segments[0];
  const insertAt = first && jfifAt(bytes, first) ? first.end : 2;

  const chunks: Uint8Array[] = [];
  let missing = minBytes - bytes.length;
  while (missing > 0) {
    const payload = Math.min(MAX_SEGMENT, Math.max(1, missing - 4));
    const seg = new Uint8Array(4 + payload).fill(0x20);
    seg[0] = 0xff;
    seg[1] = COM;
    seg[2] = (payload + 2) >> 8;
    seg[3] = (payload + 2) & 0xff;
    chunks.push(seg);
    missing -= seg.length;
  }

  const padding = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(bytes.length + padding);
  out.set(bytes.subarray(0, insertAt), 0);
  let at = insertAt;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  out.set(bytes.subarray(insertAt), at);
  return out;
}
