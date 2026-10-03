// Kept separate from validate.ts (which pulls in zod) so the page renderer can
// re-check every link at display time without that weight.

/**
 * A link target is either an in-app path ("/hod/faculty") or an http(s) URL.
 * Everything else - javascript:, data:, protocol-relative "//host" - is refused,
 * so a page an admin builds can never carry a script link to the people who
 * open it.
 */
export function isSafeHref(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 2000) return false;
  if (v.startsWith("/")) return !v.startsWith("//") && !v.includes("\\");
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Image sources are http(s) only (no in-app paths, no data: URIs). */
export function isSafeImageUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && value.length <= 2000;
  } catch {
    return false;
  }
}
