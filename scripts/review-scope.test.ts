import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// scripts/review-scope.sh decides whether a PR that cannot be reviewed (API down) may still merge.
const scope = (files: string[]) =>
  execFileSync("bash", ["scripts/review-scope.sh", "-"], { input: files.join("\n") })
    .toString()
    .trim();

describe("review-scope", () => {
  it("skips a change made only of docs and evals", () => {
    expect(scope(["docs/decisions/DECISIONS.md", "evals/voice/batch-01/b01-01.opus"])).toBe("skip");
  });
  it("treats schema, functions, seed, deploy list, CI, scripts and build config as sensitive", () => {
    for (const f of [
      "supabase/migrations/20261011090100_menu_baskets_orders.sql",
      "supabase/functions/whatsapp-webhook/index.ts",
      "supabase/functions-deploy.txt",
      "supabase/seed/vendors/source/vendors.csv",
      ".github/workflows/ci.yml",
      ".claude/settings.json",
      "scripts/review-scope.sh",
      "package.json",
      "pnpm-lock.yaml",
      "src/integrations/supabase/client.ts",
      "src/routes/merchant.orders.tsx",
      "src/lib/supabase.ts",
    ])
      expect(scope([f]), f).toBe("sensitive");
  });
  it("a docs change plus one sensitive file is sensitive", () => {
    expect(scope(["docs/x.md", "supabase/tests/90_orders.sql"])).toBe("sensitive");
  });
  it("leaves plain UI and copy changes normal", () => {
    expect(scope(["src/components/landing/Hero.tsx", "README.md", "public/robots.txt"])).toBe(
      "normal",
    );
  });
  it("an empty diff is skip", () => {
    expect(scope([])).toBe("skip");
  });
});
