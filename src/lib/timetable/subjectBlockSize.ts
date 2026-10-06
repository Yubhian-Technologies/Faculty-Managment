// Per-subject continuous-slot overrides (Principal settings). Keyed by the
// subject's code (name when it has no code), upper-cased with everything but
// letters/digits stripped, so the same subject matches across semester copies
// and is a safe Firestore map key.
export function subjectBlockKey(s: { code?: string; name?: string }): string {
  return (s.code || s.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sanitizeSubjectBlockSizes(
  input: unknown,
): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "subjectBlockSizes must be an object" };
  }
  const value: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = subjectBlockKey({ code: k });
    const n = Number(v);
    if (!key || !Number.isInteger(n) || n < 1 || n > 10) {
      return { ok: false, error: `subjectBlockSizes["${k}"] must be an integer between 1 and 10` };
    }
    value[key] = n;
  }
  return { ok: true, value };
}
