// "Where did the user come from" for the Principal faculty pages. The Faculty
// Register is a filtered list (department + status); a profile / edit / credentials
// page opened from it carries that list's URL in `?from=` so Back and the
// post-save redirect return to the same filtered list instead of the department's
// own page. Only same-app paths under the Principal faculty tree are honoured, so
// the param can never be used as an open redirect.

export const RETURN_PARAM = "from";
const ALLOWED_PREFIX = "/principal/faculty";

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith(ALLOWED_PREFIX)) return null;
  // "/principal/facultyX" or protocol-relative / backslash tricks are not the tree.
  const next = raw.charAt(ALLOWED_PREFIX.length);
  if (next !== "" && next !== "/" && next !== "?") return null;
  if (raw.includes("\\") || raw.startsWith("//")) return null;
  return raw;
}

/** Appends `?from=<returnTo>` to `path` (no-op when there is nothing to carry). */
export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${RETURN_PARAM}=${encodeURIComponent(safe)}`;
}
