/** Output base names for a batch: "scan", "scan-2" when two inputs share a name. */
export function batchBaseNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = name.replace(/\.[^.]+$/, "");
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}
