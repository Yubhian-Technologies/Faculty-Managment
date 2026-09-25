// Small helper for E2E specs that need a specific set of environment
// variables (test account credentials, seeded ids/department names) to run
// against a real, seeded Firebase project - see tests/e2e/README.md for the
// full list and how to seed them. Every consumer calls this with exactly the
// vars IT needs and skips itself (via `test.skip`) when they're absent, so a
// partially-seeded environment still runs whichever tests it CAN, instead of
// the whole file skipping because of one missing var.
export function readEnv<K extends string>(names: readonly K[]): Record<K, string> | null {
  const out = {} as Record<K, string>;
  for (const name of names) {
    const value = process.env[name];
    if (!value) return null;
    out[name] = value;
  }
  return out;
}
