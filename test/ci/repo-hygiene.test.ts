// DOC2: the two repository rules in scripts/ci/repo-hygiene.mjs. No file over 300 KB (the files already over it have a ceiling: they may shrink,
// never grow) and no image under docs/ (screenshots live in the private screens bucket). The last test runs the check on this repository.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs, no types
import { MAX_BYTES, findings, trackedFiles } from "../../scripts/ci/repo-hygiene.mjs";

const KB = 1024;
describe("no file over 300 KB", () => {
  it("is 300 KB: a file just under passes, one byte over fails by name", () => {
    expect(MAX_BYTES).toBe(300 * KB);
    expect(findings([{ path: "docs/a.md", size: 300 * KB }])).toEqual([]);
    expect(findings([{ path: "docs/a.md", size: 300 * KB + 1 }])).toEqual([expect.stringContaining("docs/a.md")]);
  });
  it("lets a listed file through up to its ceiling and no further", () => {
    const allow = { sizeCeilings: { "evals/x.json": { max: 500 * KB, why: "a recorded result kept as a baseline" } } };
    expect(findings([{ path: "evals/x.json", size: 500 * KB }], allow)).toEqual([]);
    expect(findings([{ path: "evals/x.json", size: 400 * KB }], allow)).toEqual([]);
    expect(findings([{ path: "evals/x.json", size: 500 * KB + 1 }], allow)).toEqual([expect.stringMatching(/over its ceiling/)]);
  });
  it("calls a stale line: a listed file that is gone, or now under the limit, or has no reason", () => {
    expect(findings([], { sizeCeilings: { "gone.json": { max: 400 * KB, why: "a recorded result kept as a baseline" } } })).toEqual([expect.stringMatching(/not a tracked file/)]);
    expect(findings([{ path: "small.json", size: 10 }], { sizeCeilings: { "small.json": { max: 400 * KB, why: "a recorded result kept as a baseline" } } })).toEqual([expect.stringMatching(/under the limit/)]);
    expect(findings([{ path: "big.json", size: 400 * KB }], { sizeCeilings: { "big.json": { max: 400 * KB, why: "" } } })).toEqual([expect.stringMatching(/no reason/)]);
  });
});

describe("no image under docs/", () => {
  it("refuses a png, a webp, a jpg, a gif, an svg and an upper-case one, in any folder under docs/", () => {
    for (const p of ["docs/screens/a/x.png", "docs/x.webp", "docs/deep/er/x.JPG", "docs/x.jpeg", "docs/x.gif", "docs/x.svg", "docs/x.avif", "docs/x.ico"])
      expect(findings([{ path: p, size: 10 }]), p).toEqual([expect.stringMatching(/image under docs/)]);
  });
  it("does not touch images the site serves, or text under docs/", () => {
    expect(findings([{ path: "apps/web/public/icons/icon-192.png", size: 5000 }, { path: "packages/ui/crown.svg", size: 900 }, { path: "docs/log/wh1a.md", size: 9000 }])).toEqual([]);
  });
  it("lets one through only when it is on the allow-list by its whole path", () => {
    expect(findings([{ path: "docs/fonts/x.svg", size: 10 }], { imagesAllowed: ["docs/fonts/x.svg"] })).toEqual([]);
    expect(findings([{ path: "docs/fonts/y.svg", size: 10 }], { imagesAllowed: ["docs/fonts/x.svg"] })).toHaveLength(1);
  });
});

describe("this repository", () => {
  it("passes both rules, with the committed allow-list, and the list is a closed one of data files and an applied migration", () => {
    const allow = JSON.parse(readFileSync("scripts/ci/size-allow.json", "utf8"));
    expect(findings(trackedFiles(), allow)).toEqual([]);
    expect(allow.imagesAllowed).toEqual([]);
    for (const p of Object.keys(allow.sizeCeilings)) expect(p, p).toMatch(/^(evals\/.+\.json|supabase\/migrations\/0054_language_pack\.sql)$/);
  });
});
