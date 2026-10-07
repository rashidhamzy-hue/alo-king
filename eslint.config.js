import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".nitro",
      ".tanstack",
      ".wrangler",
      "src/routeTree.gen.ts",
      ".agents",
      ".claude/skills",
      "public",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Legacy code (pre-rebuild) uses `any` widely; new modules should not. Tighten in Phase 1.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  eslintPluginPrettier,
  {
    // Legacy edge functions: their wiring tests match source text, so reformatting breaks them.
    // They are split and rewritten in Phases 1-3; new modules there are formatted normally.
    files: [
      "supabase/functions/kapso-brain/**",
      "supabase/functions/_shared/**",
      "supabase/functions/claim-vendor/**",
      "supabase/functions/merchant-ai/**",
      "supabase/functions/order-notify/**",
      "supabase/functions/demo-chat/**",
    ],
    rules: {
      "prettier/prettier": "off",
      "no-control-regex": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "prefer-const": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);
