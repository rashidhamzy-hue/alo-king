# Third-party skills (build plan 0.10)

Builder tools for Claude Code sessions. Markdown only, no scripts; read before adding any. Copied unchanged, pinned to a commit.
They guide how to write migrations and Workers code. They never override `CLAUDE.md`: where a skill and an invariant disagree, the invariant wins.

| Skills | Source | Commit | Licence |
| --- | --- | --- | --- |
| `supabase`, `supabase-postgres-best-practices` | https://github.com/supabase/agent-skills | c9be0e931b7930f7d02126d04774d904c381e7d7 | MIT (`_licenses/supabase-agent-skills.MIT`) |
| `wrangler`, `workers-best-practices`, `durable-objects`, `workers-development` | https://github.com/cloudflare/skills | cbf893b954222276bf1af57e5f23379231e0efb9 | Apache-2.0 (`_licenses/cloudflare-skills.Apache-2.0`) |

Not installed: the rest of cloudflare/skills (sandbox, Next.js, email, Turnstile and others: not used by this project) and the
Kapso plugin (`gokapso/agent-plugins`): see `docs/TOOLS.md`.

To update: clone the source at a newer commit, diff the skill folders, read the diff, copy, and change the commit above.
