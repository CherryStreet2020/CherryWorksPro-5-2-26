#!/usr/bin/env bash
# =============================================================================
# redteam-codex.sh — the LOCAL Codex leg of the CWP ship harness.
#
# The Codex GitHub App (chatgpt-codex-connector) stopped answering `@codex
# review` on this repo (no reaction, no review, PRs #44–#50). This script
# replaces it with a fully automated local run: it reads the local git repo,
# reviews the branch/commit, and writes findings to a file the ship cycle gates
# on. Ported from CherryEnterpriseAssetManagement/scripts/redteam-codex.sh.
#
# Usage (or `cwp codex …`, which forwards here):
#   scripts/redteam-codex.sh                 # review this branch vs main (the PR case)
#   scripts/redteam-codex.sh --deep          # same, frontier model + xhigh effort
#   scripts/redteam-codex.sh --base develop  # review vs a different base
#   scripts/redteam-codex.sh --commit <sha>  # review one commit (post-merge squash)
#   scripts/redteam-codex.sh --uncommitted   # review working-tree changes (pre-commit)
#
# MODEL / COST
#   Default gpt-5.6-terra at `high` reasoning: a red-team pass runs over a
#   BOUNDED diff, not an open-ended agentic task. Use --deep (gpt-6-astra,
#   xhigh) for PRs that warrant the ceiling: authz fences, money/posting paths,
#   migrations, concurrency. Both are passed PER INVOCATION with `-c`, so the
#   global ~/.codex/config.toml (interactive Codex) is untouched.
#   Override: REDTEAM_CODEX_MODEL=gpt-5.6-luna REDTEAM_CODEX_EFFORT=medium …
#
# Exit codes: 0 = review completed (READ THE FINDINGS — 0 does not mean "clean")
#             1 = codex binary not found
#             2 = codex run failed
#             3 = refused: --uncommitted with untracked files present
#             4 = bad arguments (--commit / --base missing their value)
#
# EGRESS
#   🔴 CODEX IS PART OF THE SHIP HARNESS. RUN IT ON EVERY PR (Dean, 2026-09-07:
#   "Codex is installed on this box, find it and incorporate into our ship
#   harness"; and 2026-08-30 on EAM: "RUN IT EVERY TIME!!"). Do not re-ask.
#   This repo is PUBLIC (gh repo view → isPrivate: false), so committed content
#   is already public; reviewing it with Dean's Codex account is his settled
#   decision. `--uncommitted` is different: Codex would also send UNTRACKED
#   files (local .env, credentials, customer exports, AUDIT-*.md exploit
#   detail), so it REFUSES when untracked files exist unless
#   REDTEAM_CODEX_ALLOW_UNTRACKED=1 is set deliberately after reading the list.
# =============================================================================
set -euo pipefail

MODEL="${REDTEAM_CODEX_MODEL:-gpt-5.6-terra}"
EFFORT="${REDTEAM_CODEX_EFFORT:-high}"

ARGS=()
TARGET_COMMIT=""
TARGET_BASE=""
TARGET_KIND="branch"
while [ $# -gt 0 ]; do
  case "$1" in
    --deep) MODEL="gpt-6-astra"; EFFORT="xhigh" ;;
    --commit)
      case "${2:-}" in ""|-*) echo "redteam-codex: --commit requires a commit-ish (got '${2:-<missing>}')." >&2; exit 4 ;; esac
      TARGET_KIND="commit"; TARGET_COMMIT="$2"; ARGS+=("$1" "$2"); shift ;;
    --commit=*)
      TARGET_COMMIT="${1#--commit=}"; [ -z "$TARGET_COMMIT" ] && { echo "redteam-codex: --commit= requires a commit-ish." >&2; exit 4; }
      TARGET_KIND="commit"; ARGS+=("$1") ;;
    --base)
      case "${2:-}" in ""|-*) echo "redteam-codex: --base requires a branch (got '${2:-<missing>}')." >&2; exit 4 ;; esac
      TARGET_BASE="$2"; ARGS+=("$1" "$2"); shift ;;
    --base=*)
      TARGET_BASE="${1#--base=}"; [ -z "$TARGET_BASE" ] && { echo "redteam-codex: --base= requires a branch." >&2; exit 4; }
      ARGS+=("$1") ;;
    --uncommitted) TARGET_KIND="uncommitted"; ARGS+=("$1") ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

# --- resolve the codex binary --------------------------------------------------
# The desktop-app bundle comes FIRST: codex looks for its sibling
# `codex-code-mode-host` next to its own path, so a lone symlink in ~/.local/bin
# makes every run log "Code Mode is unavailable" and fail tool calls closed.
CODEX=""
for cand in \
  "/Applications/ChatGPT.app/Contents/Resources/codex" \
  "/Applications/Codex.app/Contents/MacOS/codex" \
  "$HOME/.codex/plugins/.plugin-appserver/codex"; do
  [ -x "$cand" ] && CODEX="$cand" && break
done
if [ -z "$CODEX" ] && command -v codex >/dev/null 2>&1; then CODEX="$(command -v codex)"; fi
if [ -z "$CODEX" ]; then
  echo "redteam-codex: codex CLI not found (PATH, ChatGPT.app, Codex.app, ~/.local/bin)." >&2
  echo "  Install the ChatGPT/Codex desktop app, or symlink the binary into ~/.local/bin." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
OUT_DIR="${REPO_ROOT}/.redteam"
mkdir -p "$OUT_DIR"

if [ ${#ARGS[@]} -eq 0 ]; then ARGS=(--base main); TARGET_BASE="main"; fi

# EGRESS GUARD — the only HARD refusal here: --uncommitted with untracked files.
if [ "$TARGET_KIND" = "uncommitted" ] && [ "${REDTEAM_CODEX_ALLOW_UNTRACKED:-0}" != "1" ]; then
  UNTRACKED="$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)"
  if [ -n "$UNTRACKED" ]; then
    N="$(printf '%s\n' "$UNTRACKED" | wc -l | tr -d ' ')"
    {
      echo "redteam-codex: REFUSING --uncommitted — $N untracked file(s) present."
      echo "  codex review --uncommitted sends UNTRACKED files to OpenAI (may include .env,"
      echo "  credentials, customer data, audit exploit detail). First 10:"
      printf '%s\n' "$UNTRACKED" | head -10 | sed 's/^/    /'
      [ "$N" -gt 10 ] && echo "    … and $((N-10)) more"
      echo "  Fix: commit / stash / gitignore them, or opt in deliberately:"
      echo "    REDTEAM_CODEX_ALLOW_UNTRACKED=1 $0 --uncommitted"
    } >&2
    exit 3
  fi
fi

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
case "$TARGET_KIND" in
  commit)
    SHA="$(git -C "$REPO_ROOT" rev-parse --short "$TARGET_COMMIT" 2>/dev/null || echo "$TARGET_COMMIT")"
    LABEL="commit-${SHA}" ;;
  uncommitted)
    SHA="$HEAD_SHA"; LABEL="${BRANCH//\//-}-${SHA}-uncommitted" ;;
  *)
    SHA="$HEAD_SHA"; BASE_LABEL="${TARGET_BASE:-main}"
    LABEL="${BRANCH//\//-}-vs-${BASE_LABEL//\//-}-${SHA}" ;;
esac
OUT="${OUT_DIR}/codex-${LABEL}.md"

echo "redteam-codex: model=$MODEL effort=$EFFORT"
echo "redteam-codex: repo=$REPO_ROOT branch=$BRANCH target=$TARGET_KIND sha=$SHA"
echo "redteam-codex: args=${ARGS[*]}"
echo "redteam-codex: writing → $OUT"

set +e
# mcp_servers={} : a review needs git + the tree only. The interactive config's
# MCP servers (VPN-only pipeline hosts, browser/computer-use) otherwise spew
# transport errors into the findings file and slow the run.
( cd "$REPO_ROOT" && "$CODEX" review \
    -c model="$MODEL" \
    -c model_reasoning_effort="$EFFORT" \
    -c 'mcp_servers={}' \
    "${ARGS[@]}" ) > "$OUT" 2>&1
rc=$?
set -e

if [ $rc -ne 0 ]; then
  echo "redteam-codex: codex exited $rc — see $OUT" >&2
  tail -20 "$OUT" >&2
  exit 2
fi

echo "redteam-codex: done."
echo "---------------------------------------------------------------"
tail -60 "$OUT"
echo "---------------------------------------------------------------"
echo "redteam-codex: FULL OUTPUT → $OUT"
echo "redteam-codex: exit 0 means the review RAN, not that it was clean —"
echo "               read the findings and fold every real one before merging."
