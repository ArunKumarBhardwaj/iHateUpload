import { expect, test } from "bun:test";

import { OLD_GROUP_IDS, TOOL_GROUPS } from "./tool-groups";
import { TOOLS } from "./tools";

test("every tool sits in exactly one group", () => {
  const grouped = TOOL_GROUPS.flatMap((group) => group.tools);
  expect(new Set(grouped).size).toBe(grouped.length);
  expect([...grouped].sort()).toEqual(TOOLS.map((tool) => tool.id).sort());
});

test("old category links point at groups that exist", () => {
  const ids = new Set(TOOL_GROUPS.map((group) => group.id));
  for (const target of Object.values(OLD_GROUP_IDS)) {
    expect(ids.has(target)).toBe(true);
  }
});
