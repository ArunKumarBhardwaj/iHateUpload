/**
 * Shares are answered by the service worker on the device and never get here.
 * This runs only when it was not ready yet (the app's very first launch, or
 * site data cleared): the request is turned away unread and nothing is kept.
 */
export function POST() {
  return new Response(null, { status: 303, headers: { Location: "/share?offline=1", "Cache-Control": "no-store" } });
}

export function GET() {
  return new Response(null, { status: 303, headers: { Location: "/share" } });
}
