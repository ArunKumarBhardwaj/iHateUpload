import type { Metadata } from "next";
import { Funnel_Display } from "next/font/google";

import { BoldHome } from "./bold-home";
import { TOOL_GROUPS } from "@/lib/tool-groups";
import { TOOLS } from "@/lib/tools";

// Mockup of a bolder homepage, kept off the index until it's approved.
export const metadata: Metadata = {
  title: "Design mockup",
  robots: { index: false, follow: false },
};

const display = Funnel_Display({ subsets: ["latin"], weight: ["500", "600", "700"] });

const GROUPS = TOOL_GROUPS.map((group) => ({
  id: group.id,
  title: group.title,
  tools: group.tools
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined),
}));

export default function BoldPreviewPage() {
  return (
    <BoldHome
      displayClass={display.className}
      groups={GROUPS}
      toolCount={TOOLS.length}
    />
  );
}
