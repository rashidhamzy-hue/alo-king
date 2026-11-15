#!/usr/bin/env node
// Run by `npm install` (package.json "prepare"): points this clone at the repository's hooks (.githooks), so the personal-data check runs
// before every commit. Never fails an install: outside a git checkout (a tarball, a CI cache) it does nothing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status === 0) {
  const root = top.stdout.trim();
  if (existsSync(join(root, ".githooks/pre-commit"))) {
    const r = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root });
    if (r.status === 0) console.log("git hooks: core.hooksPath = .githooks (the personal-data check runs before every commit)");
  }
}
