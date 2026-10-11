#!/usr/bin/env bash
# DECISIONS §32.7: while the CI Claude review cannot run (no API credit), the build session runs the
# repo's pr-reviewer agent on its own diff and posts the verdict as a PR comment tagged with the head
# commit. This script decides whether such a comment approves the exact head being checked.
#
# A comment counts only when:
#   - its author is the repo owner, a member or a collaborator (author_association), never a bot or outsider
#   - it starts with the line `### pr-reviewer self-review (DECISIONS §32.7)`
#   - it carries `Head: <full 40-character sha>` equal to the head under test (a later push needs a new review)
#   - the latest such comment for that head says `Verdict: approve` (a later "changes requested" wins)
# Prints `approved` or `none`. Usage: scripts/self-review.sh <head-sha> [comments.json]
# (without a file it reads the PR's comments with `gh api`, needing GH_TOKEN, GITHUB_REPOSITORY and PR).
set -euo pipefail
head="${1:?head sha required}"
if ! [[ "$head" =~ ^[0-9a-f]{40}$ ]]; then echo none; exit 0; fi

if [ -n "${2:-}" ]; then
  comments=$(cat "$2")
else
  comments=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" | jq -s 'add // []')
fi

verdict=$(printf '%s' "$comments" | jq -r --arg head "$head" '
  [ .[]
    | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR")
    | select((.user.type // "User") == "User")
    | select(.body | startswith("### pr-reviewer self-review (DECISIONS §32.7)"))
    | select(.body | test("(^|\\n)Head: " + $head + "\\s*(\\n|$)"))
  ]
  | sort_by(.created_at)
  | last
  | if . == null then "none"
    elif (.body | test("(^|\\n)Verdict: approve\\s*(\\n|$)")) then "approved"
    else "none" end')
echo "$verdict"
