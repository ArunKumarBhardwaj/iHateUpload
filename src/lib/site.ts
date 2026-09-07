export const SITE_ORIGIN = "https://www.ihateupload.com";

export function siteUrl(path = "/"): string {
  if (path === "" || path === "/") return `${SITE_ORIGIN}/`;
  const next = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${next}`;
}
