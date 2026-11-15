#!/usr/bin/env node
// PUB1: nothing personal or secret may enter the public repository.
//
// Fails (exit 1) on, anywhere in the tree:
//   phone     a phone number of 11 to 13 digits that is not in an invented range (scripts/ci/personal-data-allow.json)
//   pin       a latitude and longitude pair inside Lebanon with more than three decimals, outside the seed villages files and the invented pins
//   pluscode  an Open Location Code (a "plus code"), which is a location as exact as a pin
//   email     an e-mail address that is not a documented example
//   gitleaks  anything gitleaks flags (the pinned version, scripts/ci/tools.json)
//
// Modes:   (none)         every tracked file in the working copy      (CI)
//          --staged       what is staged, as staged                   (the pre-commit hook, .githooks/pre-commit)
//          --root <dir>   every file under a directory                (tests)
//          --self-test    plant one of each in a temporary directory and fail unless every one is refused (CI runs this too)
//          --no-gitleaks  skip gitleaks (the built-in rules only)
// Environment: GITLEAKS_BIN (path to gitleaks), REQUIRE_GITLEAKS=1 (a missing gitleaks is a failure; CI sets it),
//              ALO_NO_TOOL_INSTALL=1 (never download the pinned gitleaks on a machine that lacks it).
//
// The output never prints a value: CI logs of a public repository are public, so a finding is reported as file, line, rule and shape only.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
const ALLOW_PATH = join(HERE, "personal-data-allow.json");

let cached = null;
export function loadAllow(path = ALLOW_PATH) {
  if (path === ALLOW_PATH && cached) return cached;
  const a = JSON.parse(readFileSync(path, "utf8"));
  if (path === ALLOW_PATH) cached = a;
  return a;
}

// Arabic-Indic and Persian digits are read as the digits they are (one character each, so every position stays the same).
const latinDigits = (t) => t.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String.fromCharCode(48 + (c.charCodeAt(0) & 0xf)));

// ---- phone numbers -------------------------------------------------------------------------------------------------------------------

// GS1 check digit (EAN-13 and UPC-A): a product barcode of 12 or 13 digits has one, a person's number does not.
export function validGs1(d) {
  if (!/^\d{12,13}$/.test(d)) return false;
  const digits = d.length === 12 ? "0" + d : d;            // a UPC-A is an EAN-13 with a leading zero
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

// A GitHub Actions run number ("run 43394402493", "runs (43642090610, 43644483826)") is 11 digits; so is a Lebanese number with its country code.
// A number is read as a run number only if its line, or the line before, says run or job, and it does not start with 961.
const RUN_WORD = /\b(?:runs?|run_id|jobs?)\b|\/(?:runs|jobs)\//i;
// A product barcode is named as one ("barcode: ...", "code": "...", offLookup("...")), or sits in a file that is a list of them.
const BARCODE_WORDS = ["barcode", "gtin", "ean", "upc", "code", "offlookup", "offfolder"];
function afterBarcodeWord(before) {                                          // up to 8 punctuation characters, then one of the words
  let i = before.length, k = 0;
  while (i > 0 && k < 8 && !/\w/.test(before[i - 1])) { i--; k++; }
  const w = before.slice(0, i).toLowerCase();
  return BARCODE_WORDS.some((x) => w.endsWith(x));
}

// Every phone-number-shaped thing of 11 to 13 digits (after the international prefix), with the line it is on.
// "bare" is a plain run of digits: the only kind that can be a barcode, a timestamp or a GitHub run number.
export function findPhones(text, { barcodeFile = false } = {}) {
  text = latinDigits(text);
  const out = [];
  const spans = [];
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  const lines = text.split("\n");
  const push = (m, kind) => {
    const raw = m[0];
    if (spans.some(([a, b]) => m.index < b && m.index + raw.length > a)) return;        // already found by an earlier pattern
    let digits = raw.replace(/\D/g, "");
    if (kind !== "plus" && validGs1(digits)) return;                       // a product barcode, plain or typed in groups
    if (kind === "bare") {
      // A GitHub Actions run number is 11 digits and, today, from 40 to 89 billion. No Lebanese, Gulf or Levant number is (their codes are 961 to 974),
      // and no phone number of 13 digits starts with 1. Both are read as what they are.
      if (digits.length === 11 && Number(digits) >= 4e10 && Number(digits) < 9e10) return;
      if (digits.length === 13 && digits[0] === "1") return;               // a timestamp in milliseconds (no phone number has 13 digits from 1)
      const ln = lineOf(m.index);
      const before = text.slice(Math.max(0, m.index - 40), m.index).split("\n").pop();
      if (afterBarcodeWord(before)) return;
      if (!digits.startsWith("961") && (RUN_WORD.test(lines[ln - 1] ?? "") || RUN_WORD.test(lines[ln - 2] ?? ""))) return;
      if (barcodeFile && digits.length >= 12) return;                      // a column of barcodes
    }
    if (digits.startsWith("00")) digits = digits.slice(2);                  // 00961...: the international prefix is not part of the number
    if (digits.length < 11 || digits.length > 13) return;
    spans.push([m.index, m.index + raw.length]);
    out.push({ digits, raw, index: m.index, line: lineOf(m.index), kind });
  };
  // 1. an international number: +, then digits with spaces, dots, dashes or brackets between them
  for (const m of text.matchAll(/(?<![\w+])\+(?:[ .\-()]{0,2}\d)+(?!\d)/g)) push(m, "plus");
  // 2. a plain run of digits
  for (const m of text.matchAll(/(?<![\w\-/+])(?<!\d\.)\d{11,13}(?![\w\-]|\.\d)/g)) push(m, "bare");
  // 3. digits in groups with no plus: 961 70 123 456, 00961-70-123-456, (961) 70 123 456
  for (const m of text.matchAll(/(?<![\w+\-/.])\(?\d{2,5}\)?(?:[ .\-]\d{2,6}){2,5}(?![\w\-]|[ .\-]\d)/g)) push(m, "grouped");
  return out.sort((a, b) => a.index - b.index);
}

function prefixMatch(digits, prefix) { return digits.startsWith(prefix); }
// Invented = a documented range or number that cannot be a person. Not file-scoped.
export function isInventedPhone(digits, allow = loadAllow()) {
  return allow.phones.ranges.some((r) => prefixMatch(digits, r.prefix)) || allow.phones.exact.some((e) => !e.files && e.digits === digits);
}
function isAllowedPhone(digits, path, allow) {
  return isInventedPhone(digits, allow) || allow.phones.exact.some((e) => e.files && e.digits === digits && e.files.includes(path));
}

// ---- location pins -------------------------------------------------------------------------------------------------------------------

// Lebanon's bounding box (a little generous on purpose). A pin is a latitude and a longitude close together in the text, either order.
const LAT = [33.05, 34.70], LNG = [35.10, 36.65], WINDOW = 200;
// 33.67000 is two decimals: trailing zeros do not count.
function decimals(s) {
  const frac = s.split(".")[1] ?? "";
  let n = frac.length;
  while (n > 0 && frac[n - 1] === "0") n--;
  return n;
}
export function findPins(text, { all = false } = {}) {
  text = latinDigits(text);
  const lats = [], lngs = [];
  for (const m of text.matchAll(/(?<![\w.])\d{1,3}\.\d+(?![\w]|\.\d)/g)) {
    const v = Number(m[0]);
    if (v >= LAT[0] && v <= LAT[1]) lats.push({ s: m[0], i: m.index });
    if (v >= LNG[0] && v <= LNG[1]) lngs.push({ s: m[0], i: m.index });
  }
  const out = [];
  const used = new Set();
  for (const a of lats) {
    let best = null;
    for (const b of lngs) {
      const d = Math.abs(a.i - b.i);
      if (d <= WINDOW && b.i !== a.i && (!best || d < Math.abs(a.i - best.i))) best = b;
    }
    if (!best || used.has(best.i)) continue;
    if (!all && decimals(a.s) <= 3 && decimals(best.s) <= 3) continue;           // three decimals is about 110 m: a village, not a home
    used.add(best.i);
    out.push({ lat: a.s, lng: best.s, index: a.i, line: text.slice(0, a.i).split("\n").length });
  }
  return out;
}
const sameNumber = (a, b) => Number(a) === Number(b);
// The village centres, read from the files that carry them as data: a pin that is exactly one of them is a public place, anywhere.
const centres = new WeakMap();
function villageCentres(allow) {
  if (!centres.has(allow)) {
    const list = [];
    for (const f of allow.pins.villageCentresFrom) { try { list.push(...findPins(readFileSync(join(REPO, f), "utf8"), { all: true })); } catch { /* a missing file has no centres */ } }
    centres.set(allow, list);
  }
  return centres.get(allow);
}
export function isInventedPin(lat, lng, allow = loadAllow()) {
  return allow.pins.exact.some((p) => sameNumber(p.lat, lat) && sameNumber(p.lng, lng))
    || villageCentres(allow).some((p) => sameNumber(p.lat, lat) && sameNumber(p.lng, lng));
}

// ---- plus codes ----------------------------------------------------------------------------------------------------------------------

// Open Location Code: 4, 6 or 8 characters from a 20-letter alphabet, a plus, then 2 or more. At least one letter, so "2368+22" is arithmetic.
const OLC = /(?<![A-Za-z0-9])[23456789CFGHJMPQRVWX]{4}(?:[23456789CFGHJMPQRVWX]{2}){0,2}(?:\+|%2B)[23456789CFGHJMPQRVWX]{2,7}(?![A-Za-z0-9])/gi;
export function findPlusCodes(text) {
  const out = [];
  for (const m of text.matchAll(OLC)) if (/[A-Za-z]/.test(m[0])) out.push({ index: m.index, line: text.slice(0, m.index).split("\n").length, length: m[0].length });
  return out;
}

// ---- e-mail addresses ----------------------------------------------------------------------------------------------------------------

// True when the text just before an "@" ends inside the user part of a URL: "https://user:" or "https://".
function inUrlUserinfo(before) {
  const at = before.lastIndexOf("://");
  if (at < 0) return false;
  const after = before.slice(at + 3);
  return !/[\s/@]/.test(after);
}

export function findEmails(text) {
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g)) {
    if (inUrlUserinfo(text.slice(Math.max(0, m.index - 80), m.index).split("\n").pop())) continue;   // https://user:pw@host: a credential part of a URL, not an address (gitleaks reads those)
    const at = m[0].lastIndexOf("@");
    out.push({ address: m[0].toLowerCase(), domain: m[0].slice(at + 1).toLowerCase(), index: m.index, line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}
function isAllowedEmail(e, path, allow) {
  const { domains, tlds, exact } = allow.emails;
  if (domains.some((d) => e.domain === d || e.domain.endsWith("." + d))) return true;
  if (tlds.includes(e.domain.split(".").at(-1))) return true;
  return exact.some((x) => x.address === e.address && (!x.files || x.files.includes(path)));
}

// ---- the scan ------------------------------------------------------------------------------------------------------------------------

const shape = {
  phone: (p) => `a phone number of ${p.digits.length} digits${p.kind === "bare" ? " (plain digits)" : ""}, not in an invented range`,
  pin: (p) => `a location pin inside Lebanon (${decimals(p.lat)} and ${decimals(p.lng)} decimals), not a seed village or an invented pin`,
  pluscode: (p) => `a plus code (${p.length} characters)`,
  email: (p) => `an e-mail address at ${p.domain}, not a documented example`,
};

// path is relative to the repository root, with forward slashes. Returns [{ rule, path, line, why }]; never the value itself.
export function scanText(path, text, allow = loadAllow()) {
  const out = [];
  if (allow.skipPaths.includes(path)) return out;
  text = latinDigits(text);
  for (const p of findPhones(text, { barcodeFile: allow.barcodePaths.includes(path) })) if (!isAllowedPhone(p.digits, path, allow)) out.push({ rule: "phone", path, line: p.line, why: shape.phone(p) });
  if (!allow.pins.files.some((f) => f.path === path))
    for (const p of findPins(text)) if (!isInventedPin(p.lat, p.lng, allow)) out.push({ rule: "pin", path, line: p.line, why: shape.pin(p) });
  for (const p of findPlusCodes(text)) out.push({ rule: "pluscode", path, line: p.line, why: shape.pluscode(p) });
  for (const e of findEmails(text)) if (!isAllowedEmail(e, path, allow)) out.push({ rule: "email", path, line: e.line, why: shape.email(e) });
  return out.sort((a, b) => a.line - b.line);
}

const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const MAX_BYTES = 8 * 1024 * 1024;

export function treeFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if ([".git", "node_modules", ".tools", ".wrangler"].includes(name)) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p); else if (s.isFile() && s.size <= MAX_BYTES) out.push({ path: relative(root, p).split(sep).join("/"), read: () => readFileSync(p) });
    }
  };
  walk(root);
  return out;
}
export function trackedFiles(cwd) {
  const list = execFileSync("git", ["ls-files", "-z"], { cwd, maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
  return list.filter((p) => existsSync(join(cwd, p)) && statSync(join(cwd, p)).isFile() && statSync(join(cwd, p)).size <= MAX_BYTES)
    .map((p) => ({ path: p, read: () => readFileSync(join(cwd, p)) }));
}
export function stagedFiles(cwd) {
  const list = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd, maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
  return list.map((p) => ({ path: p, read: () => execFileSync("git", ["show", `:${p}`], { cwd, maxBuffer: 64 * 1024 * 1024 }) }));
}

export function scanFiles(files, allow = loadAllow()) {
  const out = [];
  for (const f of files) {
    let buf;
    try { buf = f.read(); } catch { continue; }
    if (!isText(buf) || buf.length > MAX_BYTES) continue;
    out.push(...scanText(f.path, buf.toString("utf8"), allow));
  }
  return out;
}

// ---- gitleaks --------------------------------------------------------------------------------------------------------------------------

function findGitleaks() {
  const explicit = process.env.GITLEAKS_BIN;
  if (explicit) return { bin: existsSync(explicit) ? explicit : null, explicit: true };
  const onPath = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (onPath.status === 0) return { bin: "gitleaks", explicit: false };
  const local = join(REPO, ".tools/bin/gitleaks");
  return { bin: existsSync(local) ? local : null, explicit: false };
}
function installGitleaks() {
  if (process.env.ALO_NO_TOOL_INSTALL) return false;
  console.error("no-personal-data: installing the pinned gitleaks into .tools/ (SHA-256 checked, scripts/ci/tools.json)");
  const r = spawnSync(process.execPath, [join(HERE, "install-tool.mjs"), "gitleaks"], { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] });
  return r.status === 0;
}

// Returns { ran, ok, lines }: lines are gitleaks's own redacted report.
export function runGitleaks({ mode, root }) {
  let { bin, explicit } = findGitleaks();
  if (!bin && !explicit && installGitleaks()) bin = findGitleaks().bin;
  if (!bin) return { ran: false, ok: true, lines: [] };
  const config = join(REPO, ".gitleaks.toml");
  const work = mkdtempSync(join(tmpdir(), "gitleaks-report-"));
  const reportPath = join(work, "report.json");
  const common = ["--config", config, "--redact", "--no-banner", "--no-color", "--exit-code", "1", "--report-format", "json", "--report-path", reportPath];
  const args = mode === "staged" ? ["git", "--pre-commit", "--staged", ...common] : ["detect", "--no-git", "--source", root, ...common];
  try {
    const r = spawnSync(bin, args, { cwd: mode === "staged" ? process.cwd() : root, encoding: "utf8" });
    // Only file, line and rule are read from the report (it is redacted, but nothing else of a finding is worth a public log).
    let lines = [];
    try { lines = JSON.parse(readFileSync(reportPath, "utf8")).map((f) => ({ RuleID: f.RuleID, File: f.File, Line: f.StartLine })); } catch { /* no report: none found, or gitleaks stopped */ }
    const stopped = r.status !== 0 && lines.length === 0;
    return { ran: true, ok: r.status === 0, status: r.status, lines, raw: stopped ? `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(0, 400) : "" };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

// ---- command line ----------------------------------------------------------------------------------------------------------------------

function report(findings, gl, out = console.error) {
  for (const f of findings) out(`${f.path}:${f.line}: ${f.rule}: ${f.why}`);
  for (const l of gl?.lines ?? []) out(`${l.File}: gitleaks: rule ${l.RuleID}${l.Line ? ` (line ${l.Line})` : ""}`);
}

export async function selfTest() {
  const { PLANTS, NEAR_MISSES } = await import("./personal-data-plants.mjs");
  const allow = loadAllow();
  const missed = [];
  for (const p of PLANTS.filter((x) => x.rule !== "gitleaks")) {
    const rules = scanText(p.path, p.text, allow).map((f) => f.rule);
    if (!rules.includes(p.rule)) missed.push(p.name);
  }
  const falsePositives = NEAR_MISSES.filter((m) => scanText(m.path, m.text, allow).length).map((m) => m.name);
  const secret = PLANTS.find((x) => x.rule === "gitleaks");
  const dir = mkdtempSync(join(tmpdir(), "pub1-self-"));
  let gitleaksOk = true, gitleaksRan = false;
  try {
    mkdirSync(dirname(join(dir, secret.path)), { recursive: true });
    writeFileSync(join(dir, secret.path), secret.text);
    const g = runGitleaks({ mode: "tree", root: dir });
    gitleaksRan = g.ran;
    if (g.ran && g.ok) { gitleaksOk = false; missed.push(secret.name); }
    if (!g.ran && process.env.REQUIRE_GITLEAKS) { gitleaksOk = false; missed.push(`${secret.name} (gitleaks is not installed)`); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`self-test: ${PLANTS.length} planted examples, ${PLANTS.length - missed.length} refused; ${NEAR_MISSES.length} near misses, ${falsePositives.length} wrongly refused${gitleaksRan ? "" : "; gitleaks not run"}`);
  if (missed.length) console.error(`self-test FAILED: not refused: ${missed.join(", ")}`);
  if (falsePositives.length) console.error(`self-test FAILED: wrongly refused: ${falsePositives.join(", ")}`);
  return missed.length === 0 && falsePositives.length === 0 && gitleaksOk ? 0 : 1;
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? resolve(args[rootAt + 1]) : null;
  const staged = args.includes("--staged");
  const mode = staged ? "staged" : "tree";
  const cwd = process.cwd();
  const files = root ? treeFiles(root) : staged ? stagedFiles(cwd) : trackedFiles(cwd);
  const findings = scanFiles(files);
  let gl = { ran: false, ok: true, lines: [] };
  if (!args.includes("--no-gitleaks") && (!staged || files.length)) gl = runGitleaks({ mode, root: root ?? cwd });
  report(findings, gl);
  if (gl.raw) console.error(`gitleaks stopped without a report: ${gl.raw.replace(/\d{6,}/g, "…")}`);
  let failed = findings.length > 0 || !gl.ok;
  if (!args.includes("--no-gitleaks") && !gl.ran && !(staged && !files.length)) {
    if (process.env.REQUIRE_GITLEAKS) { console.error("no-personal-data: gitleaks is required here (REQUIRE_GITLEAKS) and was not found: install it with scripts/ci/install-tool.mjs gitleaks"); failed = true; }
    else console.error("no-personal-data: gitleaks was not run (not installed; CI runs it). The built-in rules ran.");
  }
  if (failed) {
    const n = findings.length + (gl.lines?.length ?? 0);
    console.error(`no-personal-data: ${n || "a"} finding(s). The repository is public: remove the value, or use an invented one (docs/RUNBOOK.md, "What may never be committed").`);
    return 1;
  }
  console.log(`no-personal-data: ${files.length} file(s) scanned, nothing found${gl.ran ? "; gitleaks clean" : ""}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => { process.exitCode = c; });
