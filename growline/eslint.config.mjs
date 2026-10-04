import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /**
     * Agent git worktrees. These are full checkouts of this repo living INSIDE it, so
     * without this line eslint lints every file twice and reports the duplicate as
     * hundreds of errors in files nobody edited — 687 errors and 13,525 warnings, from a
     * clean tree, the first time it happened.
     *
     * `.git/info/exclude` already keeps them out of git; this keeps them out of lint. The
     * two are separate mechanisms and only having one is what made a green tree look
     * broken.
     */
    ".claude/**",
    /**
     * The Cloud Functions build output. `tsc` emits CommonJS here, so every file trips
     * `no-require-imports` — 15 errors from a clean tree the moment anybody runs
     * `npm run build` inside functions/, which is exactly what you do before deploying.
     *
     * Git already ignores it (.gitignore:62); this is the lint half of the same fact. Note
     * the two are separate mechanisms, and having only one is what made both this and the
     * worktree above look like a broken repo.
     */
    "functions/lib/**",
  ]),
]);

export default eslintConfig;
