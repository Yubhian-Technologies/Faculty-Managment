import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only, for pure src/lib logic - deliberately scoped to
// src/**/*.test.ts so this never picks up tests/e2e/**/*.spec.ts, which are
// Playwright specs (different runner, different `test`/`expect`, and they
// hit a real Firestore project) rather than Vitest tests.
export default defineConfig({
  // Mirrors tsconfig's "@/*" -> "src/*" path alias, so a lib module that
  // imports a sibling through it is importable from a test rather than
  // failing to resolve at load.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
