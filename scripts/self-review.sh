#!/usr/bin/env bash
# DECISIONS §32.7: while the CI Claude review cannot run (no API credit), the build session runs the
# repo's pr-reviewer agent on its own diff and posts the verdict as a PR comment tagged with the head
# commit. This script decides whether such a comment approves the exact head being checked.
#
# A comment counts only when:
#   - its author is the repo owner (author_association OWNER, user type User): never a bot, collaborator or outsider
#   - it was never edited (an edit keeps created_at, so an edited comment could turn "changes" into "approve")
#   - line 1 is exactly `### pr-reviewer self-review (DECISIONS §32.7)`
#   - line 2 is exactly `Head: <full 40-character sha>` of the head under test (a later push needs a new review)
#   - line 3 is exactly `Verdict: approve`, in the latest such comment for that head (a later
#     `Verdict: changes requested` wins); lines below are free text and never parsed
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
    | select(.author_association == "OWNER")
    | select((.user.type // "User") == "User")
    | . as $c
    | ($c.body | split("\n") | map(rtrimstr("\r"))) as $l
    | select(($l | length) >= 3)
    | select($l[0] == "### pr-reviewer self-review (DECISIONS §32.7)")
    | select($l[1] == "Head: " + $head)
    | {created_at, edited: (($c.updated_at // $c.created_at) != $c.created_at), verdict: $l[2]}
  ]
  | sort_by(.created_at)
  | last
  | if . != null and (.edited | not) and .verdict == "Verdict: approve" then "approved" else "none" end')
echo "$verdict"
