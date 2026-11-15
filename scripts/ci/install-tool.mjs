#!/usr/bin/env node
// Installs one of the pinned security tools (scripts/ci/tools.json): gitleaks or osv-scanner.
//   node scripts/ci/install-tool.mjs gitleaks [--dir <dir>]
// The version is exact, and the download is checked against the SHA-256 recorded in tools.json BEFORE it is unpacked or run. A file whose
// hash differs is deleted and the install fails: nothing downloaded is ever executed unchecked. Default directory: .tools/bin (git-ignored).
// Under GitHub Actions the directory is also added to PATH for the steps that follow.
//
// To move to a new version (a deliberate, reviewed change): download the release's published checksums file, check the binary you fetched
// matches it, and put the new URL and SHA-256 in tools.json. test/ci/pinned-tools.test.ts holds the shape.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOOLS = JSON.parse(readFileSync(join(HERE, "tools.json"), "utf8"));

// The file for a platform. Node says x64; osv-scanner says amd64.
export function pickFile(name, platform = process.platform, arch = process.arch) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool ${name}`);
  const keys = [`${platform}_${arch}`, ...(arch === "x64" ? [`${platform}_amd64`] : [])];
  const key = keys.find((k) => tool.files[k]);
  if (!key) throw new Error(`no pinned ${name} ${tool.version} build for ${platform}/${arch}`);
  return tool.files[key];
}

export function verifySha256(bytes, expected, label) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${label}: expected ${expected}, got ${actual}. Nothing was installed.`);
}

export function install(name, dir) {
  const tool = TOOLS[name];
  const file = pickFile(name);
  const bin = join(dir, tool.binary);
  if (existsSync(bin)) {
    const v = spawnSync(bin, [name === "gitleaks" ? "version" : "--version"], { encoding: "utf8" });
    if (v.status === 0 && `${v.stdout}${v.stderr}`.includes(tool.version)) return bin;       // already the pinned version
  }
  const work = mkdtempSync(join(tmpdir(), "install-tool-"));
  try {
    const dl = join(work, "download");
    const r = spawnSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", "-o", dl, file.url], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`download failed: ${file.url}`);
    verifySha256(readFileSync(dl), file.sha256, `${name} ${tool.version}`);
    mkdirSync(dir, { recursive: true });
    if (tool.archive === "tar.gz") {
      const t = spawnSync("tar", ["-xzf", dl, "-C", work, tool.binary], { stdio: ["ignore", "inherit", "inherit"] });
      if (t.status !== 0) throw new Error("could not unpack the archive");
      copyFileSync(join(work, tool.binary), bin);
    } else copyFileSync(dl, bin);
    chmodSync(bin, 0o755);
    return bin;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, ...rest] = process.argv.slice(2);
  const at = rest.indexOf("--dir");
  const dir = resolve(at >= 0 ? rest[at + 1] : join(HERE, "..", "..", ".tools", "bin"));
  try {
    const bin = install(name, dir);
    console.log(`${name} ${TOOLS[name].version} (SHA-256 verified) at ${bin}`);
    if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
  } catch (e) { console.error(`install-tool: ${e.message}`); process.exitCode = 1; }
}
