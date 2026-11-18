#!/usr/bin/env node
// DOC2 (docs/DECISIONS.md, "Founder decisions, 18 November 2026", 7): two rules for every file the repository tracks, run in ci.yml (job
// secrets-and-dependencies, always in full).
//   1. No file over 300 KB. The files that were already over it when the rule began are in scripts/ci/size-allow.json, each with the reason and a
//      ceiling that is its size that day: such a file may shrink, never grow, and a new file is never added to the list without a reader.
//   2. No image under docs/ (png, jpg, webp, gif, svg, avif, ico and the like). Screenshots go to the private `screens` bucket
//      (scripts/screens, .github/workflows/screens.yml). `imagesAllowed` in the same file lists the icons and fonts the site serves, if any
//      were ever kept under docs/ (none are: the site's icons are under apps/web/public and packages/ui).
// Findings are file, size and rule only. Exit 1 on any finding.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_BYTES = 300 * 1024;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMAGE = /\.(png|jpe?g|webp|gif|svg|avif|ico|bmp|tiff?|heic|heif)$/i;

/** @param {{ path: string, size: number }[]} files  @param {{ sizeCeilings?: Record<string, { max: number, why: string }>, imagesAllowed?: string[] }} allow */
export function findings(files, allow = {}) {
  const out = [];
  const ceilings = allow.sizeCeilings ?? {};
  const okImages = new Set(allow.imagesAllowed ?? []);
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      const c = ceilings[f.path];
      if (!c) out.push(`${f.path}: ${Math.round(f.size / 1024)} KB is over the 300 KB limit (rule 1)`);
      else if (f.size > c.max) out.push(`${f.path}: ${f.size} bytes is over its ceiling of ${c.max} (rule 1: a listed file may shrink, never grow)`);
    }
    if (f.path.startsWith("docs/") && IMAGE.test(f.path) && !okImages.has(f.path)) out.push(`${f.path}: an image under docs/ (rule 2: screenshots go to the screens bucket, see scripts/screens)`);
  }
  // A ceiling for a file that is gone or now under the limit is stale: the list must say what is true.
  const bySize = new Map(files.map((f) => [f.path, f.size]));
  for (const [p, c] of Object.entries(ceilings)) {
    if (!c.why || c.why.length < 10) out.push(`scripts/ci/size-allow.json: ${p} has no reason`);
    const s = bySize.get(p);
    if (s === undefined) out.push(`scripts/ci/size-allow.json: ${p} is not a tracked file (remove its line)`);
    else if (s <= MAX_BYTES) out.push(`scripts/ci/size-allow.json: ${p} is now ${s} bytes, under the limit (remove its line)`);
  }
  return out;
}

export function trackedFiles(root = ROOT) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean)
    .flatMap((path) => { try { const st = statSync(join(root, path)); return st.isFile() ? [{ path, size: st.size }] : []; } catch { return []; } });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const allow = JSON.parse(readFileSync(join(ROOT, "scripts/ci/size-allow.json"), "utf8"));
  const files = trackedFiles();
  const bad = findings(files, allow);
  for (const b of bad) console.error(`::error::${b}`);
  console.log(`${files.length} tracked files checked: ${bad.length ? bad.length + " finding(s)" : "none over 300 KB (except the listed ones), no image under docs/"}`);
  if (bad.length) process.exit(1);
}
