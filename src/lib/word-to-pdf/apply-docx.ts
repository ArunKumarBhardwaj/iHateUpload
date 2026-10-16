/** Merge what the docx says (styles, tables) into the block model mammoth produced. */
import type { DocxInfo, StyleProps } from "./docx-info";
import type { Block, Para, Spacing, TableBlock } from "./model";

function eachPara(blocks: Block[], fn: (p: Para) => void) {
  for (const b of blocks) {
    if (b.kind === "para") fn(b);
    else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) eachPara(c.blocks, fn);
  }
}

/** Tables in the same order docx-info lists them: a table before the tables nested in its cells. */
function tablesOf(blocks: Block[], out: TableBlock[] = []): TableBlock[] {
  for (const b of blocks) {
    if (b.kind !== "table") continue;
    out.push(b);
    for (const r of b.rows) for (const c of r.cells) tablesOf(c.blocks, out);
  }
  return out;
}

export function applyDocxInfo(blocks: Block[], info: DocxInfo): void {
  const { normal, heading, title } = info.styles;
  const styled = Object.keys(normal).length > 0 || Object.keys(heading).length > 0;
  if (styled) {
    eachPara(blocks, (p) => {
      const st: StyleProps = p.title
        ? (title ?? heading[1] ?? normal)
        : p.heading > 0
          ? (heading[p.heading] ?? normal)
          : normal;
      p.docxStyled = true;
      // a heading style that says nothing about weight or size still looks like a heading
      const bare = p.heading > 0 && !st.bold && (!st.size || st.size === normal.size);
      p.base = bare
        ? { family: st.family, color: st.color, bold: true, italic: st.italic }
        : { family: st.family, size: st.size, color: st.color, bold: st.bold, italic: st.italic };
      const direct = p.spacing;
      const merged: Spacing = { ...st.spacing, ...direct };
      // list items sit tight, as Word's List Paragraph (contextual spacing) does
      if (p.marker) {
        merged.before = direct?.before ?? 0;
        merged.after = direct?.after ?? 2;
      }
      p.spacing = Object.keys(merged).length ? merged : undefined;
    });
  }

  const tables = tablesOf(blocks);
  if (tables.length === info.tables.length) {
    tables.forEach((t, i) => {
      const ti = info.tables[i];
      t.info = ti;
      if (ti.fills.length === t.rows.length) {
        t.rows.forEach((row, ri) => {
          const fills = ti.fills[ri];
          if (fills.length === row.cells.length) row.cells.forEach((c, ci) => (c.fill = fills[ci]));
        });
      }
    });
  }
}
