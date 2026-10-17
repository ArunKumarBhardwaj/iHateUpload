/**
 * Table cells read from a scan, corrected from the column they sit in. A letter that sits in a
 * column of numbers is a digit the scanner got wrong, but only when the digit version is a number.
 */
import { parseCell } from "./cells";
import type { Grid } from "./grid";

const DIGIT_FOR: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  l: "1", I: "1", "|": "1", i: "1", "!": "1",
  S: "5", s: "5",
  B: "8",
  Z: "2", z: "2",
  g: "9", q: "9",
  G: "6",
};

const UNITS = new Set([
  "qt", "pt", "oz", "lb", "lbs", "kg", "g", "mg", "ml", "l", "cl", "gal", "in", "ft", "yd", "cm", "mm", "m", "km", "mi", "pcs", "ea", "hr", "min", "sec",
]);
/** Characters a scanner swaps for one another, in both directions. */
const CONFUSED: Record<string, string[]> = {
  g: ["q", "9"], q: ["g"], "0": ["o"], o: ["0"], "1": ["l", "i"], l: ["1", "i"], i: ["l", "1"], "5": ["s"], rn: ["m"], m: ["rn"],
};

function unitFor(token: string): string | null {
  const t = token.toLowerCase();
  if (UNITS.has(t)) return null;
  // One or two swapped characters is as far as a guess should go.
  const swaps = (s: string, left: number): string[] => {
    if (left === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      for (const alt of CONFUSED[s[i]] ?? []) out.push(s.slice(0, i) + alt + s.slice(i + 1));
    }
    return [...out, ...out.flatMap((o) => swaps(o, left - 1))];
  };
  return swaps(t, 2).find((c) => UNITS.has(c)) ?? null;
}

const LETTER_FOR: Record<string, string> = { "0": "o", "1": "l", "5": "s" };

/** The cell as a number, if it is one or is a few wrong letters away from one. */
function asNumberText(text: string, lenient = false): string | null {
  if (parseCell(text).kind === "number") return text;
  // Mostly digits and punctuation, so a few wrong letters rather than a word.
  const body = text.replace(/[$€£¥₹%(),.\-\s]/g, "");
  const digits = (body.match(/\d/g) ?? []).length;
  const confusable = [...body].filter((ch) => DIGIT_FOR[ch]).length;
  if (!body || digits + confusable !== body.length || confusable === 0 || (!lenient && digits < confusable - 1)) return null;
  const next = [...text].map((ch) => (/[A-Za-z|!]/.test(ch) ? (DIGIT_FOR[ch] ?? ch) : ch)).join("");
  return parseCell(next).kind === "number" ? next : null;
}

/** Fix cells in place. Returns how many it changed. */
export function fixOcrGrid(grid: Grid): number {
  let changed = 0;
  const set = (cell: { text: string }, text: string) => {
    if (text !== cell.text) {
      cell.text = text;
      changed++;
    }
  };
  const cols = grid.xs.length - 1;
  for (let c = 0; c < cols; c++) {
    const cells = grid.rows.map((row) => row[c]).filter((cell) => cell && !cell.covered && cell.text.trim());
    const plausible = cells.filter((cell) => asNumberText(cell.text.trim()) !== null).length;
    const numberColumn = cells.length >= 3 && plausible >= Math.max(2, cells.length * 0.6);
    const unitCells = cells.map((cell) => /^\d[\d.,]*(\s*)[A-Za-z0-9]{1,4}$/.exec(cell.text.trim())).filter((x) => x);
    const spaced = unitCells.filter((x) => x![1]).length >= unitCells.filter((x) => !x![1]).length;
    for (const cell of cells) {
      const text = cell.text.trim();
      if (numberColumn) {
        // A column of numbers has no words in it, so "BO" is 80; the header row is left alone.
        const next = asNumberText(text, cell !== cells[0]);
        if (next && next !== text) set(cell, next);
        continue;
      }
      // "12 gt" is twelve quarts: the word after a number is a unit.
      const m = /^(\d[\d.,]*)(\s*)([A-Za-z0-9]{1,4})$/.exec(text);
      if (m) {
        const unit = unitFor(m[3]) ?? (UNITS.has(m[3].toLowerCase()) ? m[3].toLowerCase() : null);
        if (unit) {
          // The column's habit decides whether a number and its unit are written apart.
          set(cell, `${m[1]}${m[2] || spaced ? " " : ""}${unit}`);
          continue;
        }
      }
      // A digit inside a plain word, as in "Co1d".
      if (/\s|^[A-Za-z]/.test(text) && /^[A-Za-z0-9 ]+$/.test(text) && !/\d{2}/.test(text)) {
        const words = text.split(" ").map((w0) => {
          // English has no Q without a U after it, bar a few names: "Qil" is "Oil".
          const w = /^Q[a-tv-z][a-z]+$/.test(w0) ? `O${w0.slice(1)}` : w0;
          const letters = (w.match(/[A-Za-z]/g) ?? []).length;
          const odd = w.match(/[015]/g) ?? [];
          if (letters >= 3 && letters === w.length - 1 && odd.length === 1 && w.length >= 4 && /^[A-Za-z]/.test(w) && /[a-z]$/.test(w)) {
            return w.replace(/[015]/, (d) => LETTER_FOR[d]);
          }
          return w;
        });
        set(cell, words.join(" "));
      }
    }
  }
  return changed;
}
