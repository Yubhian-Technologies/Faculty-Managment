// "Where did the user come from" for list pages that open a detail page. A list
// (filters, search, page...) mirrors its own state into its URL; the detail page
// opened from it carries that URL in `?back=` so its Back button returns to the
// same view instead of an empty, unfiltered list. Each list passes its own path,
// and only that path (or that path plus a query) is honoured - so the param can
// never be used as an open redirect.
//
// `back` (not `from`): several detail pages already read `from`/`to` as dates.
// The HOD Students list predates this file and keeps its own copy of the same
// idea (lib/students/hodListReturn.ts).

export const LIST_BACK_PARAM = "back";

export type ListParamValue = string | number | boolean | null | undefined;
type ParamReader = { get(name: string): string | null };

/** The list URL for some state: only values that differ from their default are written. */
export function buildListUrl(
  listPath: string,
  values: Record<string, ListParamValue>,
  defaults: Record<string, ListParamValue> = {}
): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    if (defaults[key] !== undefined && String(defaults[key]) === String(value)) continue;
    p.set(key, value === true ? "1" : String(value));
  }
  const qs = p.toString();
  return qs ? `${listPath}?${qs}` : listPath;
}

/** A string param, or the fallback when absent. */
export function readListString(params: ParamReader | null | undefined, key: string, fallback: string): string {
  return params?.get(key) || fallback;
}

/** A whole-number param (>= min), or the fallback when absent / malformed / not one of `allowed`. */
export function readListInt(
  params: ParamReader | null | undefined,
  key: string,
  fallback: number,
  opts: { min?: number; allowed?: number[] } = {}
): number {
  const raw = params?.get(key);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  if (n < (opts.min ?? 1)) return fallback;
  if (opts.allowed && !opts.allowed.includes(n)) return fallback;
  return n;
}

/** A param restricted to a known set of values, or the fallback. */
export function readListChoice<T extends string>(
  params: ParamReader | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = params?.get(key);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** The validated `?back=` URL for `listPath`, or null. */
export function safeListBack(raw: string | null | undefined, listPath: string): string | null {
  if (!raw) return null;
  if (!raw.startsWith(listPath)) return null;
  // "<listPath>/<id>", "<listPath>X", protocol-relative and backslash tricks are not the list.
  const next = raw.charAt(listPath.length);
  if (next !== "" && next !== "?") return null;
  if (raw.includes("\\") || raw.startsWith("//")) return null;
  return raw;
}

/** Appends `?back=<listUrl>` to `path` (no-op when there is nothing valid to carry). */
export function withListBack(path: string, listUrl: string | null | undefined, listPath: string): string {
  const safe = safeListBack(listUrl, listPath);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${LIST_BACK_PARAM}=${encodeURIComponent(safe)}`;
}

/** Where Back goes: the list as it was opened from, else the plain list. */
export function resolveListBack(params: ParamReader | null | undefined, listPath: string): string {
  return safeListBack(params?.get(LIST_BACK_PARAM), listPath) ?? listPath;
}
