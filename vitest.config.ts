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
  resolve: { alias: { "@ak/core": p("./packages/core/src"), "@ak/wa": p("./packages/wa/src"), "@ak/agents": p("./packages/agents/src") } },
});
