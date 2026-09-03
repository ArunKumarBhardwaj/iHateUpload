import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "iHateUpload refuses the upload. Tools run in your tab with zero cloud hops for your files.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
        Company
      </p>
      <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-ink">
        Privacy
      </h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground">
        <p>
          iHateUpload exists because we hate sending private files to random
          converter sites. Merge, compress, protect, organize, and convert run
          inside this tab with JavaScript and Web APIs.
        </p>
        <p>
          There is no upload API for your documents. We do not store them. Close
          the tab and the in-memory blobs are gone. Cut wifi after the page loads
          and the tools still finish.
        </p>
        <p>
          The site itself may collect normal hosting analytics (page views,
          approximate region, user agent) from the CDN or host, including Vercel
          Analytics after deploy. That is separate from file processing.
        </p>
        <p>
          If ads show up later, those networks may set their own cookies. Core
          tools will still refuse the upload.
        </p>
      </div>
    </div>
  );
}
