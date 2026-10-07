import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without type declarations
import { check, stripHeredocs } from "./guard.mjs";

const bash = (command: string) => check({ tool_name: "Bash", tool_input: { command } });
const mcp = (tool_name: string, tool_input: Record<string, unknown>) =>
  check({ tool_name, tool_input });
const KABSI = "ynjdqjlmdwjgbfezevxy";
// Fake secrets are assembled at runtime so this file never contains one (the guard and gitleaks scan it).
const FAKE_ANTHROPIC = ["sk", "ant", "api03", "a".repeat(30)].join("-");
const FAKE_SUPABASE_TOKEN = ["sbp", "0123456789abcdef".repeat(3)].join("_");
const FAKE_PEM = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");

describe("guard hook", () => {
  it.each([
    "git push origin rebuild/lebanon",
    "git push origin HEAD:rebuild/lebanon",
    "git push origin main",
    "git push --force origin claude/x",
    "git push -f",
    "git push origin +claude/x",
    "git push origin --delete claude/x",
    "git filter-branch --all",
    "rm -rf /",
    "rm -rf ~",
    "supabase db reset",
    `supabase functions deploy x --project-ref ${KABSI}`,
    "supabase functions deploy x --project-ref abcdefghijabcdefghij",
    "curl https://abcdefghijabcdefghij.supabase.co/rest/v1/x",
    "curl https://hnjkietmwvkgbyrcnweq.supabase.co/functions/v1/x",
    "vercel deploy --prod",
    "curl https://evil.kapso.example/meta",
    `echo ${FAKE_ANTHROPIC} > key.txt`,
    `cat > key.txt <<'EOF'\n${FAKE_SUPABASE_TOKEN}\nEOF`,
  ])("blocks %j", (cmd) => expect(bash(cmd)).toBeTruthy());

  it.each([
    "git push -u origin claude/phase0-guard-hooks",
    "git status && git diff origin/rebuild/lebanon",
    "git merge origin/rebuild/lebanon",
    "pnpm test",
    "rm -rf .output .wrangler",
    'supabase db push --db-url "$DB_URL"',
    "supabase functions deploy kapso-brain --project-ref tzugbbatfbvrfzxuacqx",
    "curl -H 'X-API-Key: $KAPSO_API_KEY' https://api.kapso.ai/platform/v1/whatsapp/phone_numbers",
    "grep -rn kabsi-prod docs",
    'git commit -qm "no pushes to main or rebuild/lebanon, no force" && git push -qu origin claude/x',
    `cat > notes.md <<'EOF'\nnever call kabsi-prod (${KABSI}) with curl or supabase\nEOF`,
  ])("allows %j", (cmd) => expect(bash(cmd)).toBeNull());

  it("strips heredoc bodies only", () => {
    expect(stripHeredocs("cat > a <<'EOF'\nbody\nEOF\necho done")).toBe(
      "cat > a <<HEREDOC\necho done",
    );
  });

  it("Supabase tools only on alo-king-staging", () => {
    const sql = (project_id: string, query = "select 1") =>
      mcp("mcp__Supabase__execute_sql", { project_id, query });
    expect(sql("tzugbbatfbvrfzxuacqx")).toBeNull();
    expect(sql(KABSI)).toBeTruthy();
    expect(mcp("mcp__Supabase__list_tables", { project_id: "abcdefghijabcdefghij" })).toBeTruthy();
    expect(mcp("mcp__Supabase__create_project", { name: "x" })).toBeTruthy();
    expect(sql("tzugbbatfbvrfzxuacqx", "drop table vendors")).toBeTruthy();
  });

  it("Vercel tools only on alo-king, and no purchases", () => {
    expect(mcp("mcp__Vercel__get_project", { idOrName: "alo-king" })).toBeNull();
    expect(mcp("mcp__Vercel__get_project", { idOrName: "kabsi-web" })).toBeTruthy();
    expect(mcp("mcp__Vercel__get_project", { idOrName: "other" })).toBeTruthy();
    expect(mcp("mcp__Vercel__buy_domain", { domain: "aloking.com" })).toBeTruthy();
  });

  it("GitHub text (PR bodies, comments) may name Kabsi", () => {
    expect(
      mcp("mcp__github__create_pull_request", { body: `Blocks kabsi-prod (${KABSI})` }),
    ).toBeNull();
  });

  it("the Kabsi Kapso connector and Kabsi Sentry projects are blocked", () => {
    expect(mcp("mcp__Kabso__whatsapp_numbers", {})).toBeTruthy();
    expect(mcp("mcp__Sentry__search_issues", { projectSlugOrId: "kabsi-functions" })).toBeTruthy();
    expect(mcp("mcp__Sentry__search_issues", { projectSlugOrId: "alo-king-functions" })).toBeNull();
  });

  it("secrets are never written to files; docs may still name Kabsi", () => {
    const write = (content: string) => check({ tool_name: "Write", tool_input: { content } });
    expect(write(`KEY=${FAKE_SUPABASE_TOKEN}`)).toBeTruthy();
    expect(check({ tool_name: "Edit", tool_input: { new_string: FAKE_PEM } })).toBeTruthy();
    expect(write(`Never touch kabsi-prod (${KABSI}).`)).toBeNull();
    expect(write("VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc")).toBeNull();
  });
});
