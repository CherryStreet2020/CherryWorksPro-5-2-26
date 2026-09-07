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
#   scripts/redteam-codex.sh --plan PLAN.md  # review a PLAN before any code exists (read-only)
#
# PLAN REVIEW (added 2026-09-07, borrowed from chaseai-yt/claudex-loop):
#   Astra reads the plan plus the repo in a READ-ONLY sandbox and answers with a
#   verdict — APPROVED / REVISE / BLOCKED — evidence-backed findings, coverage
#   and limitations. The output records the plan's SHA-256; a changed plan
#   needs a fresh review. REQUIRED before building anything that touches auth,
#   billing, money movement, or schema (Dean, 2026-09-07). Exit 5 = REVISE,
#   6 = BLOCKED, so a wrapper can gate on it.
#
# MODEL / COST
#   Default gpt-6-astra at `high` reasoning — Dean's call, 2026-09-07
#   ("Astra ... use it at high"): the frontier model at high effort; xhigh is
#   reserved for --deep, for PRs that warrant the ceiling:
#   authz fences, money/posting paths, migrations, concurrency. Both are
#   passed PER INVOCATION with `-c`, so the global ~/.codex/config.toml
#   (interactive Codex) is untouched.
#   Override: REDTEAM_CODEX_MODEL=gpt-5.6-luna REDTEAM_CODEX_EFFORT=low …
#
# Exit codes: 0 = review completed (READ THE FINDINGS — 0 does not mean "clean")
#             1 = codex binary not found
#             2 = codex run failed
#             3 = refused: --uncommitted with untracked files present
#             4 = bad arguments (--commit / --base / --plan missing their value)
#             5 = plan review verdict REVISE      6 = plan review verdict BLOCKED
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

MODEL="${REDTEAM_CODEX_MODEL:-gpt-6-astra}"
EFFORT="${REDTEAM_CODEX_EFFORT:-high}"

ARGS=()
PLAN_FILE=""
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
    --plan)
      case "${2:-}" in ""|-*) echo "redteam-codex: --plan requires a file (got '${2:-<missing>}')." >&2; exit 4 ;; esac
      TARGET_KIND="plan"; PLAN_FILE="$2"; shift ;;
    --plan=*)
      PLAN_FILE="${1#--plan=}"; [ -z "$PLAN_FILE" ] && { echo "redteam-codex: --plan= requires a file." >&2; exit 4; }
      TARGET_KIND="plan" ;;
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

# ── Plan review: a different invocation (codex exec, read-only sandbox) ──────
if [ "$TARGET_KIND" = "plan" ]; then
  [ -f "$PLAN_FILE" ] || { echo "redteam-codex: plan file not found: $PLAN_FILE" >&2; exit 4; }
  PLAN_ABS="$(cd -- "$(dirname -- "$PLAN_FILE")" && pwd)/$(basename -- "$PLAN_FILE")"
  PLAN_LABEL="$(basename -- "$PLAN_FILE" | tr -c 'A-Za-z0-9._-' '_')"
  # Per-invocation private workspace: snapshot FIRST, then hash THE SNAPSHOT —
  # the report certifies exactly the bytes Codex read, and concurrent reviews
  # of the same plan cannot touch each other's files.
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/redteam-plan.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  SNAP="$TMP/plan.md"
  cp -- "$PLAN_ABS" "$SNAP"
  PLAN_SHA="$(shasum -a 256 "$SNAP" | cut -c1-64)"
  OUT="${OUT_DIR}/codex-plan-${PLAN_LABEL%.*}-${PLAN_SHA:0:12}.md"
  MSG="$TMP/final.md"; RAW="$TMP/transcript.txt"
  echo "redteam-codex: model=$MODEL effort=$EFFORT target=plan file=$PLAN_FILE sha256=${PLAN_SHA:0:12}…"
  echo "redteam-codex: writing → $OUT"
  PROMPT="You are the independent PLAN REVIEWER for this repository (CherryWorks Pro: Express + Drizzle/Postgres server in server/, React client in client/src, shared schema in shared/). You have a READ-ONLY sandbox: read the plan and any code it touches; do not modify anything.

Review the plan at: $SNAP  (an immutable snapshot of $PLAN_ABS)

Judge it against the ACTUAL code, not in the abstract. Hunt for: security and authorization gaps (multi-tenant isolation, CSRF/session, secrets), data-loss or money-movement risk, race conditions and crash windows, missing migrations or schema mismatches (NOTE: Azure provisions schema with drizzle-kit push from shared/schema.ts only; migrations/*.sql never run there), missing tests/proof steps, unclear acceptance criteria, and anything the plan assumes about the codebase that is false.

Answer in exactly this shape:
VERDICT: APPROVED | REVISE | BLOCKED
FINDINGS: numbered list, each with severity [P1|P2|P3], the plan section it concerns, the concrete evidence (file:line) and what to change. Zero findings is a valid answer.
COVERAGE: what you read and verified.
LIMITATIONS: what you could not verify.
APPROVED means no unresolved P1/P2. BLOCKED means the plan cannot proceed as written (say exactly what is missing)."
  set +e
  ( cd "$REPO_ROOT" && "$CODEX" exec \
      -s read-only \
      -c model="$MODEL" \
      -c model_reasoning_effort="$EFFORT" \
      -c 'mcp_servers={}' \
      -o "$MSG" \
      "$PROMPT" < /dev/null ) > "$RAW" 2>&1   # </dev/null: exec otherwise waits on stdin when not a TTY
  rc=$?
  set -e
  # The verdict comes ONLY from Codex's final message (-o). The transcript
  # echoes our own prompt, which contains the word VERDICT, so it is never parsed.
  VERDICT=""
  if [ -s "$MSG" ]; then
    # Every VERDICT line counts; more than one distinct value is a contradiction
    # and fails closed. `|| true`: an unmatched grep must not trip errexit.
    VERDICTS="$( { grep -E '^[[:space:]]*\**VERDICT:?\**[[:space:]]*\**(APPROVED|REVISE|BLOCKED)\**[[:space:]]*$' "$MSG" || true; } | { grep -o -E 'APPROVED|REVISE|BLOCKED' || true; } | sort -u)"
    if [ "$(printf '%s\n' "$VERDICTS" | grep -c .)" -eq 1 ]; then VERDICT="$VERDICTS"; fi
  fi
  # The source must be the bytes that were reviewed; otherwise no verdict stands.
  NOW_SHA="$(shasum -a 256 "$PLAN_ABS" | cut -c1-64)"
  SOURCE_CHANGED=0; [ "$NOW_SHA" != "$PLAN_SHA" ] && SOURCE_CHANGED=1
  {
    echo "# Plan review — $(basename -- "$PLAN_FILE")"
    echo "- plan: $PLAN_ABS"
    echo "- sha256: $PLAN_SHA (of the reviewed snapshot)"
    if [ "$SOURCE_CHANGED" -eq 1 ]; then echo "- ⚠️ SOURCE CHANGED DURING REVIEW: $PLAN_ABS is now ${NOW_SHA:0:12}… — this verdict does NOT cover the current file. Review again."; fi
    echo "- model: $MODEL @ $EFFORT · $(date -u +%Y-%m-%dT%H:%M:%SZ) · codex exit $rc"
    echo
    if [ -s "$MSG" ]; then cat "$MSG"; else echo "(no final message from Codex — NOT a verdict; transcript follows)"; echo; cat "$RAW"; fi
  } > "$OUT.$$" && mv -f "$OUT.$$" "$OUT"   # publish atomically
  if [ $rc -ne 0 ]; then echo "redteam-codex: codex exited $rc — see $OUT" >&2; tail -20 "$OUT" >&2; exit 2; fi
  if [ "$SOURCE_CHANGED" -eq 1 ]; then
    echo "redteam-codex: $PLAN_FILE changed during the review (reviewed ${PLAN_SHA:0:12}, now ${NOW_SHA:0:12}) — no verdict stands; review again." >&2
    exit 2
  fi
  echo "---------------------------------------------------------------"
  cat "$OUT"
  echo "---------------------------------------------------------------"
  echo "redteam-codex: PLAN VERDICT = ${VERDICT:-unparsed} (sha256 ${PLAN_SHA:0:12}…) → $OUT"
  case "$VERDICT" in
    APPROVED) exit 0 ;;
    REVISE)   echo "redteam-codex: fold the findings, then review the REVISED plan again (the sha changes)." >&2; exit 5 ;;
    BLOCKED)  exit 6 ;;
    *)        echo "redteam-codex: no unambiguous VERDICT line in Codex's final message — this is NOT an approval; read $OUT." >&2; exit 2 ;;
  esac
fi

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
      # sed reads all its input: no SIGPIPE under pipefail for a large untracked tree (Codex P2 on #51).
      printf '%s\n' "$UNTRACKED" | sed -n '1,10s/^/    /p'
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
    # An unresolvable commit-ish never reaches the filesystem as a path (Copilot #51).
    SHA="$(git -C "$REPO_ROOT" rev-parse --short --verify "${TARGET_COMMIT}^{commit}" 2>/dev/null)" \
      || { echo "redteam-codex: '$TARGET_COMMIT' is not a commit in this repo." >&2; exit 4; }
    LABEL="commit-${SHA}" ;;
  uncommitted)
    SHA="$HEAD_SHA"; LABEL="${BRANCH//\//-}-${SHA}-uncommitted" ;;
  *)
    SHA="$HEAD_SHA"; BASE_LABEL="${TARGET_BASE:-main}"
    LABEL="${BRANCH//\//-}-vs-${BASE_LABEL//\//-}-${SHA}" ;;
esac
LABEL="$(printf '%s' "$LABEL" | tr -c 'A-Za-z0-9._-' '_')"
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
