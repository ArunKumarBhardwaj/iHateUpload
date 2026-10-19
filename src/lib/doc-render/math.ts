/**
 * LaTeX -> vector paths with MathJax (Apache-2.0). MathJax's SVG output is plain glyph outlines,
 * which are walked here and turned into PDF path data, so formulas stay sharp at any zoom.
 */
import { mathKey, registerMath, type MathArt } from "./math-art";

interface Mx {
  a: number;
  d: number;
  e: number;
  f: number;
}
const ID: Mx = { a: 1, d: 1, e: 0, f: 0 };

interface MNode {
  kind: string;
  attrs: Record<string, string>;
  children: MNode[];
}

const num = (v: string | undefined, d = 0) => (v !== undefined && Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
const r5 = (n: number) => String(Math.round(n * 1e5) / 1e5);

function compose(m: Mx, a: number, d: number, e: number, f: number): Mx {
  // m * [a 0 e; 0 d f]
  return { a: m.a * a, d: m.d * d, e: m.a * e + m.e, f: m.d * f + m.f };
}

function applyTransform(m: Mx, t: string | undefined): Mx {
  if (!t) return m;
  let out = m;
  for (const part of t.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
    const v = part[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (part[1] === "translate") out = compose(out, 1, 1, v[0] ?? 0, v[1] ?? 0);
    else if (part[1] === "scale") out = compose(out, v[0] ?? 1, v[1] ?? v[0] ?? 1, 0, 0);
    else if (v.length === 6) out = compose(out, v[0], v[3], v[4], v[5]);
  }
  return out;
}

const ARGS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };

/** Apply a scale+translate to SVG path data (absolute and relative commands). Arcs are not used by MathJax. */
export function transformPath(d: string, m: Mx, unit: number): string {
  const out: string[] = [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let cmd = "";
  let k = 0;
  while (k < tokens.length) {
    const t = tokens[k];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      k++;
      if (cmd === "z" || cmd === "Z") out.push("Z");
      continue;
    }
    const lower = cmd.toLowerCase();
    const n = ARGS[lower];
    if (!n || lower === "a") return ""; // unsupported
    const rel = cmd !== cmd.toUpperCase();
    const args = tokens.slice(k, k + n).map(Number);
    if (args.length < n) break;
    k += n;
    const mapped = args.map((v, i) => {
      const xAxis = lower === "h" ? true : lower === "v" ? false : i % 2 === 0;
      const scale = xAxis ? m.a : m.d;
      const shift = rel ? 0 : xAxis ? m.e : m.f;
      return r5((v * scale + shift) / unit);
    });
    out.push(`${cmd}${mapped.join(" ")}`);
    // implicit repeats of M become L
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
  }
  return out.join(" ");
}

interface Dom {
  kind(n: unknown): string;
  getAttribute(n: unknown, a: string): string | null;
  childNodes(n: unknown): unknown[];
}

function toTree(node: unknown, adaptor: Dom): MNode {
  const attrs: Record<string, string> = {};
  if (adaptor.kind(node).startsWith("#")) return { kind: adaptor.kind(node), attrs, children: [] };
  for (const a of ["transform", "d", "x", "y", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "x1", "y1", "x2", "y2", "data-mml-node"]) {
    const v = adaptor.getAttribute(node, a);
    if (v !== null && v !== undefined) attrs[a] = v;
  }
  return { kind: adaptor.kind(node), attrs, children: adaptor.childNodes(node).map((c) => toTree(c, adaptor)).filter((c) => c.kind !== "#text" && c.kind !== "#comment") };
}

function collect(n: MNode, m: Mx, fill: string, stroke: string, sw: number, unit: number, out: MathArt["paths"], flags: { bad: boolean }) {
  const f = n.attrs.fill ?? fill;
  const s = n.attrs.stroke ?? stroke;
  const w = n.attrs["stroke-width"] !== undefined ? num(n.attrs["stroke-width"]) : sw;
  const mm = applyTransform(m, n.attrs.transform);
  if (n.attrs["data-mml-node"] === "merror") flags.bad = true;
  const strokeW = s !== "none" && w > 0 ? w * Math.abs(mm.a) / unit : undefined;
  const push = (d: string) => {
    if (!d) return;
    if (f !== "none") out.push({ d });
    if (strokeW) out.push({ d, stroke: strokeW });
  };
  switch (n.kind) {
    case "path":
      push(transformPath(n.attrs.d ?? "", mm, unit));
      return;
    case "rect": {
      const x = num(n.attrs.x), y = num(n.attrs.y), w2 = num(n.attrs.width), h = num(n.attrs.height);
      push(transformPath(`M${x} ${y}H${x + w2}V${y + h}H${x}Z`, mm, unit));
      return;
    }
    case "line":
      if (strokeW) out.push({ d: transformPath(`M${num(n.attrs.x1)} ${num(n.attrs.y1)}L${num(n.attrs.x2)} ${num(n.attrs.y2)}`, mm, unit), stroke: strokeW });
      return;
    case "text":
    case "use":
    case "image":
      flags.bad = true; // glyphs that are not outlines cannot be drawn as vectors
      return;
    case "svg": {
      let inner = mm;
      const vb = (n.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
      if (vb.length === 4 && n.attrs.width && n.attrs.height) {
        // nested svg (stretchy accents and braces): plain user units map the viewBox onto x, y, width, height
        const sx = vb[2] ? num(n.attrs.width) / vb[2] : 1;
        const sy = vb[3] ? num(n.attrs.height) / vb[3] : 1;
        inner = compose(compose(compose(mm, 1, 1, num(n.attrs.x), num(n.attrs.y)), sx, sy, 0, 0), 1, 1, -vb[0], -vb[1]);
      }
      for (const c of n.children) collect(c, inner, f, s, w, unit, out, flags);
      return;
    }
    default:
      for (const c of n.children) collect(c, mm, f, s, w, unit, out, flags);
  }
}

interface Engine {
  convert: (tex: string, display: boolean) => MNode;
}
let engine: Promise<Engine> | undefined;

function load(): Promise<Engine> {
  engine ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
    ]);
    await Promise.all([
      import("mathjax-full/js/input/tex/base/BaseConfiguration.js"),
      import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
      import("mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js"),
      import("mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js"),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", {
      InputJax: new TeX({ packages: ["base", "ams", "newcommand", "noundefined"], formatError: (_jax: unknown, err: Error) => { throw err; } }),
      OutputJax: new SVG({ fontCache: "none" }),
    });
    return {
      convert: (tex, display) => {
        const container = doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 1280 });
        const svg = adaptor.firstChild(container);
        return toTree(svg, adaptor as unknown as Dom);
      },
    };
  })();
  return engine;
}

/** Render each distinct formula once. Formulas MathJax rejects are left out, so they print as typed. */
export async function renderMath(items: { tex: string; display: boolean }[]): Promise<Map<string, MathArt>> {
  const out = new Map<string, MathArt>();
  if (!items.length) return out;
  const eng = await load();
  for (const { tex, display } of items) {
    try {
      const svg = eng.convert(tex, display);
      const vb = (svg.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) continue;
      const paths: MathArt["paths"] = [];
      const flags = { bad: false };
      const unit = 1000;
      for (const c of svg.children) collect(c, { ...ID, e: -vb[0], f: -vb[1] }, "currentColor", "none", 0, unit, paths, flags);
      // the root <g> scale(1,-1) is applied by collect through its own transform attribute
      if (flags.bad || !paths.length) continue;
      out.set(mathKey(tex, display), registerMath({ w: vb[2] / unit, h: vb[3] / unit, depth: (vb[1] + vb[3]) / unit, paths }));
    } catch {
      /* invalid TeX: keep it as plain text */
    }
  }
  return out;
}
