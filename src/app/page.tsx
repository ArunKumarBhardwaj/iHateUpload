import type { Metadata } from "next";

import { HomePage } from "@/components/home/home-page";
import { TOOL_GROUPS } from "@/lib/tool-groups";
import { TOOLS } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free Online PDF & Image Tools — No Upload",
  description:
    "Compress image, merge PDF, convert PDF to JPG, HEIC to JPG, and more — free in your browser. No upload, no signup, no watermark.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Free Online PDF & Image Tools — No Upload",
    description:
      "Compress image, merge PDF, convert PDF, HEIC to JPG, and more. Files stay on your device.",
    url: "/",
    type: "website",
  },
};

const GROUPS = TOOL_GROUPS.map((group) => ({
  id: group.id,
  title: group.title,
  tools: group.tools
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined),
}));

export default function Home() {
  return <HomePage groups={GROUPS} toolCount={TOOLS.length} />;
}
