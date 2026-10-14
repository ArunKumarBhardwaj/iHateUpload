/** Reads a .docx (zip of OOXML) into a small normalised model the scorer can compare to ground truth. */
import JSZip from "jszip";

export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

/** Minimal XML parser: elements, attributes, text, CDATA. Enough for OOXML. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
        const node: XNode = { name: m[3], attrs, children: [], text: "" };
        top.children.push(node);
        if (!m[5]) stack.push(node);
      }
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return root.children[0] ?? root;
}

const kids = (n: XNode, name: string) => n.children.filter((c) => c.name === name);
const kid = (n: XNode, name: string) => n.children.find((c) => c.name === name);
function walk(n: XNode, fn: (x: XNode) => boolean | void) {
  for (const c of n.children) if (fn(c) !== false) walk(c, fn);
}
const val = (n: XNode | undefined) => n?.attrs["w:val"];
const on = (n: XNode | undefined) => !!n && !["0", "false", "off", "none"].includes(n.attrs["w:val"] ?? "true");

export type RunFmt = { b: boolean; i: boolean; u: boolean; s: boolean; sup: boolean; sub: boolean; hl: boolean; color: string; size: number; font: string };
export type Run = { text: string; fmt: RunFmt };
export type Para = {
  text: string;
  runs: Run[];
  headingLevel: number;
  list: { type: "bullet" | "number"; level: number } | null;
  inTextbox: boolean;
  inTable: boolean;
  /** Starts with a typed bullet/number rather than a real list. */
  literalMarker: boolean;
};
export type Cell = { text: string; rs: number; cs: number; shaded: boolean };
export type Table = { rows: (Cell | null)[][] };
export type Link = { url: string; text: string };
export type StreamItem = { t: "text"; text: string } | { t: "image" } | { t: "shape" };

export type DocxModel = {
  paragraphs: Para[];
  tables: Table[];
  stream: StreamItem[];
  images: number;
  shapes: number;
  links: Link[];
  columns: number;
  fontNames: string[];
  embeddedFonts: number;
  headerText: string;
  footerText: string;
  pageField: boolean;
  footnotes: string[];
  formFields: { checkbox: number; text: number };
};

const MARKER = /^(?:[•◦▪●○■□·*–—-]|\d{1,2}[.)]|[a-zA-Z][.)])$/;
export const isMarkerToken = (t: string) => MARKER.test(t);

export async function readDocx(bytes: Uint8Array | ArrayBuffer): Promise<DocxModel> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (await zip.file(p)?.async("string")) ?? "";
  const doc = parseXml(await read("word/document.xml"));
  const stylesXml = await read("word/styles.xml");
  const styles = stylesXml ? parseXml(stylesXml) : null;
  const numXml = await read("word/numbering.xml");
  const numbering = numXml ? parseXml(numXml) : null;
  const relsXml = await read("word/_rels/document.xml.rels");
  const rels = new Map<string, string>();
  if (relsXml) for (const r of parseXml(relsXml).children) rels.set(r.attrs["Id"], r.attrs["Target"] ?? "");

  // styles: name, outline level, default run props
  const styleInfo = new Map<string, { name: string; outline: number; based?: string; rpr?: XNode }>();
  let defaultRpr: XNode | undefined;
  if (styles) {
    const dd = kid(styles, "w:docDefaults");
    defaultRpr = dd && kid(kid(dd, "w:rPrDefault") ?? dd, "w:rPr");
    for (const s of kids(styles, "w:style")) {
      const ppr = kid(s, "w:pPr");
      const ol = ppr && kid(ppr, "w:outlineLvl");
      styleInfo.set(s.attrs["w:styleId"], {
        name: val(kid(s, "w:name")) ?? "",
        outline: ol ? Number(val(ol)) + 1 : 0,
        based: val(kid(s, "w:basedOn")),
        rpr: kid(s, "w:rPr"),
      });
    }
  }
  const headingLevelOf = (styleId: string | undefined, ppr: XNode | undefined): number => {
    const direct = ppr && kid(ppr, "w:outlineLvl");
    if (direct && Number(val(direct)) < 9) return Number(val(direct)) + 1;
    for (let id = styleId, d = 0; id && d < 6; d++) {
      const st = styleInfo.get(id);
      const m = /^heading\s*(\d)$/i.exec(st?.name ?? id) ?? /^heading\s*(\d)$/i.exec(id);
      if (m) return Number(m[1]);
      if (/^title$/i.test(st?.name ?? id)) return 1;
      if (st && st.outline > 0 && st.outline < 10) return st.outline;
      id = st?.based;
    }
    return 0;
  };
  const styleRpr = (styleId: string | undefined): XNode[] => {
    const out: XNode[] = [];
    for (let id = styleId, d = 0; id && d < 6; d++) {
      const st = styleInfo.get(id);
      if (st?.rpr) out.unshift(st.rpr);
      id = st?.based;
    }
    return out;
  };
  const normalStyle = [...styleInfo.entries()].find(([, v]) => v.name.toLowerCase() === "normal")?.[0];

  // numbering: numId -> bullet|number per level
  const numType = new Map<string, Map<number, "bullet" | "number">>();
  if (numbering) {
    const abs = new Map<string, Map<number, "bullet" | "number">>();
    for (const a of kids(numbering, "w:abstractNum")) {
      const lv = new Map<number, "bullet" | "number">();
      for (const l of kids(a, "w:lvl")) lv.set(Number(l.attrs["w:ilvl"]), val(kid(l, "w:numFmt")) === "bullet" ? "bullet" : "number");
      abs.set(a.attrs["w:abstractNumId"], lv);
    }
    for (const n of kids(numbering, "w:num")) {
      const id = val(kid(n, "w:abstractNumId"));
      if (id && abs.has(id)) numType.set(n.attrs["w:numId"], abs.get(id)!);
    }
  }

  const fontNames = new Set<string>();
  const addFont = (n: XNode | undefined) => {
    const f = n && kid(n, "w:rFonts");
    for (const k of ["w:ascii", "w:hAnsi", "w:cs"]) if (f?.attrs[k]) fontNames.add(f.attrs[k]);
  };
  addFont(defaultRpr);
  for (const st of styleInfo.values()) addFont(st.rpr);

  const model: DocxModel = {
    paragraphs: [],
    tables: [],
    stream: [],
    images: 0,
    shapes: 0,
    links: [],
    columns: 1,
    fontNames: [],
    embeddedFonts: 0,
    headerText: "",
    footerText: "",
    pageField: false,
    footnotes: [],
    formFields: { checkbox: 0, text: 0 },
  };

  const fmtOf = (rpr: XNode | undefined, styleId: string | undefined, runStyle: string | undefined): RunFmt => {
    const chain = [defaultRpr, ...(normalStyle ? styleRpr(normalStyle) : []), ...styleRpr(styleId), ...styleRpr(runStyle), rpr].filter(Boolean) as XNode[];
    const f: RunFmt = { b: false, i: false, u: false, s: false, sup: false, sub: false, hl: false, color: "000000", size: 11, font: "" };
    for (const r of chain) {
      for (const c of r.children) {
        switch (c.name) {
          case "w:b": f.b = on(c); break;
          case "w:i": f.i = on(c); break;
          case "w:strike": case "w:dstrike": f.s = on(c); break;
          case "w:u": f.u = !!val(c) && val(c) !== "none"; break;
          case "w:color": if (val(c) && val(c) !== "auto") f.color = val(c)!.toLowerCase(); break;
          case "w:sz": f.size = Number(val(c)) / 2; break;
          case "w:vertAlign": f.sup = val(c) === "superscript"; f.sub = val(c) === "subscript"; break;
          case "w:highlight": f.hl = !!val(c) && val(c) !== "none"; break;
          case "w:shd": f.hl = !!c.attrs["w:fill"] && !["auto", "ffffff"].includes(c.attrs["w:fill"].toLowerCase()); break;
          case "w:rFonts": f.font = c.attrs["w:ascii"] ?? c.attrs["w:hAnsi"] ?? f.font; break;
        }
      }
    }
    if (f.font) fontNames.add(f.font);
    return f;
  };

  let footnoteCounter = 0;
  const processRunContent = (
    run: XNode,
    out: { text: string; runs: Run[] },
    ctx: { styleId?: string; fld: { instr: string; state: "none" | "instr" | "result" }[]; link: { url: string; text: string }[]; inFootnote: boolean; fnNumber: number },
    inner: { textbox: boolean; table: boolean },
  ) => {
    const rpr = kid(run, "w:rPr");
    const fmt = fmtOf(rpr, ctx.styleId, val(rpr && kid(rpr, "w:rStyle")));
    let text = "";
    const handle = (n: XNode) => {
      switch (n.name) {
        case "w:t": text += n.text; break;
        case "w:tab": case "w:br": case "w:cr": text += " "; break;
        case "w:noBreakHyphen": text += "-"; break;
        case "w:footnoteReference": text += String(++footnoteCounter); break;
        case "w:footnoteRef": if (ctx.inFootnote) text += `${ctx.fnNumber} `; break;
        case "w:instrText": {
          const f = ctx.fld[ctx.fld.length - 1];
          if (f && f.state === "instr") f.instr += n.text;
          break;
        }
        case "w:fldChar": {
          const t = n.attrs["w:fldCharType"];
          if (t === "begin") ctx.fld.push({ instr: "", state: "instr" });
          else if (t === "separate") {
            const f = ctx.fld[ctx.fld.length - 1];
            if (f) {
              f.state = "result";
              const h = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/.exec(f.instr);
              if (/HYPERLINK/.test(f.instr)) ctx.link.push({ url: /\\l/.test(f.instr) ? "#" + (h?.[1] ?? "") : (h?.[1] ?? ""), text: "" });
              if (/FORMTEXT/.test(f.instr)) model.formFields.text++;
              if (/FORMCHECKBOX/.test(f.instr)) model.formFields.checkbox++;
              if (/\bPAGE\b/.test(f.instr)) model.pageField = true;
            }
          } else if (t === "end") {
            const f = ctx.fld.pop();
            if (f && /HYPERLINK/.test(f.instr)) {
              const l = ctx.link.pop();
              if (l) model.links.push(l);
            }
            if (f && /FORMTEXT|FORMCHECKBOX/.test(f.instr) && f.state === "instr") {
              if (/FORMTEXT/.test(f.instr)) model.formFields.text++;
              else model.formFields.checkbox++;
            }
          }
          break;
        }
        case "w:ffData": if (kid(n, "w:checkBox")) model.formFields.checkbox++; else if (kid(n, "w:textInput")) model.formFields.text++; break;
        case "w:drawing": case "w:pict": case "mc:AlternateContent": case "w:object": {
          drawing(n);
          return;
        }
        case "w:txbxContent": break;
      }
    };
    const drawing = (n: XNode) => {
      // Skip mc:Fallback so a shape is not counted twice.
      let hasTextbox = false;
      let blips = 0;
      let wsp = 0;
      let vshape = 0;
      const visit = (x: XNode) => {
        if (x.name === "mc:Fallback") return false;
        if (x.name === "w:txbxContent") {
          hasTextbox = true;
          for (const p of kids(x, "w:p")) paragraph(p, { textbox: true, table: inner.table });
          for (const t of kids(x, "w:tbl")) table(t, { textbox: true, table: true });
          return false;
        }
        if (x.name === "a:blip" && (x.attrs["r:embed"] || x.attrs["r:link"])) blips++;
        if (x.name === "wps:wsp") wsp++;
        if (x.name === "v:imagedata") blips++;
        if (/^v:(rect|oval|line|roundrect|polyline|shape)$/.test(x.name)) vshape++;
        return true;
      };
      visit(n);
      walk(n, visit);
      if (blips) {
        for (let k = 0; k < blips; k++) { model.images++; model.stream.push({ t: "image" }); }
      } else if (!hasTextbox && (wsp || vshape)) {
        model.shapes += Math.max(wsp, vshape);
        model.stream.push({ t: "shape" });
      }
    };
    for (const c of run.children) handle(c);
    out.text += text;
    for (const l of ctx.link) l.text += text;
    if (text) out.runs.push({ text, fmt });
  };

  function paragraph(p: XNode, inner: { textbox: boolean; table: boolean }, inFootnote = false, fnNumber = 0): Para {
    const ppr = kid(p, "w:pPr");
    const styleId = val(ppr && kid(ppr, "w:pStyle"));
    const out = { text: "", runs: [] as Run[] };
    const ctx = { styleId, fld: [] as { instr: string; state: "none" | "instr" | "result" }[], link: [] as { url: string; text: string }[], inFootnote, fnNumber };
    const run = (n: XNode) => {
      switch (n.name) {
        case "w:r":
          processRunContent(n, out, ctx, inner);
          break;
        case "w:hyperlink": {
          const rid = n.attrs["r:id"];
          const url = rid ? (rels.get(rid) ?? "") : n.attrs["w:anchor"] ? "#" + n.attrs["w:anchor"] : "";
          const link: Link = { url, text: "" };
          model.links.push(link);
          for (const c of n.children) {
            if (c.name === "w:r") {
              const before = out.text.length;
              processRunContent(c, out, ctx, inner);
              link.text += out.text.slice(before);
            } else run(c);
          }
          break;
        }
        case "w:fldSimple": {
          const instr = n.attrs["w:instr"] ?? "";
          const h = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/.exec(instr);
          if (/\bPAGE\b/.test(instr)) model.pageField = true;
          if (/FORMTEXT/.test(instr)) model.formFields.text++;
          if (/FORMCHECKBOX/.test(instr)) model.formFields.checkbox++;
          const link: Link | null = h ? { url: /\\l/.test(instr) ? "#" + h[1] : h[1], text: "" } : null;
          if (link) model.links.push(link);
          for (const c of n.children) {
            const before = out.text.length;
            run(c);
            if (link) link.text += out.text.slice(before);
          }
          break;
        }
        case "w:sdt": {
          const spr = kid(n, "w:sdtPr");
          if (spr) {
            if (spr.children.some((c) => c.name === "w14:checkbox")) model.formFields.checkbox++;
            else if (spr.children.some((c) => ["w:text", "w:dropDownList", "w:comboBox", "w:date"].includes(c.name))) model.formFields.text++;
          }
          const content = kid(n, "w:sdtContent");
          if (content) for (const c of content.children) run(c);
          break;
        }
        case "w:smartTag": case "w:ins": case "w:moveTo":
          for (const c of n.children) run(c);
          break;
        case "mc:AlternateContent": {
          const ch = kid(n, "mc:Choice");
          if (ch) for (const c of ch.children) run(c);
          break;
        }
      }
    };
    for (const c of p.children) run(c);

    const num = ppr && kid(ppr, "w:numPr");
    const numId = val(num && kid(num, "w:numId"));
    let list: Para["list"] = null;
    if (num && numId && numId !== "0") {
      const lvl = Number(val(kid(num, "w:ilvl")) ?? 0);
      list = { type: numType.get(numId)?.get(lvl) ?? "bullet", level: lvl };
    }
    const text = out.text.replace(/\s+/g, " ").trim();
    const first = text.split(" ")[0] ?? "";
    const para: Para = {
      text,
      runs: out.runs,
      headingLevel: headingLevelOf(styleId, ppr),
      list,
      inTextbox: inner.textbox,
      inTable: inner.table,
      literalMarker: !list && isMarkerToken(first) && text.split(" ").length > 1,
    };
    model.paragraphs.push(para);
    model.stream.push({ t: "text", text: para.text });
    // Section break inside a paragraph
    const sp = ppr && kid(ppr, "w:sectPr");
    if (sp) section(sp);
    return para;
  }

  function section(sp: XNode) {
    const cols = kid(sp, "w:cols");
    const n = cols ? Number(cols.attrs["w:num"] ?? (kids(cols, "w:col").length || 1)) : 1;
    if (n > model.columns) model.columns = n;
  }

  function table(t: XNode, inner: { textbox: boolean; table: boolean }) {
    const rows: (Cell | null)[][] = [];
    const open = new Map<number, Cell>(); // grid col -> origin cell for vMerge
    for (const tr of kids(t, "w:tr")) {
      const row: (Cell | null)[] = [];
      let col = 0;
      for (const tc of kids(tr, "w:tc")) {
        const pr = kid(tc, "w:tcPr");
        const cs = Number(val(pr && kid(pr, "w:gridSpan")) ?? 1);
        const vm = pr && kid(pr, "w:vMerge");
        const fill = (pr && kid(pr, "w:shd"))?.attrs["w:fill"]?.toLowerCase();
        const texts: string[] = [];
        const before = model.paragraphs.length;
        for (const c of tc.children) {
          if (c.name === "w:p") paragraph(c, { ...inner, table: true });
          else if (c.name === "w:tbl") table(c, { ...inner, table: true });
        }
        for (const p of model.paragraphs.slice(before)) texts.push(p.text);
        const cell: Cell = { text: texts.join(" ").replace(/\s+/g, " ").trim(), rs: 1, cs, shaded: !!fill && !["auto", "ffffff"].includes(fill) };
        if (vm && val(vm) !== "restart") {
          const origin = open.get(col);
          if (origin) origin.rs++;
          row.push(null);
        } else {
          row.push(cell);
          if (vm) open.set(col, cell);
          else open.delete(col);
        }
        for (let k = 1; k < cs; k++) row.push(null);
        col += cs;
      }
      rows.push(row);
    }
    model.tables.push({ rows });
  }

  const body = kid(doc, "w:body");
  if (body) {
    for (const c of body.children) {
      if (c.name === "w:p") paragraph(c, { textbox: false, table: false });
      else if (c.name === "w:tbl") table(c, { textbox: false, table: false });
      else if (c.name === "w:sectPr") section(c);
      else if (c.name === "w:sdt") {
        const content = kid(c, "w:sdtContent");
        for (const x of content?.children ?? []) if (x.name === "w:p") paragraph(x, { textbox: false, table: false });
      }
    }
  }

  // Footnotes, headers, footers
  const fnXml = await read("word/footnotes.xml");
  if (fnXml) {
    const fn = parseXml(fnXml);
    let footnoteSeq = 0;
    for (const f of kids(fn, "w:footnote")) {
      const type = f.attrs["w:type"];
      if (type === "separator" || type === "continuationSeparator" || Number(f.attrs["w:id"]) < 1) continue;
      const parts: string[] = [];
      const n = ++footnoteSeq;
      for (const p of kids(f, "w:p")) parts.push(paragraph(p, { textbox: false, table: false }, true, n).text);
      model.footnotes.push(parts.join(" ").trim());
    }
  }
  const partText = async (re: RegExp) => {
    let text = "";
    let hasPage = false;
    for (const path of Object.keys(zip.files).filter((p) => re.test(p)).sort()) {
      const x = parseXml(await read(path));
      const ps: string[] = [];
      walk(x, (n) => {
        if (n.name === "w:p") {
          let s = "";
          walk(n, (m) => { if (m.name === "w:t") s += m.text; if (m.name === "w:tab" || m.name === "w:br") s += " "; if (m.name === "w:instrText" && /\bPAGE\b/.test(m.text)) hasPage = true; if (m.name === "w:fldSimple" && /\bPAGE\b/.test(m.attrs["w:instr"] ?? "")) hasPage = true; });
          ps.push(s);
          return false;
        }
      });
      text += " " + ps.join(" ");
    }
    return { text: text.replace(/\s+/g, " ").trim(), hasPage };
  };
  const hdr = await partText(/^word\/header\d*\.xml$/);
  const ftr = await partText(/^word\/footer\d*\.xml$/);
  model.headerText = hdr.text;
  model.footerText = ftr.text;
  // A PAGE field only counts as a page number when it lives in a header or footer part.
  model.pageField = hdr.hasPage || ftr.hasPage;

  const ftXml = await read("word/fontTable.xml");
  if (ftXml) for (const f of kids(parseXml(ftXml), "w:font")) if (f.attrs["w:name"]) fontNames.add(f.attrs["w:name"]);
  model.fontNames = [...fontNames];
  model.embeddedFonts = Object.keys(zip.files).filter((p) => /^word\/fonts\/.+/.test(p) && !zip.files[p].dir).length;
  return model;
}
