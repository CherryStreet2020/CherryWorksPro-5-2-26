#!/usr/bin/env bash
#
# The post-roll deploy gate. Lives here rather than inline in deploy-azure.yml
# because GitHub Actions caps a single `run:` expression at 21,000 characters and
# this script outgrew it — the dispatch failed with
#   "Exceeded max expression length 21000".
#
# Every input arrives as an environment variable set by the workflow step, so the
# script is runnable by hand for debugging:
#   RG=cwp-rg APP=cwp-app IMAGE_REPO=cwp ACR=cwpacr LOGIN=cwpacr.azurecr.io \
#   ACA_EXT_VERSION=1.0.0b4 SHA=$(git rev-parse HEAD) ROLLBACK= REHEARSAL= \
#   MAINT_TOKEN=… EXPECTED_FINGERPRINTS=… bash scripts/azure/deploy_gate.sh
#
set -euo pipefail

az config set extension.use_dynamic_install=no
az extension add --name containerapp --version "$ACA_EXT_VERSION" --upgrade

# PRECONDITION. This workflow ROLLS an existing app; it never creates
# one. Distinguish "not there" from "not allowed to look" — reporting
# an authorization failure as a missing app sends the operator hunting
# for entirely the wrong thing.
if ! SHOW_ERR=$(az containerapp show -n "$APP" -g "$RG" -o none 2>&1); then
  if printf '%s' "$SHOW_ERR" | grep -qiE "AuthorizationFailed|does not have authorization|Forbidden|LinkedAuthorizationFailed"; then
    echo "::error::Container App '$APP' could NOT BE READ — an AUTHORIZATION failure, not a missing app. The deploy identity is missing its role assignment on the app."
    echo "Fix: re-run scripts/azure/provision_cwp.sh; the app-scoped grant is deferred until the app exists, so it is easy to miss."
  else
    echo "::error::Container App '$APP' does not exist in '$RG'. This workflow only rolls an existing app."
    echo "EXPECTED until the migration runbook's Phase 8 has run. Failing red rather than skipping is deliberate."
    echo "Create it: bash scripts/azure/deploy_cwp.sh <tag>"
  fi
  echo "az said: ${SHOW_ERR:-<no output>}"
  exit 1
fi

PREV=$(az containerapp show -n "$APP" -g "$RG" --query properties.latestReadyRevisionName -o tsv)
PREV_LATEST=$(az containerapp show -n "$APP" -g "$RG" --query properties.latestRevisionName -o tsv)
PREV_IMG=$(az containerapp revision show -n "$APP" -g "$RG" --revision "$PREV" \
  --query properties.template.containers[0].image -o tsv 2>/dev/null || true)
echo "current live revision: $PREV ($PREV_IMG)"

# The gate's traffic reasoning ASSUMES single-revision mode. csaa sets
# Single at create and never re-asserts it; assert it before rolling.
MODE=$(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.activeRevisionsMode -o tsv)
[ "$MODE" = "Single" ] \
  || { echo "::error::activeRevisionsMode is '$MODE', not Single — this gate assumes Single"; exit 1; }

if [ -n "$ROLLBACK" ]; then
  case "$ROLLBACK" in
    sha256:*) REF="$LOGIN/$IMAGE_REPO@$ROLLBACK" ;;
    *)        REF="$LOGIN/$IMAGE_REPO:$ROLLBACK" ;;
  esac
else
  # -g scopes the registry lookup so a resource-scoped identity
  # authorizes it. --no-logs is REQUIRED: az acr build streams logs to
  # stdout by default, so -o json would capture log text instead of
  # the Run object.
  # VITE_* are inlined into the client bundle at BUILD time. They must be
  # passed HERE; setting them on the Container App does nothing. Omitting
  # VITE_EMAIL_OAUTH_ENABLED silently hides the connect-mailbox UI.
  BUILD=$(az acr build -r "$ACR" -g "$RG" -t "$IMAGE_REPO:$SHA" \
    --build-arg "GIT_COMMIT_SHA=$SHA" \
    --build-arg "VITE_EMAIL_OAUTH_ENABLED=true" \
    --build-arg "VITE_MARKETING_OS_ENABLED=true" \
    --no-logs -o json .)
  DIGEST=$(echo "$BUILD" | jq -r '.outputImages[0].digest // empty')
  case "$DIGEST" in
    sha256:*) : ;;
    *) echo "::error::az acr build did not return a sha256 digest"; exit 1 ;;
  esac
  REF="$LOGIN/$IMAGE_REPO@$DIGEST"
fi
echo "rolling to: $REF"

# A PREVIOUS ROLLBACK LEAVES SKIP_DB_PUSH=1 BEHIND. The rollback path sets
# it so an older image cannot run `push --force` and drop newer columns —
# but nothing ever cleared it, and the forward path only changes --image.
# Left in place it would make EVERY subsequent deploy silently skip its
# schema step: the release goes green, the migration never runs, and no
# assertion below can see it. Clear it on the way forward, and assert its
# absence after the roll.
if [ -z "$ROLLBACK" ]; then
  if az containerapp show -n "$APP" -g "$RG" \
       --query "properties.template.containers[0].env[?name=='SKIP_DB_PUSH'] | length(@)" -o tsv 2>/dev/null | grep -q '^[1-9]'; then
    echo "::warning::SKIP_DB_PUSH is set (left by an earlier rollback) — removing it so this deploy applies its schema"
    az containerapp update -n "$APP" -g "$RG" --remove-env-vars SKIP_DB_PUSH >/dev/null
  fi
fi

# --image ONLY. Nothing else on this command.
NEW=$(az containerapp update -n "$APP" -g "$RG" --image "$REF" \
  --query properties.latestRevisionName -o tsv)
echo "new revision: $NEW"

# ---------------- LOAD-BEARING POST-ROLL GATE ----------------
#
# ROLLBACK MUST NOT DESTROY DATA. `--image $PREV_IMG` boots the OLD
# image carrying the OLD shared/schema.ts, and the entrypoint runs
# `drizzle-kit push --force`, which converges by DROPPING — so a plain
# image rollback would ALTER TABLE ... DROP COLUMN every column the new
# release added, unattended, and report a successful rollback.
# Hence SKIP_DB_PUSH=1 on the restore. This is the ONE audited use of
# --set-env-vars in this file; because that flag can re-derive parts of
# the template, the restore RE-ASSERTS the secretRef bindings
# afterwards rather than trusting it.
rollback_and_fail() {
  echo "::error::$1"
  # Never restore the bootstrap image. deploy_cwp.sh creates the app on
  # mcr.microsoft.com/k8se/quickstart while the identity and registry
  # binding are sorted out; if a first deploy failed between create and
  # the real roll, that placeholder IS the "previous good image", and
  # restoring it would serve Microsoft's sample page as the product.
  case "$PREV_IMG" in
    *mcr.microsoft.com/k8se/quickstart*)
      echo "::error::previous image is the BOOTSTRAP placeholder ($PREV_IMG) — refusing to roll back onto it. Fix forward, or dispatch a known-good image_tag."
      PREV_IMG="" ;;
  esac
  if [ -z "$ROLLBACK" ] && [ -n "$PREV_IMG" ] && [ "$PREV_IMG" != "$REF" ]; then
    echo "::warning::restoring prod to the previous good image $PREV_IMG (with SKIP_DB_PUSH=1 so the older schema cannot drop newer columns)"
    if az containerapp update -n "$APP" -g "$RG" --image "$PREV_IMG" --set-env-vars SKIP_DB_PUSH=1 >/dev/null; then
      RB_OK=false
      for _ in $(seq 1 40); do
        RB=$(az containerapp show -n "$APP" -g "$RG" --query properties.latestReadyRevisionName -o tsv 2>/dev/null || true)
        RB_IMG=$(az containerapp revision show -n "$APP" -g "$RG" --revision "$RB" \
          --query properties.template.containers[0].image -o tsv 2>/dev/null || true)
        if [ "$RB_IMG" = "$PREV_IMG" ]; then echo "::warning::rolled back to $PREV_IMG (rev $RB)"; RB_OK=true; break; fi
        sleep 15
      done
      if [ "$RB_OK" = true ]; then
        # --set-env-vars can re-derive template fragments. Verify the
        # restore did not cost us a secret binding, rather than
        # assuming it didn't.
        RB_T=$(az containerapp revision show -n "$APP" -g "$RG" --revision "$RB" -o json 2>/dev/null || echo '{}')
        MISSING=""
        for n in DATABASE_URL SESSION_SECRET BANKING_ENCRYPTION_KEY SMTP_ENCRYPTION_KEY BACKUP_ENCRYPTION_KEY STRIPE_SECRET_KEY; do
          echo "$RB_T" | jq -e --arg n "$n" '[.properties.template.containers[0].env[]? | select(.name==$n) | .secretRef] | map(select(. != null)) | length > 0' >/dev/null 2>&1 \
            || MISSING="$MISSING $n"
        done
        [ -z "$MISSING" ] \
          && echo "::warning::post-rollback secretRef bindings intact" \
          || echo "::error::THE ROLLBACK DROPPED secretRef BINDINGS FOR:$MISSING — re-apply the template with scripts/azure/deploy_cwp.sh IMMEDIATELY; those lanes are dark behind a running app"
      else
        echo "::error::ROLLBACK submitted but the restored revision never confirmed Ready on $PREV_IMG — prod may still be on the bad revision"
      fi
      echo "::warning::HONEST CAVEAT: an image rollback restores the IMAGE ONLY. It does nothing about a dropped probe or an unbound secretRef (re-apply with scripts/azure/deploy_cwp.sh), and NOTHING about schema changes already applied by the failed release — the recovery for those is an Azure Postgres point-in-time restore."
    else
      echo "::error::AUTOMATIC ROLLBACK FAILED to submit — prod may be serving the bad revision"
    fi
  elif [ -n "$ROLLBACK" ]; then
    echo "::error::manual rollback to $REF failed its post-roll checks; prod is on $REF (NOT auto-restored — that would re-deploy the image you are escaping)."
  else
    echo "::error::NO automatic rollback attempted (no distinct previous image captured); prod may be serving the bad revision"
  fi
  exit 1
}

diagnose() {
  echo "── revisions (newest first) ─────────────────────────────"
  # Deliberately NOT `az containerapp logs show`: that needs
  # Microsoft.App/managedEnvironments/read, which the deploy identity
  # lacks by design. These three are permission-independent.
  az containerapp revision list -n "$APP" -g "$RG" \
    --query "reverse(sort_by([].{rev:name,active:properties.active,state:properties.provisioningState,health:properties.healthState,replicas:properties.replicas,created:properties.createdTime}, &created))" \
    -o table || echo "  (revision list unavailable)"
  # Select the failed revision BY IMAGE, not by recency.
  echo "── replicas on the revision serving $REF ────────────────"
  BAD=$(az containerapp revision list -n "$APP" -g "$RG" \
    --query "[?properties.template.containers[0].image=='$REF'].name | [0]" -o tsv 2>/dev/null || true)
  [ -n "$BAD" ] && az containerapp replica list -n "$APP" -g "$RG" --revision "$BAD" -o table 2>/dev/null || echo "  (no replica detail available)"
}

# ASSERTION 1 — latestRevisionName actually CHANGED.
[ "$NEW" != "$PREV_LATEST" ] \
  || rollback_and_fail "latestRevisionName did not change from $PREV_LATEST — the roll was a silent no-op"

# ASSERTION 2 — the new revision reports Ready (40 x 15s = 10 min).
READY=""
for _ in $(seq 1 40); do
  READY=$(az containerapp show -n "$APP" -g "$RG" --query properties.latestReadyRevisionName -o tsv 2>/dev/null || true)
  if [ "$READY" = "$NEW" ]; then break; fi
  sleep 15
done
if [ "$READY" != "$NEW" ]; then
  diagnose
  rollback_and_fail "new revision $NEW did not report Ready within the 10-minute budget. NOT asserting prod is untouched — a revision that goes Ready just past the budget takes 100% of traffic, so the image is being rolled back rather than assumed harmless."
fi

T=$(az containerapp revision show -n "$APP" -g "$RG" --revision "$NEW" -o json) \
  || rollback_and_fail "could not read revision $NEW after the roll — the gate cannot verify what is serving"

# ASSERTION 3 — healthy Running* (ACA reports RunningAtMaxScale at max).
echo "$T" | jq -e '(.properties.runningState // "") | startswith("Running")' >/dev/null \
  || rollback_and_fail "revision $NEW runningState is not a healthy Running* state"

# ASSERTION 4 — serving the exact digest we rolled (catches a silent no-op).
echo "$T" | jq -e --arg ref "$REF" '.properties.template.containers[0].image==$ref' >/dev/null \
  || rollback_and_fail "revision $NEW is not serving the rolled image $REF (silent no-op roll)"

# ASSERTION 5 — secret-backed env asserted by BINDING, not by name. A
# name-only check false-greens the case that actually happens: the
# entry survives but .secretRef is dropped, leaving an empty literal.
# The app boots fine and fails silently.
for pair in \
  "DATABASE_URL:database-url" \
  "SESSION_SECRET:session-secret" \
  "BANKING_ENCRYPTION_KEY:banking-encryption-key" \
  "SMTP_ENCRYPTION_KEY:smtp-encryption-key" \
  "BACKUP_ENCRYPTION_KEY:backup-encryption-key" \
  "SMTP_PASS:smtp-pass" \
  "STRIPE_SECRET_KEY:stripe-secret-key" \
  "STRIPE_WEBHOOK_SECRET:stripe-webhook-secret" \
  "MS_OAUTH_CLIENT_SECRET:ms-oauth-client-secret" \
  "INTERNAL_MAINTENANCE_TOKEN:internal-maintenance-token"; do
  NAME="${pair%%:*}"; SECRET="${pair##*:}"
  echo "$T" | jq -e --arg n "$NAME" --arg s "$SECRET" \
    '[.properties.template.containers[0].env[] | select(.name==$n) | .secretRef] | index($s)' >/dev/null \
    || rollback_and_fail "env $NAME is missing or no longer bound to the '$SECRET' secret — that lane would go dark SILENTLY behind a green deploy"
done

# ASSERTION 6 — plain env present.
echo "$T" | jq -e '[.properties.template.containers[0].env[].name]
       | (index("BASE_URL") and index("APP_BASE_URL") and index("NODE_ENV")
          and index("SKIP_STARTUP_MIGRATIONS") and index("OBJECT_STORAGE_DRIVER")
          and index("AZURE_STORAGE_BLOB_ENDPOINT")
          and index("PUBLIC_OBJECT_SEARCH_PATHS") and index("PRIVATE_OBJECT_DIR"))' >/dev/null \
  || rollback_and_fail "a required plain env var was dropped by the roll"

# ASSERTION 7 — VALUES, not presence, for the two that fail dangerously.
#
# SKIP_STARTUP_MIGRATIONS: server/index.ts:203-209 treats '', '0',
# 'false', 'no' and 'off' as FALSE — all of which pass a presence
# check and would run the destructive boot-migration path.
echo "$T" | jq -e '[.properties.template.containers[0].env[] | select(.name=="SKIP_STARTUP_MIGRATIONS") | .value] | index("1")' >/dev/null \
  || rollback_and_fail "SKIP_STARTUP_MIGRATIONS is not exactly '1' — any falsey value passes a presence check and runs the destructive boot-migration path against the production books"
# NODE_ENV: server/db.ts trims and lowercases while
# server/routes/middleware.ts compares exactly, so 'production ' with a
# trailing space yields database TLS enforcement together with NO CSP,
# NO HSTS, insecure cookies and stack traces in 500s.
echo "$T" | jq -e '[.properties.template.containers[0].env[] | select(.name=="NODE_ENV") | .value] | index("production")' >/dev/null \
  || rollback_and_fail "NODE_ENV is not exactly 'production' (a trailing space yields TLS on but CSP/HSTS off, insecure cookies and stack traces in 500s)"

# ASSERTION 7b — SKIP_DB_PUSH must be ABSENT on a forward deploy. If it
# survives, the entrypoint bypasses `drizzle-kit push` entirely and the
# release ships with its schema change silently unapplied.
if [ -z "$ROLLBACK" ]; then
  echo "$T" | jq -e '[.properties.template.containers[0].env[]? | select(.name=="SKIP_DB_PUSH")] | length == 0' >/dev/null \
    || rollback_and_fail "SKIP_DB_PUSH is still set on a forward deploy — the schema step was BYPASSED and this release shipped without its migration"
fi

# ASSERTION 8 — both volume mounts. The re-derivation that dropped
# cherryeam's mounts and lost live upload data is demonstrated on this
# subscription, and a dropped mount is SILENT: /api/public/healthz?deep
# only checks the directory exists, which an empty ephemeral mount
# satisfies.
echo "$T" | jq -e '[.properties.template.containers[0].volumeMounts[]?.mountPath] | sort == ["/app/backups","/app/uploads"]' >/dev/null \
  || rollback_and_fail "the /app/uploads and /app/backups volume mounts are not both present — uploads and the app's own backups would silently write to an ephemeral filesystem destroyed on the next roll"

# ASSERTION 9 — replica bounds. BOTH are load-bearing: the entrypoint
# runs push --force, and ACA brings a new revision up BEFORE draining
# the old, so >1 replica means concurrent DDL.
echo "$T" | jq -e '(.properties.template.scale.minReplicas==1) and (.properties.template.scale.maxReplicas==1)' >/dev/null \
  || rollback_and_fail "scale is not pinned to exactly 1/1 — concurrent replicas would run schema DDL against each other, and scale-to-zero would stop the sixteen in-process schedulers"

# ASSERTION 10 — probes survived the roll.
echo "$T" | jq -e '(.properties.template.containers[0].probes // []) | length >= 3' >/dev/null \
  || rollback_and_fail "health probes dropped by the roll — re-apply with scripts/azure/deploy_cwp.sh"

# ASSERTION 11 — identity and ingress port.
az containerapp show -n "$APP" -g "$RG" \
  --query '{id:identity.type, port:properties.configuration.ingress.targetPort}' -o json \
  | jq -e '(.id|test("SystemAssigned")) and (.port==8080)' >/dev/null \
  || rollback_and_fail "system identity or ingress targetPort regressed"

FQDN=$(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv) \
  || rollback_and_fail "could not read the ingress FQDN — the roll is unverified"

# ASSERTION 12 — ANTI-VACUOUS READINESS. FOUR conditions satisfied by
# ONE response. Two separate curls can be routed to two different
# revisions and green a combination that never existed. `database` is
# the only thing in this pipeline that can prove the app is talking to
# the real database rather than the rehearsal copy.
# The expected database name defaults to production and must be opted OUT
# of explicitly, per run. It is not a repo variable on purpose: a variable
# left set to the rehearsal value would silently disarm the single check
# that proves the app is not talking to the practice copy.
WANT_DB="cwp"
if [ "${REHEARSAL:-}" = "REHEARSAL" ]; then
  WANT_DB="cwp_rehearsal"
  echo "::warning::REHEARSAL MODE — accepting database '$WANT_DB'. This must NEVER be used once the app serves cherryworkspro.com."
fi
echo "expecting database: $WANT_DB"
# The single quotes are deliberate: $c, $r and $db are jq variables bound
# by --arg below, NOT shell variables. Expanding them here would inline the
# values into the filter and break the comparison. This directive must stay
# DIRECTLY above the if — shellcheck applies it to the next command, so any
# comment or statement inserted between the two silently un-suppresses it.
# shellcheck disable=SC2016
if [ -n "$ROLLBACK" ]; then
  READY_FILTER='.status=="Healthy" and .revision==$r and .database==$db'
else
  READY_FILTER='.status=="Healthy" and .commit==$c and .revision==$r and .database==$db'
fi
READY_OK=false
READY_BODY=""
for _ in $(seq 1 24); do
  READY_BODY=$(curl -fsS --max-time 20 -H "x-internal-maintenance-token: ${MAINT_TOKEN}" \
    "https://$FQDN/api/readyz" 2>/dev/null || true)
  if [ -n "$READY_BODY" ] \
     && echo "$READY_BODY" | jq -e --arg c "$SHA" --arg r "$NEW" --arg db "$WANT_DB" "$READY_FILTER" >/dev/null 2>&1; then
    READY_OK=true; break
  fi
  sleep 10
done
[ "$READY_OK" = true ] \
  || rollback_and_fail "/api/readyz never reported Healthy with commit=$SHA revision=$NEW database=$WANT_DB in a single response (unreachable database, wrong database, or only the old revision answered)"

# ASSERTION 13 — the four key fingerprints match the last known-good
# deploy. A wrong BANKING_ or SMTP_ENCRYPTION_KEY makes stored data
# permanently unreadable and NOTHING else in this pipeline would catch
# it. Set the EXPECTED_KEY_FINGERPRINTS repo variable to the JSON
# object from a known-good deploy to arm this.
FPS=$(echo "$READY_BODY" | jq -c '.keyFingerprints')
echo "key fingerprints: $FPS"
echo "$READY_BODY" | jq -e '[.keyFingerprints | to_entries[] | select(.value==null)] | length == 0' >/dev/null \
  || rollback_and_fail "one or more encryption-key fingerprints are null — a key is unset behind a running app: $FPS"
if [ -n "${EXPECTED_FINGERPRINTS:-}" ]; then
  echo "$FPS" | jq -e --argjson want "$EXPECTED_FINGERPRINTS" '. == $want' >/dev/null \
    || rollback_and_fail "encryption-key fingerprints CHANGED from the known-good set. Stored SMTP passwords, OAuth refresh tokens and banking details were encrypted under the old keys and would become unreadable. got=$FPS want=$EXPECTED_FINGERPRINTS"
  echo "key fingerprints match the known-good set"
else
  echo "::warning::EXPECTED_KEY_FINGERPRINTS repo variable is not set — fingerprints recorded but NOT compared. Set it to: $FPS"
fi

# ASSERTION 14 — content gate. /api/readyz proves the process is up and
# talking to the database; it says nothing about whether the app shell
# actually shipped. If dist/public failed to ship, every check above
# still passes while the site serves nothing.
HOME_HTML=$(curl -fsS --max-time 20 "https://$FQDN/" 2>/dev/null || true)
printf '%s' "$HOME_HTML" | grep -qi '<div id="root"' \
  || rollback_and_fail "the homepage did not serve the app shell — dist/public is missing, so the site is blank ($(printf '%s' "$HOME_HTML" | wc -c) bytes received)"

# Re-tag the digest as last-known-good so a rollback reference never
# has to be recovered from a scrolled-away step summary. Best-effort:
# a tagging failure must not fail a verified-good deploy.
if [ -z "$ROLLBACK" ]; then
  az acr import --name "$ACR" --source "$LOGIN/$IMAGE_REPO@$DIGEST" \
    --image "$IMAGE_REPO:last-known-good" --force >/dev/null 2>&1 \
    && echo "tagged $DIGEST as last-known-good" \
    || echo "::warning::could not re-tag last-known-good (deploy is still verified good; use the digest below)"
fi

{
  echo "### deploy-azure ✅"
  echo "- image: \`$REF\`"
  echo "- new revision: \`$NEW\`"
  echo "- previous revision: \`$PREV\`"
  echo "- verified in ONE /api/readyz response: Healthy, commit \`$SHA\`, revision \`$NEW\`, database \`cwp\`"
  echo "- key fingerprints: \`$FPS\`"
  echo ""
  echo "Roll back without a rebuild: Actions → deploy-azure → Run workflow, confirm \`DEPLOY\`, \`image_tag\` = the digest above or \`last-known-good\`."
  echo ""
  echo "⚠️ A rollback restores the IMAGE only. Schema changes already applied are NOT undone — that recovery is an Azure Postgres point-in-time restore."
} >> "$GITHUB_STEP_SUMMARY"
