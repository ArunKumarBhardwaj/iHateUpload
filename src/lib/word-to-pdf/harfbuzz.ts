/**
 * Text shaping by HarfBuzz (C++, compiled to WebAssembly by harfbuzzjs), for the scripts whose
 * letters change shape and order as they join: the Indian scripts and Arabic (Urdu).
 *
 * harfbuzzjs' own wrapper fetches its .wasm from beside the bundled script, which a web build
 * doesn't have, so the module is instantiated here from bytes the caller loads, and only the few
 * C functions shaping needs are called directly.
 */

/** Shaped text in font units, glyphs in drawing order (left to right, also for right-to-left text). */
export interface Shaped {
  glyphs: number[];
  xAdvance: number[];
  xOffset: number[];
  yOffset: number[];
  width: number;
}

export interface HbFont {
  upem: number;
  shape(text: string): Shaped;
}

interface Exports {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_get_upem(face: number): number;
  hb_font_create(face: number): number;
  hb_font_set_scale(font: number, x: number, y: number): void;
  hb_buffer_create(): number;
  hb_buffer_destroy(buf: number): void;
  hb_buffer_add_utf16(buf: number, text: number, len: number, offset: number, itemLen: number): void;
  hb_buffer_guess_segment_properties(buf: number): void;
  hb_buffer_set_direction(buf: number, dir: number): void;
  hb_buffer_get_length(buf: number): number;
  hb_buffer_get_glyph_infos(buf: number, len: number): number;
  hb_buffer_get_glyph_positions(buf: number, len: number): number;
  hb_shape(font: number, buf: number, features: number, count: number): void;
}

/** The wasm file, as public/fonts serves it and the sync script copies it. */
export const HARFBUZZ_WASM = "harfbuzz-1.6.3.wasm";

const HB_MEMORY_MODE_READONLY = 1;
const HB_DIRECTION_LTR = 4;
/** digits run left to right even in right-to-left scripts */
const NUMBER_ONLY = /^[\p{Nd}.,\u066B\u066C]+$/u;

let loading: Promise<Exports | null> | undefined;

async function instantiate(bytes: Uint8Array): Promise<Exports> {
  // filled once instantiated; the heap-growth import needs the memory export
  const box: { ex?: Exports } = {};
  const imports = {
    env: {
      _abort_js: () => {
        throw new Error("harfbuzz aborted");
      },
      _emscripten_runtime_keepalive_clear: () => {},
      _setitimer_js: () => 0,
      emscripten_resize_heap: (want: number) => {
        const mem = (box.ex as Exports).memory;
        const pages = Math.ceil((want - mem.buffer.byteLength) / 65536);
        try {
          mem.grow(Math.max(pages, 1));
          return 1;
        } catch {
          return 0;
        }
      },
    },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => {
        throw new Error(`harfbuzz exited (${code})`);
      },
    },
  };
  const { instance } = (await WebAssembly.instantiate(bytes as BufferSource, imports)) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  const ex = instance.exports as unknown as Exports;
  box.ex = ex;
  ex.__wasm_call_ctors();
  return ex;
}

/** HarfBuzz, loaded once; null when it can't be loaded (callers fall back to fontkit). */
export function loadHarfBuzz(load: (file: string) => Promise<Uint8Array>): Promise<Exports | null> {
  loading ??= load(HARFBUZZ_WASM)
    .then(instantiate)
    .catch(() => {
      loading = undefined;
      return null;
    });
  return loading;
}

const fonts = new Map<string, HbFont>();

/**
 * A font HarfBuzz shapes with. The font's bytes stay in wasm memory for the page's lifetime, so each
 * font (by `key`, e.g. its file name) is copied in once and reused by every conversion.
 */
export function hbFont(hb: Exports, data: Uint8Array, key?: string): HbFont {
  const hit = key ? fonts.get(key) : undefined;
  if (hit) return hit;
  const font = makeFont(hb, data);
  if (key) fonts.set(key, font);
  return font;
}

function makeFont(hb: Exports, data: Uint8Array): HbFont {
  const ptr = hb.malloc(data.byteLength);
  new Uint8Array(hb.memory.buffer, ptr, data.byteLength).set(data);
  const blob = hb.hb_blob_create(ptr, data.byteLength, HB_MEMORY_MODE_READONLY, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  const upem = hb.hb_face_get_upem(face);
  const font = hb.hb_font_create(face);
  hb.hb_font_set_scale(font, upem, upem);
  const cache = new Map<string, Shaped>();
  return {
    upem,
    shape(text) {
      const hit = cache.get(text);
      if (hit) return hit;
      const buf = hb.hb_buffer_create();
      const tp = hb.malloc(text.length * 2 + 2);
      const units = new Uint16Array(hb.memory.buffer, tp, text.length);
      for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i);
      hb.hb_buffer_add_utf16(buf, tp, text.length, 0, text.length);
      hb.free(tp);
      hb.hb_buffer_guess_segment_properties(buf);
      if (NUMBER_ONLY.test(text)) hb.hb_buffer_set_direction(buf, HB_DIRECTION_LTR);
      hb.hb_shape(font, buf, 0, 0);
      const n = hb.hb_buffer_get_length(buf);
      // hb_glyph_info_t and hb_glyph_position_t are both five 32-bit fields
      const infos = new Uint32Array(hb.memory.buffer, hb.hb_buffer_get_glyph_infos(buf, 0), n * 5);
      const pos = new Int32Array(hb.memory.buffer, hb.hb_buffer_get_glyph_positions(buf, 0), n * 5);
      const out: Shaped = { glyphs: [], xAdvance: [], xOffset: [], yOffset: [], width: 0 };
      for (let i = 0; i < n; i++) {
        out.glyphs.push(infos[i * 5]);
        out.xAdvance.push(pos[i * 5]);
        out.xOffset.push(pos[i * 5 + 2]);
        out.yOffset.push(pos[i * 5 + 3]);
        out.width += pos[i * 5];
      }
      hb.hb_buffer_destroy(buf);
      if (cache.size > 2000) cache.clear();
      cache.set(text, out);
      return out;
    },
  };
}
