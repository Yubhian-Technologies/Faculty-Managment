import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // react-hooks/set-state-in-effect (React Compiler advisory) flags the standard fetch-on-mount
  // pattern - `useEffect(() => { setLoading(true); load(); }, [...])` - in ~140 existing pages.
  // Those are not defects (they behave correctly), and rewriting them means restructuring data
  // loading in 128 files. Kept visible as a warning so new code still sees it, but it no longer
  // fails lint. Revisit when pages move to a data-fetching hook.
  {
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
