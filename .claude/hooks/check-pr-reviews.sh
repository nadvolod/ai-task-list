#!/bin/bash
# Hook: Block gh pr merge if there are unreviewed PR comments.
# Runs as a PreToolUse hook on Bash commands.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept "gh pr merge" commands
if ! echo "$CMD" | grep -qE 'gh\s+pr\s+merge'; then
  exit 0
fi

# Extract PR number
PR_NUM=$(echo "$CMD" | grep -oE 'gh\s+pr\s+merge\s+([0-9]+)' | grep -oE '[0-9]+')
if [ -z "$PR_NUM" ]; then
  exit 0
fi

# Detect repo — check for --repo flag first, then fall back to current repo
REPO=$(echo "$CMD" | grep -oE '\-\-repo\s+[^\s]+' | sed 's/--repo\s*//')
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
fi
if [ -z "$REPO" ]; then
  exit 0
fi

# Get the latest commit date on the PR
LATEST_COMMIT_DATE=$(gh api "repos/$REPO/pulls/$PR_NUM/commits" --jq '.[-1].commit.committer.date' 2>/dev/null)

# Count only comments posted AFTER the latest commit (unaddressed)
if [ -n "$LATEST_COMMIT_DATE" ]; then
  COMMENT_COUNT=$(gh api "repos/$REPO/pulls/$PR_NUM/comments" --jq "[.[] | select(.created_at > \"$LATEST_COMMIT_DATE\")] | length" 2>/dev/null || echo 0)
else
  COMMENT_COUNT=$(gh api "repos/$REPO/pulls/$PR_NUM/comments" --jq 'length' 2>/dev/null || echo 0)
fi

# Ensure COMMENT_COUNT is a number
COMMENT_COUNT=$(echo "$COMMENT_COUNT" | grep -oE '^[0-9]+$' || echo 0)
if [ "$COMMENT_COUNT" -gt 0 ]; then
  SUMMARIES=$(gh api "repos/$REPO/pulls/$PR_NUM/comments" --jq '.[0:5] | .[] | "- " + (.body | split("\n")[0] | .[0:120])' 2>/dev/null)
  REASON="PR #$PR_NUM has $COMMENT_COUNT review comment(s). Address them before merging.\n\nTop comments:\n$SUMMARIES"
  jq -n --arg reason "$REASON" '{"decision":"block","reason":$reason}'
  exit 0
fi

exit 0
