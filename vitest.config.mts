import { defineConfig } from "vitest/config";

// Unit tests only, for pure src/lib logic - deliberately scoped to
// src/**/*.test.ts so this never picks up tests/e2e/**/*.spec.ts, which are
// Playwright specs (different runner, different `test`/`expect`, and they
// hit a real Firestore project) rather than Vitest tests.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
