import type { Metadata } from "next";

import { ShareInbox } from "@/components/share-inbox";

export const metadata: Metadata = {
  title: "Shared files",
  description: "Files shared to iHateUpload from another app. They stay on this device.",
  robots: { index: false, follow: false },
};

export default function SharePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <ShareInbox />
    </div>
  );
}
