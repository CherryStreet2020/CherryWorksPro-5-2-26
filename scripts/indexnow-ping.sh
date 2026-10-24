#!/usr/bin/env bash
#
# Post-deploy IndexNow ping: tell Bing (and the other IndexNow members — Yandex,
# Seznam, Naver, Yep; NOT Google, which does not take part) that every URL in the
# live sitemap may have changed, so a redeployed page is recrawled in hours
# instead of whenever the crawler next wanders by.
#
# Runs as the last step of deploy-azure.yml, AFTER deploy_gate.sh has verified
# the new revision. It NEVER FAILS THE DEPLOY: by then the release is verified
# and serving, and an IndexNow outage or refusal must not paint a good deploy
# red. Every failure is a ::warning:: and the script exits 0.
#
# Everything it sends is read back from the LIVE site, not from the checkout:
# the key file must already be served (IndexNow fetches it to check ownership,
# and answers 403 if it is missing), and the URL list is the sitemap the new
# revision actually serves.
#
# Runnable by hand:
#   bash scripts/indexnow-ping.sh             # real ping
#   DRY_RUN=1 bash scripts/indexnow-ping.sh   # print the request body, send nothing
# FETCH_FROM points the key/sitemap reads at another server (tests use a local
# one); ORIGIN stays the canonical site the submission is for.
#
set -uo pipefail

ORIGIN="${ORIGIN:-https://cherryworkspro.com}"
FETCH_FROM="${FETCH_FROM:-$ORIGIN}"
ENDPOINT="${INDEXNOW_ENDPOINT:-https://api.indexnow.org/indexnow}"
HOST="${ORIGIN#*://}"
KEY_FILE="$(cd "$(dirname "$0")/.." && pwd)/shared/indexnow.ts"

skip() {
  echo "::warning::IndexNow ping skipped — $* (the deploy itself is unaffected)"
  exit 0
}

KEY=$(sed -nE 's/^export const INDEXNOW_KEY = "([A-Za-z0-9-]{8,128})";$/\1/p' "$KEY_FILE")
[ -n "$KEY" ] || skip "no INDEXNOW_KEY line in $KEY_FILE"

# The new revision took 100% of traffic before the gate passed, but give the
# custom domain a few tries rather than skip on one slow answer.
SERVED=""
for _ in 1 2 3; do
  SERVED=$(curl -fsS --max-time 20 "$FETCH_FROM/$KEY.txt" 2>/dev/null) && break
  sleep 5
done
[ "$SERVED" = "$KEY" ] \
  || skip "$FETCH_FROM/$KEY.txt does not serve the key, so IndexNow would refuse ownership (403)"

SITEMAP=$(curl -fsS --max-time 20 "$FETCH_FROM/sitemap.xml" 2>/dev/null) \
  || skip "could not fetch $FETCH_FROM/sitemap.xml"
# Only the canonical host's URLs: IndexNow rejects the WHOLE batch (422) if one
# URL is for another host. 10,000 is the protocol's per-request cap.
URLS=$(printf '%s' "$SITEMAP" | grep -oE '<loc>[^<]+</loc>' | sed -E 's#</?loc>##g; s/&amp;/\&/g' \
  | awk -v o="$ORIGIN" '$0 == o || index($0, o "/") == 1' | head -n 10000)
[ -n "$URLS" ] || skip "the sitemap at $FETCH_FROM/sitemap.xml lists no $ORIGIN URLs"
COUNT=$(printf '%s\n' "$URLS" | wc -l | tr -d ' ')

BODY=$(printf '%s\n' "$URLS" | jq -R . | jq -sc --arg host "$HOST" --arg key "$KEY" --arg loc "$ORIGIN/$KEY.txt" \
  '{host: $host, key: $key, keyLocation: $loc, urlList: .}') \
  || skip "could not build the request body"

if [ -n "${DRY_RUN:-}" ]; then
  echo "$BODY"
  exit 0
fi

RESP_FILE=$(mktemp)
CODE=$(curl -sS --max-time 30 -o "$RESP_FILE" -w '%{http_code}' \
  -H 'Content-Type: application/json; charset=utf-8' --data "$BODY" "$ENDPOINT" 2>/dev/null)
RESP=$(head -c 500 "$RESP_FILE"); rm -f "$RESP_FILE"

case "$CODE" in
  200|202)
    echo "IndexNow accepted $COUNT URL(s) for $HOST (HTTP $CODE)"
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] \
      && echo "- IndexNow: $COUNT sitemap URL(s) submitted for \`$HOST\` (HTTP $CODE)" >> "$GITHUB_STEP_SUMMARY"
    exit 0 ;;
  400) skip "IndexNow said 400 Bad Request (malformed body): $RESP" ;;
  403) skip "IndexNow said 403 (key not valid — it could not read $ORIGIN/$KEY.txt): $RESP" ;;
  422) skip "IndexNow said 422 (a URL is not on $HOST, or the key does not match): $RESP" ;;
  429) skip "IndexNow said 429 Too Many Requests — likely too many deploys today: $RESP" ;;
  *)   skip "IndexNow answered HTTP ${CODE:-none}: ${RESP:-<no body>}" ;;
esac
