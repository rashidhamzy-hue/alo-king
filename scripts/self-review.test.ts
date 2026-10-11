import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// scripts/self-review.sh: the §32.7 stand-in for the API review while there is no credit.
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const body = (sha: string, verdict: string) =>
  `### pr-reviewer self-review (DECISIONS §32.7)\nHead: ${sha}\nVerdict: ${verdict}\n\nNo findings.`;
type C = {
  body: string;
  author_association?: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
};
const run = (comments: C[], head = HEAD) => {
  const dir = mkdtempSync(path.join(tmpdir(), "self-review-"));
  const file = path.join(dir, "c.json");
  writeFileSync(
    file,
    JSON.stringify(
      comments.map((c, i) => ({
        body: c.body,
        author_association: c.author_association ?? "OWNER",
        user: { type: c.type ?? "User" },
        created_at: c.created_at ?? `2026-10-11T10:00:${String(i).padStart(2, "0")}Z`,
        updated_at:
          c.updated_at ?? c.created_at ?? `2026-10-11T10:00:${String(i).padStart(2, "0")}Z`,
      })),
    ),
  );
  return execFileSync("bash", ["scripts/self-review.sh", head, file]).toString().trim();
};

describe("self-review", () => {
  it("accepts the owner's approve for the exact head", () => {
    expect(run([{ body: body(HEAD, "approve") }])).toBe("approved");
  });
  it("ignores a review of another commit", () => {
    expect(run([{ body: body(OTHER, "approve") }])).toBe("none");
  });
  it("ignores bots and outsiders", () => {
    expect(run([{ body: body(HEAD, "approve"), type: "Bot" }])).toBe("none");
    expect(run([{ body: body(HEAD, "approve"), author_association: "NONE" }])).toBe("none");
    expect(run([{ body: body(HEAD, "approve"), author_association: "CONTRIBUTOR" }])).toBe("none");
    expect(run([{ body: body(HEAD, "approve"), author_association: "COLLABORATOR" }])).toBe("none");
  });
  it("only the header lines count: a later approve line in the text does not", () => {
    expect(run([{ body: `${body(HEAD, "changes requested")}\nVerdict: approve` }])).toBe("none");
    expect(
      run([
        {
          body: `### pr-reviewer self-review (DECISIONS §32.7)\nHead: ${OTHER}\nVerdict: approve\nHead: ${HEAD}`,
        },
      ]),
    ).toBe("none");
  });
  it("an edited later changes-requested still beats an earlier approve", () => {
    expect(
      run([
        { body: body(HEAD, "approve"), created_at: "2026-10-11T10:00:00Z" },
        {
          body: body(HEAD, "changes requested"),
          created_at: "2026-10-11T11:00:00Z",
          updated_at: "2026-10-11T11:05:00Z",
        },
      ]),
    ).toBe("none");
  });
  it("an edited comment never counts", () => {
    expect(
      run([
        {
          body: body(HEAD, "approve"),
          created_at: "2026-10-11T10:00:00Z",
          updated_at: "2026-10-11T10:05:00Z",
        },
      ]),
    ).toBe("none");
  });
  it("a later changes-requested for the same head wins", () => {
    expect(run([{ body: body(HEAD, "approve") }, { body: body(HEAD, "changes requested") }])).toBe(
      "none",
    );
  });
  it("needs the heading at the start and a full sha", () => {
    expect(run([{ body: `quote:\n${body(HEAD, "approve")}` }])).toBe("none");
    expect(run([{ body: body(HEAD.slice(0, 7), "approve") }], HEAD)).toBe("none");
    expect(run([{ body: body(HEAD, "approve") }], "not-a-sha")).toBe("none");
  });
  it("no comments is none", () => {
    expect(run([])).toBe("none");
  });
});
