import { expect, test } from "bun:test";

import { TOOL_GROUPS } from "./tool-groups";
import { TOOLS } from "./tools";

test("every tool sits in exactly one group", () => {
  const grouped = TOOL_GROUPS.flatMap((group) => group.tools);
  expect(new Set(grouped).size).toBe(grouped.length);
  expect([...grouped].sort()).toEqual(TOOLS.map((tool) => tool.id).sort());
});
