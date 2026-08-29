import type { Metadata } from "next";
import { Manrope, Syne } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "iHateUpload — Free tools that refuse the upload.",
    template: "%s | iHateUpload",
  },
  description:
    "Merge, compress, protect, and organize PDFs, convert HEIC or WebP, and build image PDFs with zero cloud hops. No account. No watermark. Cut wifi mid-job and it still finishes.",
  metadataBase: new URL("https://ihateupload.com"),
  openGraph: {
    title: "iHateUpload",
    description:
      "Upload-free PDF and image tools. Merge, compress, protect, organize, HEIC to JPG, and more — all inside your tab.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${display.variable} ${body.variable} h-full`}
    >
      <body className="relative flex min-h-full flex-col">
        <div className="noise absolute inset-0 z-0" aria-hidden />
        <SiteHeader />
        <main className="relative z-10 flex-1">{children}</main>
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
