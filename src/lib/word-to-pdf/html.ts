/** A tiny HTML parser for mammoth's output (well-formed, machine generated). Works without a DOM. */

export type HNode =
  | { tag: string; attrs: Record<string, string>; children: HNode[] }
  | { text: string };

const VOID = new Set(["br", "img", "hr", "meta", "input"]);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseHtml(html: string): HNode[] {
  const root: { tag: string; attrs: Record<string, string>; children: HNode[] } = {
    tag: "#root",
    attrs: {},
    children: [],
  };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string) => {
    if (raw) top().children.push({ text: decodeEntities(raw) });
  };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      // pop to the matching open element (tolerate sloppy nesting)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const tag = m[2].toLowerCase();
    const node = { tag, attrs: parseAttrs(m[3] ?? ""), children: [] as HNode[] };
    top().children.push(node);
    const selfClosed = (m[3] ?? "").trimEnd().endsWith("/");
    if (!VOID.has(tag) && !selfClosed) stack.push(node);
  }
  pushText(html.slice(last));
  return root.children;
}
