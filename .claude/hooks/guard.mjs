#!/usr/bin/env node
// PreToolUse guard for build sessions (DECISIONS §9 guardrails, §10, §25 hard stops).
// Reads the hook payload on stdin; exit code 2 blocks the call and shows the reason to Claude.
// Blocks: Kabsi resources, any Supabase project but alo-king-staging, Vercel projects other than
// alo-king, spending money, pushes to rebuild/lebanon or main, history rewrites, destructive
// commands, and secrets written into files.

export const STAGING_REF = "tzugbbatfbvrfzxuacqx";
export const KABSI_REF = "ynjdqjlmdwjgbfezevxy";
export const OLD_REF = "hnjkietmwvkgbyrcnweq";
export const VERCEL_PROJECTS = ["alo-king", "prj_9CfRC301YWeR3IFHgWla2cRILYyO"];

const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsbp_[a-f0-9]{30,}/, "Supabase access token"],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, "Supabase secret key"],
  [/\bsntrys_[A-Za-z0-9+/=_-]{40,}/, "Sentry auth token"],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, "OpenAI API key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [
    /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/,
    "Supabase service_role JWT",
  ],
];

// A command that can reach a service: one of these tools in command position.
const NETWORK_CLI =
  /(^|[;&|(`]|\$\()\s*(sudo\s+)?(curl|wget|supabase|psql|vercel|sentry-cli|gh|http|deno\s+run|node\s+\S*kapso\S*)(\s|$)/m;

export function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "<<HEREDOC");
}
const PROTECTED_BRANCHES = ["main", "rebuild/lebanon"];

/** Returns a reason string when the call must be blocked, otherwise null. */
export function check(input) {
  const tool = String(input?.tool_name ?? "");
  const args = input?.tool_input ?? {};
  // Heredoc bodies are file content, not commands: they are checked for secrets only.
  const command = tool === "Bash" ? stripHeredocs(String(args.command ?? "")) : "";
  const text = tool === "Bash" ? command : JSON.stringify(args);

  // Kabsi is a separate business: never touched. File edits may mention it (docs and these rules do);
  // calls that reach a service may not.
  const reachesService =
    /^mcp__(Supabase|Vercel|Sentry|Kabso)__/.test(tool) ||
    (tool === "Bash" && NETWORK_CLI.test(command));
  if (
    reachesService &&
    (text.includes(KABSI_REF) || /\bkabsi([-_.]?(prod|co)\b|-[a-z])/i.test(text))
  )
    return "Kabsi resources are off limits (CLAUDE.md, DECISIONS §9).";
  if (reachesService && text.includes(OLD_REF))
    return `The old project ${OLD_REF} is deleted; never call it.`;

  if (tool === "Bash") return checkSecrets([String(args.command ?? "")]) ?? checkBash(command);
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit")
    return checkSecrets([
      args.content,
      args.new_string,
      args.new_source,
      ...(args.edits ?? []).map((e) => e?.new_string),
    ]);

  if (tool.startsWith("mcp__Kabso__"))
    return "The Kapso connector is linked to Kabsi.co; reach Alo King's Kapso project with KAPSO_API_KEY at https://api.kapso.ai.";

  if (tool.startsWith("mcp__Supabase__")) {
    const name = tool.slice("mcp__Supabase__".length);
    if (
      [
        "create_project",
        "pause_project",
        "restore_project",
        "create_branch",
        "merge_branch",
        "reset_branch",
        "delete_branch",
        "rebase_branch",
      ].includes(name)
    )
      return `Supabase ${name} is not allowed from build sessions (only alo-king-staging, and no spending).`;
    const ref = args.project_id ?? args.project_ref ?? args.ref;
    if (ref !== undefined && ref !== STAGING_REF)
      return `Supabase calls may target only ${STAGING_REF} (alo-king-staging).`;
    if (
      name === "execute_sql" &&
      /\b(drop\s+(table|schema|database)|truncate)\b/i.test(String(args.query ?? ""))
    )
      return "Destructive SQL goes through a migration with a rollback file, never execute_sql.";
    return null;
  }

  if (tool.startsWith("mcp__Vercel__")) {
    const name = tool.slice("mcp__Vercel__".length);
    if (/^(buy_|create_or_transfer_domain|get_purchase_quote$)/.test(name))
      return "Buying anything is an owner task (DECISIONS §25): open an `owner` issue.";
    if (/^(create_project|pause_project|request_promote|request_rollback|delete)/.test(name))
      return `Vercel ${name} is not allowed from build sessions.`;
    const project = args.idOrName ?? args.projectId ?? args.project;
    if (project !== undefined && !VERCEL_PROJECTS.includes(String(project)))
      return "Vercel calls may target only the alo-king project.";
    return null;
  }

  return null;
}

function checkSecrets(values) {
  for (const v of values) {
    if (typeof v !== "string") continue;
    for (const [re, label] of SECRET_PATTERNS)
      if (re.test(v))
        return `Refusing to write what looks like a ${label}. Secrets live in GitHub/Supabase/Vercel settings only.`;
  }
  return null;
}

function checkBash(cmd) {
  const c = cmd.replace(/\s+/g, " ");
  const secret = checkSecrets([c]);
  if (secret) return secret;

  // Git: no pushes to protected branches, no history rewrites.
  // Only real git invocations count: quoted text (commit messages) is dropped, then each command
  // segment is checked on its own.
  const segments = cmd
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().replace(/^(sudo\s+)?/, ""));
  for (const seg of segments) {
    if (/^git\s+(-C\s+\S+\s+)?push\b/.test(seg)) {
      if (
        /(\s)(-f|--force|--force-with-lease|--mirror|--delete|-d)(\s|=|$)/.test(seg) ||
        /\s\+[\w/.-]+/.test(seg)
      )
        return "Force pushes and remote deletes are not allowed (CLAUDE.md).";
      for (const b of PROTECTED_BRANCHES) {
        const re = new RegExp(`(\\s|:|refs/heads/)${b.replace("/", "\\/")}(\\s|$)`);
        if (re.test(seg))
          return `Never push to ${b}: one branch and one pull request per task (DECISIONS §10).`;
      }
    }
    if (/^git\s+(-C\s+\S+\s+)?(filter-branch|filter-repo)\b/.test(seg))
      return "History rewrites are not allowed.";
  }

  // Destructive shell commands.
  if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|~|\$HOME|\.\.?)(\s|\/?$)/.test(c))
    return "Refusing a recursive delete of / , ~ or the repo root.";
  if (/\bsupabase\s+(db\s+reset|projects\s+(create|delete)|orgs\s+create)\b/.test(c))
    return "That Supabase CLI command is not allowed from build sessions.";
  if (/\bdrop\s+(database|schema\s+public)\b/i.test(c))
    return "Refusing to drop a database or the public schema.";

  // Supabase projects: only staging.
  for (const m of c.matchAll(/\b([a-z]{20})\.(supabase\.co|supabase\.in)/g))
    if (m[1] !== STAGING_REF) return `Supabase calls may target only ${STAGING_REF}.`;
  const refFlag = c.match(/--project-ref[ =]([a-z0-9]+)/);
  if (refFlag && refFlag[1] !== STAGING_REF)
    return `Supabase CLI may target only --project-ref ${STAGING_REF}.`;

  // Production: no Vercel production deploys or promotions from sessions.
  if (/\bvercel\b[^|;&]*(\s--prod\b|\spromote\b|\srollback\b)/.test(c))
    return "Production deploys happen only from main after the pilot gate (DECISIONS §10).";

  // Kapso: only the fixed base URL.
  const kapso = c.match(/https?:\/\/[^\s"']*kapso[^\s"']*/gi) ?? [];
  for (const u of kapso)
    if (!/^https:\/\/api\.kapso\.ai(\/|$)/.test(u) && !/^https:\/\/(docs|app)\.kapso\.ai/.test(u))
      return "Kapso is reached only at https://api.kapso.ai (CLAUDE.md).";

  return null;
}

// CLI entry: `node guard.mjs` as a Claude Code hook.
if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw || "{}");
    } catch {
      process.exit(0);
    }
    const reason = check(input);
    if (reason) {
      process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
