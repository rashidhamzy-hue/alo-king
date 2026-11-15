// PUB1 item 3: every phone number and every location pin in a test, fixture or eval file comes from the invented ranges, with no
// per-file exemption. A new fixture that needs a number must take one from a listed range, or add a range to
// scripts/ci/personal-data-allow.json with a note, where a reviewer sees it.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs, no types
import { findPhones, findPins, isInventedPhone, isInventedPin, loadAllow } from "../../scripts/ci/no-personal-data.mjs";
// @ts-expect-error plain .mjs, no types
import { PLANTS } from "../../scripts/ci/personal-data-plants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_PATH = /^(test\/|packages\/[^/]+\/test\/|apps\/[^/]+\/test\/|evals\/|scripts\/(?:[^/]+\/)?test\/|scripts\/fixtures\/)/;
const TEXT = /\.(ts|mjs|js|json|md|sql|sh|csv|txt|yml|yaml)$/;
const files = (execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n") as string[]).filter((f) => FIXTURE_PATH.test(f) && TEXT.test(f));

describe("fixtures: only invented numbers and pins", () => {
  it("there are fixture files to check", () => { expect(files.length).toBeGreaterThan(100); });

  it("every phone number of 11 to 13 digits in a test, fixture or eval file is in an invented range", () => {
    const bad: string[] = [];
    for (const f of files) for (const p of findPhones(readFileSync(join(ROOT, f), "utf8")) as { digits: string; line: number }[])
      if (!isInventedPhone(p.digits)) bad.push(`${f}:${p.line}`);
    expect(bad).toEqual([]);
  });

  it("every location pin inside Lebanon with more than three decimals is an invented pin", () => {
    const bad: string[] = [];
    for (const f of files) for (const p of findPins(readFileSync(join(ROOT, f), "utf8")) as { lat: string; lng: string; line: number }[])
      if (!isInventedPin(p.lat, p.lng)) bad.push(`${f}:${p.line}`);
    expect(bad).toEqual([]);
  });
});

describe("the invented ranges are narrow and explained", () => {
  const allow = loadAllow() as { phones: { ranges: { prefix: string; note: string; reserved?: boolean }[]; exact: { digits: string; note: string }[] }; pins: { exact: { lat: string; lng: string; note: string }[] } };

  it("every entry says why it is invented, and no range is wider than a thousand numbers", () => {
    // 8 digits of an 11-digit number leaves 1,000 numbers; only a prefix no operator can assign (marked reserved) may be shorter.
    for (const r of allow.phones.ranges as { prefix: string; note: string; reserved?: boolean }[]) {
      expect(r.note.length, r.prefix).toBeGreaterThan(10);
      expect(r.prefix, r.prefix).toMatch(r.reserved ? /^\d{3,}$/ : /^\d{8,}$/);
    }
    for (const e of allow.phones.exact) { expect(e.note.length, e.digits).toBeGreaterThan(10); expect(e.digits).toMatch(/^\d{11,13}$/); }
    for (const e of allow.pins.exact) expect(e.note.length, `${e.lat},${e.lng}`).toBeGreaterThan(10);
  });

  it("only the lockfile and this file are skipped by the scan, and only one catalog file is a list of barcodes", () => {
    const a = loadAllow() as { skipPaths: string[]; barcodePaths: string[] };
    expect(a.skipPaths).toEqual(["package-lock.json", "scripts/ci/personal-data-allow.json"]);
    expect(a.barcodePaths).toEqual(["supabase/seed/catalog.csv"]);
  });

  it("a number that could be a real subscriber is not invented", () => {
    for (const p of PLANTS.filter((x: { rule: string }) => x.rule === "phone")) {
      const digits = (findPhones(p.text) as { digits: string }[])[0]!.digits;
      expect(isInventedPhone(digits), p.name).toBe(false);
    }
    // a Lebanese mobile in a block nobody listed
    expect(isInventedPhone(["961", "76", "543", "210"].join(""))).toBe(false);
  });

  it("a pin with real-looking decimals is not invented; the listed fakes are", () => {
    expect(isInventedPin(["33", "81234"].join("."), ["35", "15678"].join("."))).toBe(false);
    for (const e of allow.pins.exact) expect(isInventedPin(e.lat, e.lng)).toBe(true);
  });
});
