# Share target and "Open with" for the installed app

```
bunx next build && bunx next start --port 43127
node internal/benchmarks/share-target/prove.mjs 43127                     # local, served as http://ihu.test:43127
node internal/benchmarks/share-target/prove.mjs https://www.ihateupload.com
```

The app skips its service worker on localhost, so the local run maps `ihu.test` to 127.0.0.1 and marks it secure.
A normal Chrome profile is used, since nothing can be installed from incognito. Synthetic corpus PDFs only.

## Live results, 2026-10-24 (deploy 763bed2): 9 of 9

- Service worker controls the page; Chrome parses the manifest with no errors, with the share target and
  file handlers; the app is installable (no installability errors).
- A share (the multipart POST Android's share sheet makes, two PDFs) is answered by the service worker on the
  device: 303, `fromServiceWorker` true, so the files never reach the network.
- /share lists both files and the tools that fit (Merge PDF, Compress PDF, …); Merge PDF opens with both loaded.
- Opening the same /share link again finds the inbox empty (files are removed as they are taken).
- With no service worker, the server answers `/share-target` with a 303 to `/share?offline=1` and reads nothing.

Not covered: a real Android share sheet and a real desktop "Open with" (launchQueue). Both use the same manifest
entries Chrome parsed here.

After shipping, the manifest moved from cache-first to network-first in the service worker (37b2ae1) so apps
installed earlier pick up the share target.

## Against the rivals

- iLovePDF: receiving files from other apps needs their desktop or mobile app (Premium for the full set of tools).
- ihatepdf.cv: its manifest declares a PDF-only share target posting to "/", but its service worker handles only
  GET requests, so a shared file would be sent to their server. No file handlers. Read 2026-10-24, not tested on a phone.
