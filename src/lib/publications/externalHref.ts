/**
 * A stored link, made safe to put in an `href`.
 *
 * A value with no scheme is NOT an external address to a browser - it is a path
 * relative to the page the link sits on. "ds", typed into "Provide link of the
 * Book", became href="ds" on /panel/profile/<section> and navigated to
 * /panel/profile/ds, which the app answered with "Unknown section." The link
 * never left the site.
 *
 * So: an http(s) address is used as it is; something that looks like a bare
 * host ("doi.org/10.1007/...", "www.springer.com") gets https:// put in front
 * of it, which is what the person meant; anything else is not a link at all and
 * returns null, for the caller to render as plain text rather than as something
 * that navigates somewhere wrong.
 */
export function externalHref(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  // A bare host needs a dot and a label on each side of it, and no whitespace
  // anywhere. "doi.org/10.x" qualifies; "ds", "2RC" and "my book" do not.
  if (/\s/.test(value)) return null;
  const host = value.split(/[/?#]/, 1)[0];
  if (!/^[^.]+\.[^.]+/.test(host) || host.endsWith(".")) return null;
  return `https://${value}`;
}
