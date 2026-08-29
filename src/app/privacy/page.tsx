import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "iHateUpload processes files in your browser. We do not receive your uploads.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink">
        Privacy
      </h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground">
        <p>
          iHateUpload is built so your files never need to reach our servers.
          Conversion, compression, and PDF creation run in your browser with
          JavaScript and Web APIs.
        </p>
        <p>
          We do not operate an upload API for these tools. We do not store your
          documents. When you close the tab, the processed blobs in memory are
          gone.
        </p>
        <p>
          The website itself may collect standard hosting analytics (page views,
          approximate region, user agent) from the CDN or host. That is separate
          from file processing.
        </p>
        <p>
          If ads are added later, ad networks may set cookies according to their
          own policies. Core tools will still process files locally.
        </p>
      </div>
    </div>
  );
}
