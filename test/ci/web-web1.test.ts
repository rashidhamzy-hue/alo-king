// Session WEB1: what the deploy and the Worker may and may not do, checked in text and by running the token maker.
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mintToken } from "../../apps/web/scripts/mint-token.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const b64d = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
function* files(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "dist" || n === ".astro" || n === ".wrangler" || n.startsWith(".dev")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p); else yield p;
  }
}

describe("the Worker's token", () => {
  it("is an HS256 JWT with role web_channel, signed with the project's secret, valid for two years", () => {
    const now = 1_800_000_000;
    const jwt = mintToken({ secret: "s3cret", ref: "proj", now });
    const [h, b, sig] = jwt.split(".") as [string, string, string];
    expect(b64d(h)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(b64d(b)).toEqual({ iss: "supabase", ref: "proj", role: "web_channel", iat: now, exp: now + 730 * 86400 });
    expect(sig).toBe(createHmac("sha256", "s3cret").update(`${h}.${b}`).digest("base64url"));
    expect(mintToken({ secret: "other", ref: "proj", now })).not.toBe(jwt);
  });
  it("is never a service-role token, and refuses to be made without a secret", () => {
    expect(b64d(mintToken({ secret: "x", ref: "p" }).split(".")[1]!).role).toBe("web_channel");
    expect(() => mintToken({ secret: "", ref: "p" })).toThrow();
  });
});

describe("the website's deploy and code", () => {
  const wf = read(".github/workflows/web.yml");
  it("web.yml runs only on this repository's own pushes to main (through deploy-staging) or by hand, never for a pull request or a fork", () => {
    const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch");
    expect(on).toContain("workflows: [deploy-staging]");
    expect(on).toContain("branches: [main]");
    expect(on).not.toMatch(/pull_request/);
    expect(wf).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    // deploy-staging's own run has event workflow_run (it is started by ci), so that is the event to require; 'push' would skip every run
    expect(wf).toContain("github.event.workflow_run.event == 'workflow_run'");
    expect(wf).not.toContain("github.event.workflow_run.event == 'push'");
    expect(wf).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(wf).toMatch(/permissions: \{ contents: read \}/);
  });
  it("the workflow never reads the service key and never dispatches deploy-staging", () => {
    expect(wf).not.toMatch(/SUPABASE_SERVICE_KEY|service_role/);
    expect(wf).not.toMatch(/gh workflow run|workflow_dispatch.*deploy-staging|actions_run_trigger/);
  });
  it("nothing in apps/web holds or names the service key; the Worker reads only as web_channel", () => {
    for (const f of files(join(root, "apps/web"))) {
      if (!/\.(ts|astro|mjs|js|json|jsonc|sh|css)$/.test(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/SERVICE_KEY|service_role|SUPABASE_SERVICE/i);
    }
    expect(read("apps/web/src/lib/db.ts")).toContain("WEB_CHANNEL_JWT");
  });
  it("the Worker imports no staff or ordering code: the commerce client and its own files only", () => {
    for (const f of files(join(root, "apps/web/src"))) {
      if (!/\.(ts|astro)$/.test(f)) continue;
      const imports = [...readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const i of imports) expect(i, `${f}: ${i}`).not.toMatch(/@ak\/(agents|wa|core)|apps\/(gateway|console)|supabase-js/);
    }
  });
  it("no page calls a function web_channel does not have, and the catalog pages call only the four catalog ones", () => {
    const src = [...files(join(root, "apps/web/src"))].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/["'`](confirm_order\w*|web_confirm_order|claim_link_code|transition_order|plan_cart|quote_order|handle_order_button|checkout_\w+|cart_\w+)["'`]/);
  });
});
