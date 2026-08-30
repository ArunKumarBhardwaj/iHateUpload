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
    default: "Free Online PDF & Image Tools — No Upload | iHateUpload",
    template: "%s | iHateUpload",
  },
  description:
    "Compress image, merge PDF, convert PDF to JPG, HEIC to JPG, and more — free in your browser. No upload, no signup, no watermark.",
  metadataBase: new URL("https://ihateupload.com"),
  openGraph: {
    title: "Free Online PDF & Image Tools — No Upload",
    description:
      "Compress image, merge PDF, convert PDF, HEIC to JPG, and more. Files stay on your device.",
    type: "website",
    url: "https://ihateupload.com",
    siteName: "iHateUpload",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Online PDF & Image Tools — No Upload",
    description:
      "Compress image, merge PDF, convert PDF, HEIC to JPG — no upload.",
  },
  robots: {
    index: true,
    follow: true,
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
