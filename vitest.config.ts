import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const p = (d: string) => fileURLToPath(new URL(d, import.meta.url));
// Wrangler bundles .md files as text (see "rules" in wrangler.jsonc). This does the same for tests.
const markdownAsText = { name: "md-as-text", transform(_code: string, id: string) {
  if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`, map: null };
} };
export default defineConfig({
  plugins: [markdownAsText],
  // Tests that open PGlite with every migration can pass 5 s on a busy CI runner (console tests did, 13 Nov).
  // A beforeEach that opens one is a hook, not a test, and kept vitest's 10 s default: it failed twice on the CI runner once the console suite reached 43 files (LV1, #117).
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
  resolve: { alias: { "@ak/core": p("./packages/core/src"), "@ak/wa": p("./packages/wa/src"), "@ak/agents": p("./packages/agents/src"), "@ak/commerce": p("./packages/commerce/src"), "@ak/search": p("./packages/search/src"), "@ak/ui": p("./packages/ui/src") } },
});
