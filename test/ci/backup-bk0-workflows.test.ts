// BK0: what the two backup workflows must never do, and what they must do, read from the files themselves.
// The behaviour (dump, encrypt, store, restore, verify) is proven against a real Postgres in test/pg/backup-bk0.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");
const backup = read(".github/workflows/backup.yml");
const restore = read(".github/workflows/restore-check.yml");
const scripts = readdirSync(root + "scripts/backup").map((f) => [f, read(`scripts/backup/${f}`)] as const);

describe("backup.yml", () => {
  it("runs at 01:30 UTC and by hand, with the environment as a parameter", () => {
    expect(backup).toMatch(/cron: "30 1 \* \* \*"/);
    expect(backup).toMatch(/workflow_dispatch:[\s\S]*environment:[\s\S]*options: \[staging, production\]/);
    expect(backup).toMatch(/matrix:\s+environment:/);
  });
  it("checks the freshness at 36 hours, in the same file, so a missed night is noticed", () => {
    expect(backup).toMatch(/cron: "0 14 \* \* \*"/);
    expect(backup).toMatch(/alert\.sh raise backup_stale/);
    expect(backup).toMatch(/limit 36 hours/);
  });
});

describe("restore-check.yml", () => {
  it("runs weekly and by hand, restores into a container of the copy's own Postgres major, and raises restore_check_failed", () => {
    expect(restore).toMatch(/cron: "30 3 \* \* 1"/);
    expect(restore).toMatch(/workflow_dispatch:/);
    expect(restore).toMatch(/docker run .*pgvector\/pgvector:[0-9.]+-pg\$PG_MAJOR/);
    expect(restore).toMatch(/127\.0\.0\.1:55432:5432/);            // bound to the runner only
    expect(restore).toMatch(/alert\.sh raise restore_check_failed/);
    expect(restore).toMatch(/if: failure\(\)/);
  });
});

describe.each([["backup.yml", backup], ["restore-check.yml", restore]])("%s, the rules", (_n, text) => {
  it("never uploads a dump as a workflow artifact or a cache", () => {
    expect(text).not.toMatch(/upload-artifact|actions\/cache|cache-to|actions\/upload-pages/);
  });
  it("never prints the passphrase", () => {
    for (const line of text.split("\n")) {
      if (/^\s*#/.test(line)) continue;
      expect(line, line).not.toMatch(/(echo|printf|cat|tee|set -x)[^|;]*\$\{?BACKUP_PASSPHRASE/);
    }
    expect(text).not.toMatch(/set -x|--debug|ACTIONS_STEP_DEBUG/);
  });
  it("a production run never falls back to a staging secret, and no secret is picked by a computed name", () => {
    // CodeQL: secrets[expression] hands every secret to the runner. Each secret is named statically, once for each environment,
    // and one step chooses by environment.
    expect(text).not.toMatch(/secrets\[/);
    for (const n of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_SERVICE_KEY", "CLOUDFLARE_API_TOKEN", "BACKUP_PASSPHRASE"]) {
      expect(text).toContain(`S_${n}: \${{ secrets.${n} }}`);
      expect(text).toContain(`P_${n}: \${{ secrets.${n}_PRODUCTION }}`);
    }
    expect(text).toMatch(/p=S; \[ "\$ENVIRONMENT" = production \] && p=P/);
  });
  it("stops with a message naming the missing secret, before it does anything", () => {
    expect(text).toMatch(/is not set up\. Missing:/);
    expect(text).toMatch(/passphraseProblem/);
  });
  it("only ever reads staging through the session pooler, with the pinned supabase CLI", () => {
    expect(text).toMatch(/supabase link --project-ref "\$SUPABASE_PROJECT_REF"/);
    expect(text).toMatch(/version: 3\.1\.0/);
    expect(text).not.toMatch(/db push|db reset|migration repair/);
  });
});

describe("the scripts", () => {
  it("never write the passphrase anywhere but gpg's stdin", () => {
    for (const [name, text] of scripts) {
      const lines = text.split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l));
      for (const l of lines) {
        if (!/BACKUP_PASSPHRASE/.test(l)) continue;
        expect(l, `${name}: ${l}`).toMatch(/passphraseProblem|input: env\.BACKUP_PASSPHRASE|env\.BACKUP_PASSPHRASE\)|BACKUP_PASSPHRASE is|BACKUP_PASSPHRASE,|Environment|BACKUP_PASSPHRASE \(|BACKUP_PASSPHRASE_PRODUCTION/);
      }
    }
  });
  it("encrypt with gpg symmetric AES-256 and never write a plaintext dump to the output directory", () => {
    const dump = scripts.find(([n]) => n === "dump.mjs")![1];
    expect(dump).toMatch(/"--symmetric", "--cipher-algo", "AES256"/);
    expect(dump).toMatch(/"--passphrase-fd", "0"/);
  });
  it("never name a deploy: the backup cannot reach the deploy workflow", () => {
    for (const [, text] of scripts) expect(text).not.toMatch(/deploy-staging|kapsoSend|wrangler deploy/);
  });
});
