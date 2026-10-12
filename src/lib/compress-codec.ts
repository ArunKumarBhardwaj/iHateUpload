import decodeJpeg, { init as initDecode } from "@jsquash/jpeg/decode";
import encodeJpeg, { init as initEncode } from "@jsquash/jpeg/encode";
import initResize, {
  resize as lanczos,
} from "@jsquash/resize/lib/resize/pkg/squoosh_resize.js";

import type { ImageCodec, Pixels } from "@/lib/compress-engine";

/**
 * The same WebAssembly the Squoosh app ships: MozJPEG (C) for JPEG in and
 * out, and a Lanczos3 resampler written in Rust. Files live in /codecs so a
 * worker, the main thread, and tests can each say where to load them from.
 */
export const CODEC_FILES = {
  decode: "mozjpeg_dec.wasm",
  encode: "mozjpeg_enc.wasm",
  resize: "squoosh_resize_bg.wasm",
} as const;

export type WasmLoader = (file: string) => Promise<WebAssembly.Module>;

export const fetchWasm: WasmLoader = (file) =>
  WebAssembly.compileStreaming(fetch(`/codecs/${file}`));

const LANCZOS3 = 3;
// MozJPEG color spaces: 1 = grayscale, 3 = YCbCr.
const GRAYSCALE = 1;
const YCBCR = 3;

let ready: Promise<void> | null = null;

function load(loader: WasmLoader) {
  ready ??= Promise.all([
    loader(CODEC_FILES.decode).then((m) => initDecode(m)),
    loader(CODEC_FILES.encode).then((m) => initEncode(m)),
    loader(CODEC_FILES.resize).then((m) => initResize(m)),
  ]).then(() => undefined);
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

export function createWasmCodec(loader: WasmLoader = fetchWasm): ImageCodec {
  return {
    async decodeJpeg(bytes) {
      await load(loader);
      try {
        // PDFs draw raw JPEG samples, so EXIF rotation must not apply.
        const image = await decodeJpeg(bytes.slice().buffer as ArrayBuffer, {
          preserveOrientation: false,
        });
        return { data: image.data, width: image.width, height: image.height };
      } catch {
        return null;
      }
    },
    async resize(pixels, width, height): Promise<Pixels> {
      await load(loader);
      const data = lanczos(
        new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
        pixels.width,
        pixels.height,
        width,
        height,
        LANCZOS3,
        true,
        false,
      );
      return { data, width, height };
    },
    async encodeJpeg(pixels, quality, gray) {
      await load(loader);
      const buffer = await encodeJpeg(pixels as ImageData, {
        quality,
        color_space: gray ? GRAYSCALE : YCBCR,
      });
      return new Uint8Array(buffer);
    },
  };
}
