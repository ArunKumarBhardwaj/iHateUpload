/** Right-to-left text (Urdu) among left-to-right runs: the order runs are drawn in. */

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };

/**
 * Right-to-left text (Urdu) among other runs, in drawing order: a simplified bidi algorithm over the
 * runs of one line. Each right-to-left run is already in visual order from the shaper; this orders the
 * runs. The line's direction is its first strong run's; neutral runs (spaces, punctuation) take their
 * neighbours' direction when both agree, else the line's, and brackets in right-to-left runs mirror.
 */
export function visualOrder<T extends { text: string }>(runs: T[], isRtl: (s: T) => boolean): T[] {
  if (!runs.some(isRtl)) return runs;
  // spaces at a run's ends belong between runs, where the neighbours decide their direction
  const segs = runs.flatMap((s) => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text) as RegExpExecArray;
    return [m[1], m[2], m[3]].filter(Boolean).map((text) => ({ ...s, text }));
  });
  const rtlOf = new Map(segs.map((s) => [s, /\S/.test(s.text) && isRtl(s)]));
  const dir = segs.map((s) => (rtlOf.get(s) ? "R" : /[\p{L}\p{N}]/u.test(s.text) ? "L" : "N"));
  const base = dir.find((d) => d !== "N") ?? "L";
  const resolved = dir.map((d, i) => {
    if (d !== "N") return d;
    const before = dir.slice(0, i).reverse().find((x) => x !== "N") ?? base;
    const after = dir.slice(i + 1).find((x) => x !== "N") ?? base;
    return before === after ? before : base;
  });
  const levels = resolved.map((d) => (base === "R" ? (d === "R" ? 1 : 2) : d === "R" ? 1 : 0));
  const order = segs.map((_, i) => i);
  // reverse every run at or above each level, from the highest level down to 1
  for (let lv = Math.max(...levels); lv >= 1; lv--) {
    for (let i = 0; i < order.length; ) {
      if (levels[order[i]] < lv) {
        i++;
        continue;
      }
      let j = i;
      while (j < order.length && levels[order[j]] >= lv) j++;
      order.splice(i, j - i, ...order.slice(i, j).reverse());
      i = j;
    }
  }
  return order.map((i) => {
    const s = segs[i];
    if (resolved[i] !== "R" || dir[i] === "R") return s;
    return { ...s, text: [...s.text].reverse().map((ch) => MIRROR[ch] ?? ch).join("") };
  });
}
