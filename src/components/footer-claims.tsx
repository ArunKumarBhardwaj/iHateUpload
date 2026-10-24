"use client";

import { CloudOff, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";

/** The footer's privacy claims, which are false for the one tool that talks to Gemini. */
export function FooterClaims() {
  const path = usePathname();
  const onAsk = path === "/tools/ask-pdf" || path === "/tools/translate-pdf";
  return (
    <>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {onAsk
          ? "On this page your PDFs stay in your browser, but their extracted text goes to Google Gemini."
          : "PDF and image tools that run in your browser. Your files never leave your device."}
      </p>
      <ul className="mt-5 space-y-2 text-sm text-ink">
        <li className="flex items-center gap-2">
          <CloudOff className="size-4 text-lagoon" aria-hidden />
          {onAsk ? "Only text is sent, never the file" : "Nothing is uploaded"}
        </li>
        {onAsk ? null : (
          <li className="flex items-center gap-2">
            <WifiOff className="size-4 text-lagoon" aria-hidden />
            Works offline once loaded
          </li>
        )}
      </ul>
    </>
  );
}
