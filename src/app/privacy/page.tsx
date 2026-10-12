import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "iHateUpload refuses the upload. Tools run in your tab with zero cloud hops for your files.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal-ink">
        Company
      </p>
      <h1 className="mt-2 text-4xl font-semibold leading-tight tracking-tight text-ink">
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
          One tool is different. Ask PDF reads the text out of your PDF in this
          tab, then sends that text and your question to Google Gemini through
          our server to get an answer. The PDF file itself is not sent, and we
          do not keep the text. Skip Ask PDF if the words themselves are
          private.
        </p>
      </div>

      <h2
        id="check"
        className="mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight text-ink"
      >
        Check it yourself
      </h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-muted-foreground">
        <li>Open any tool, then open DevTools (F12, or ⌥⌘I on a Mac).</li>
        <li>Go to the Network tab and clear it.</li>
        <li>Drop your file and run the tool.</li>
        <li>
          Watch the list. You will see our own scripts and codecs load. You
          will not see a request carrying your file, and the job still finishes
          with wifi off.
        </li>
      </ol>
      <div className="mt-8 space-y-4 text-base leading-relaxed text-muted-foreground">
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
