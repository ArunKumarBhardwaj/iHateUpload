/** Math drawn as vector paths. `MathArt` coordinates are in em units, origin at the top-left of the box. */
export const MATH_MIME = "application/x-ihu-math";

export interface MathArt {
  /** identity key used as the picture "data" so layout and drawing can find the art again */
  key: Uint8Array;
  /** box size in em */
  w: number;
  h: number;
  /** part of the height below the baseline, in em */
  depth: number;
  paths: { d: string; stroke?: number }[];
}

const registry = new WeakMap<Uint8Array, MathArt>();

export function registerMath(art: Omit<MathArt, "key">): MathArt {
  const full: MathArt = { ...art, key: new Uint8Array(1) };
  registry.set(full.key, full);
  return full;
}

export const mathArtOf = (key: Uint8Array): MathArt | undefined => registry.get(key);

/** Where inline `$..$` and `$$..$$` math starts at index i of s, or null. Pandoc's rules, so "$5 and $10" is money. */
export function matchMath(s: string, i: number): { tex: string; end: number; display: boolean } | null {
  if (s[i] === "\\" && (s[i + 1] === "(" || s[i + 1] === "[")) {
    // \( ... \) inline and \[ ... \] display, the other common LaTeX spellings
    const display = s[i + 1] === "[";
    const end = s.indexOf(display ? "\\]" : "\\)", i + 2);
    const tex = end > 0 ? s.slice(i + 2, end).trim() : "";
    return tex ? { tex, end: end + 2, display } : null;
  }
  if (s[i] !== "$") return null;
  if (s[i + 1] === "$") {
    const end = s.indexOf("$$", i + 2);
    const tex = end > 0 ? s.slice(i + 2, end).trim() : "";
    return tex ? { tex, end: end + 2, display: true } : null;
  }
  const next = s[i + 1];
  if (next === undefined || /\s/.test(next)) return null;
  const limit = Math.min(s.length, i + 600);
  for (let j = i + 1; j < limit; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "$") {
      if (/\s/.test(s[j - 1]) || /\d/.test(s[j + 1] ?? "")) return null;
      return { tex: s.slice(i + 1, j), end: j + 1, display: false };
    }
  }
  return null;
}

export const mathKey = (tex: string, display: boolean) => `${display ? "D" : "I"}:${tex.replace(/\s*\n\s*/g, " ").trim()}`;

/** Every math span in a Markdown source, for the pre-render pass. Over-matching (code, say) only costs time. */
export function findMathSpans(source: string): { tex: string; display: boolean }[] {
  const found = new Map<string, { tex: string; display: boolean }>();
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\" && source[i + 1] !== "(" && source[i + 1] !== "[") {
      i++;
      continue;
    }
    if (source[i] !== "$" && source[i] !== "\\") continue;
    const m = matchMath(source, i);
    if (m) {
      found.set(mathKey(m.tex, m.display), { tex: m.tex.replace(/\s*\n\s*/g, " ").trim(), display: m.display });
      i = m.end - 1;
    }
  }
  return [...found.values()];
}
