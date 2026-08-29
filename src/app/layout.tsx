import type { Metadata } from "next";
import { Manrope, Syne } from "next/font/google";

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
    default: "iHateUpload — Free tools. Files never leave your device.",
    template: "%s | iHateUpload",
  },
  description:
    "Merge and compress PDFs, convert HEIC or WebP, and build image PDFs in your browser. No upload, no signup, no watermark.",
  metadataBase: new URL("https://ihateupload.com"),
  openGraph: {
    title: "iHateUpload",
    description:
      "Free browser tools that hate uploading your files. PDF merge and compress, HEIC to JPG, image to PDF, and more.",
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
      </body>
    </html>
  );
}
