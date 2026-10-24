/**
 * Writes the shared document model (the one PDF to Word, PowerPoint and HTML
 * use) as GitHub-flavoured Markdown: # headings, paragraphs with **bold**,
 * *italic*, ~~struck~~ and [links](url), nested - and 1. lists, pipe tables
 * and ![](picture) references. Text that would read as Markdown is escaped.
 */
import type { Block, DocModel, ParagraphBlock, Run, TableBlock } from "@/lib/pdf-to-word/model";

export type MarkdownEnv = {
  /** The path for a picture, or null to leave it out. */
  img: (ref: string) => string | null;
};

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Backslash-escapes the characters Markdown would read as formatting anywhere in a line. */
export function escapeText(text: string): string {
  return text.replace(CTRL, "").replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

/** Escapes what would start a heading, quote, list or rule at the start of a line. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)(#{1,6})(?=\s)/, "$1\\$2")
    .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, "$1$2\\$3")
    .replace(/^(\s*)(=+|-{3,})\s*$/, "$1\\$2");
}

function safeUrl(url: string): string | undefined {
  const clean = url.trim();
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(clean)) return undefined;
  return clean.replace(/[()\s<>]/g, (c) => encodeURIComponent(c));
}

type Style = { bold: boolean; italic: boolean; strike: boolean; url?: string };

const styleOf = (run: Run, noBold: boolean): Style => ({
  bold: !!run.bold && !noBold,
  italic: !!run.italic,
  strike: !!run.strike,
  url: run.link && "url" in run.link ? safeUrl(run.link.url) : undefined,
});

const same = (a: Style, b: Style) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.url === b.url;

function wrap(text: string, style: Style): string {
  if (!text.trim()) return text;
  // Markers must touch the words, so spaces move outside them.
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  let core = text.slice(lead.length, text.length - trail.length);
  if (style.strike) core = `~~${core}~~`;
  if (style.italic) core = `*${core}*`;
  if (style.bold) core = `**${core}**`;
  return lead + core + trail;
}

/** One paragraph's runs as inline Markdown, on one line. */
export function inline(runs: Run[], { noBold = false } = {}): string {
  const groups: { style: Style; text: string }[] = [];
  for (const run of runs) {
    if (run.field) continue;
    const text = run.tab ? " " : run.text.replace(/\s*\n\s*/g, " ");
    if (!text) continue;
    const style = styleOf(run, noBold);
    const last = groups[groups.length - 1];
    if (last && same(last.style, style)) last.text += text;
    else groups.push({ style, text });
  }
  // Link groups are written as one link even when their inner style changes.
  let out = "";
  for (let i = 0; i < groups.length; i++) {
    const { style } = groups[i];
    if (style.url) {
      let label = "";
      let j = i;
      while (j < groups.length && groups[j].style.url === style.url) {
        label += wrap(escapeText(groups[j].text), { ...groups[j].style, url: undefined });
        j++;
      }
      const lead = label.match(/^\s*/)![0];
      const trail = label.match(/\s*$/)![0];
      out += `${lead}[${label.trim()}](${style.url})${trail}`;
      i = j - 1;
    } else {
      out += wrap(escapeText(groups[i].text), style);
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}

function tableMarkdown(table: TableBlock): string {
  const cols = Math.max(table.colWidths.length, ...table.rows.map((r) => r.reduce((n, c) => n + (c.colSpan || 1), 0)), 1);
  // The header row is shown bold already.
  const cellText = (paragraphs: ParagraphBlock[], header: boolean) =>
    paragraphs
      .map((p) => inline(p.runs, { noBold: header }))
      .filter(Boolean)
      .join("<br>")
      .replace(/\|/g, "\\|");
  const lines = table.rows.map((row, r) => {
    const cells: string[] = [];
    for (const cell of row) {
      cells.push(cell.vMerge === "continue" ? "" : cellText(cell.paragraphs, r === 0));
      for (let k = 1; k < (cell.colSpan || 1); k++) cells.push("");
    }
    while (cells.length < cols) cells.push("");
    return `| ${cells.slice(0, cols).join(" | ")} |`;
  });
  const rule = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  if (lines.length === 0) return "";
  return [lines[0], rule, ...lines.slice(1)].join("\n");
}

type OpenList = { level: number; instance: number; indent: number; width: number };

export function writeMarkdown(model: DocModel, env: MarkdownEnv): string {
  const blocks: Block[] = model.sections.flatMap((s) => s.blocks);
  const out: string[] = [];
  const counts = new Map<string, number>();
  let stack: OpenList[] = [];
  let lastWasList = false;

  for (const block of blocks) {
    if (block.type === "p" && block.list) {
      const { list } = block;
      while (stack.length && stack[stack.length - 1].level > list.level) stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.level === list.level && top.instance !== list.instance) {
        stack.pop();
        out.push("");
      }
      const parent = stack.filter((s) => s.level < list.level).at(-1);
      const indent = parent ? parent.indent + parent.width : 0;
      const key = `${list.instance}:${list.level}`;
      const seen = counts.get(key) ?? 0;
      counts.set(key, seen + 1);
      const marker = list.kind === "bullet" ? "-" : `${list.start + seen}${list.suffix === ")" ? ")" : "."}`;
      if (!stack.length || stack[stack.length - 1].level < list.level || stack[stack.length - 1].instance !== list.instance) {
        if (!lastWasList && out.length) out.push("");
        stack.push({ level: list.level, instance: list.instance, indent, width: marker.length + 1 });
      }
      out.push(`${" ".repeat(indent)}${marker} ${inline(block.runs)}`);
      lastWasList = true;
      continue;
    }
    if (lastWasList) out.push("");
    stack = [];
    lastWasList = false;
    if (block.type === "p") {
      const text = inline(block.runs, { noBold: !!block.style });
      if (!text) continue;
      out.push(block.style ? `${"#".repeat(Number(block.style.slice(-1)))} ${text}` : escapeLineStart(text), "");
    } else if (block.type === "image") {
      const src = env.img(block.ref);
      if (src) out.push(`![](${src})`, "");
    } else {
      const table = tableMarkdown(block);
      if (table) out.push(table, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
