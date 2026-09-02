#!/usr/bin/env bash
#
# Create or update the cwp-app Container App.
#
# NEVER `az containerapp up`, NEVER `--yaml`. Both re-derive the entire template
# from their inputs and silently drop anything set out of band — secrets,
# secretref env vars, probes and VOLUME MOUNTS above all. CWP sets DATABASE_URL,
# both encryption keys, the Stripe keys and the OAuth client secrets out of band,
# so a single `up` would take invoicing, payments and email down at once, and
# drop the mounts under which uploads and the app's own backups live.
#
# ── WHY single-revision AND max-replicas 1 ────────────────────────────────────
# BOTH are load-bearing and neither may be raised.
#   * The entrypoint runs `drizzle-kit push --force` on every boot, and ACA
#     brings a NEW revision up BEFORE draining the old one — so the replica cap
#     alone does not remove the overlap, and single-revision mode alone does not
#     either. Together with button-only deploys they bound the exposure.
#   * The gate's traffic reasoning assumes single-revision: ACA shifts 100% of
#     traffic to the latest Ready revision, which is what lets the workflow
#     assert "the commit I built is the commit being served".
# min-replicas is 1 and NEVER 0: sixteen schedulers run as in-process timers, so
# scaling to zero silently stops reminders, marketing sends and every sweep.
#
# ── WHY the probe paths differ ────────────────────────────────────────────────
# Startup and readiness use /api/readyz (real Postgres round-trip plus the
# schema-push marker). Liveness uses /api/healthz, which touches NOTHING.
# Liveness RESTARTS the container, so pointing it at a DB-dependent check would
# turn a recoverable database incident into an infinite restart loop.
#
# ── ROLE ASSIGNMENTS ARE NOT PERFORMED HERE ───────────────────────────────────
# For CherryWorks Pro the standing rule is that Dean performs IAM changes
# himself. This script CHECKS each grant and fails closed with the exact command
# if one is missing, rather than creating it.

set -euo pipefail

RG="cwp-rg"
APP="cwp-app"
ENV_NAME="cwp-env"
ACR="cwpacr"
STORAGE="cwpstore26"
IMAGE_TAG="${1:?usage: deploy_cwp.sh <image-tag-or-sha256-digest>}"

case "$IMAGE_TAG" in
  sha256:*) IMAGE="${ACR}.azurecr.io/cwp@${IMAGE_TAG}" ;;
  *)        IMAGE="${ACR}.azurecr.io/cwp:${IMAGE_TAG}" ;;
esac

log()  { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()   { echo "  ✓ $*"; }
die()  { echo -e "\nERROR: $*" >&2; exit 1; }

log "Target image: $IMAGE"

if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then MODE="update"; else MODE="create"; fi
ok "mode: $MODE"

# ── Environment storage must exist BEFORE the app can mount it ────────────────
# `az containerapp env storage set` requires --azure-file-account-key, a static
# account key, because it is not identity-capable in the pinned extension. That
# key is a Dean-handled secret, so this script checks and instructs.
log "Azure Files shares on the environment"
for share in uploads backups; do
  if az containerapp env storage show -n "$ENV_NAME" -g "$RG" --storage-name "$share" >/dev/null 2>&1; then
    ok "env storage '$share' present"
  else
    die "environment storage '$share' is not defined on $ENV_NAME.
       A Container Apps filesystem is DESTROYED on every revision roll, so
       without these two mounts every uploaded receipt, avatar and logo — and
       every encrypted backup the app takes — is lost on the next deploy, while
       the database still holds rows pointing at them.

       Dean runs (needs the storage account key):
         KEY=\$(az storage account keys list -n $STORAGE -g $RG --query '[0].value' -o tsv)
         az containerapp env storage set -n $ENV_NAME -g $RG \\
           --storage-name $share --azure-file-account-name $STORAGE \\
           --azure-file-account-key \"\$KEY\" --azure-file-share-name $share \\
           --access-mode ReadWrite"
  fi
done

if [ "$MODE" = "create" ]; then
  log "Creating $APP on the public bootstrap image"
  # CHICKEN-AND-EGG: the app pulls from an ACR with the admin user DISABLED, so
  # the only way in is its system-assigned identity — which does not EXIST until
  # this create returns and cannot hold AcrPull until after that. Creating
  # straight onto the private image starts a revision that cannot pull it.
  # So create on Microsoft's public quickstart image, sort out identity and the
  # registry binding, then roll to the real image at the bottom.
  az containerapp create \
    --name "$APP" --resource-group "$RG" --environment "$ENV_NAME" \
    --image mcr.microsoft.com/k8se/quickstart:latest \
    --target-port 8080 --ingress external --transport auto \
    --min-replicas 1 --max-replicas 1 \
    --revisions-mode single \
    --cpu 1.0 --memory 2.0Gi \
    --system-assigned \
    -o none
  ok "created on the bootstrap image (1 vCPU / 2 GiB, single revision, 1/1 replicas)"
else
  log "Updating image on $APP"
  # --image ONLY. Nothing else on this command — see the file header.
  az containerapp update -n "$APP" -g "$RG" --image "$IMAGE" -o none
  ok "image updated"
fi

# ── Registry access — CHECKED in both modes, never granted here ───────────────
log "Registry access for the app identity"
APP_PRINCIPAL=$(az containerapp show -n "$APP" -g "$RG" --query identity.principalId -o tsv)
ACR_ID=$(az acr show -n "$ACR" --query id -o tsv)
ok "app principalId = $APP_PRINCIPAL"

if az role assignment list --assignee "$APP_PRINCIPAL" --scope "$ACR_ID" \
     --query "[?roleDefinitionName=='AcrPull'] | length(@)" -o tsv 2>/dev/null | grep -q '^[1-9]'; then
  ok "AcrPull already assigned to the app identity"
else
  die "the app identity does NOT hold AcrPull on $ACR, so it cannot pull its own image.
       Role assignments are Dean's to perform on this project.

       Portal: https://portal.azure.com/#blade/Microsoft_Azure_IAM/… -> $ACR -> Access control (IAM)
       Or:
         az role assignment create --assignee-object-id $APP_PRINCIPAL \\
           --assignee-principal-type ServicePrincipal \\
           --role AcrPull --scope $ACR_ID

       Then re-run this script — it is convergent and will pick up from here."
fi

# Check BEFORE setting. `az containerapp registry set` is a containerApps WRITE,
# and ARM requires 'Microsoft.App/managedEnvironments/join/action' on the LINKED
# environment for that write — a permission the deploy identity does not hold.
# On an already-bound app the unconditional call fails the whole deploy with
# LinkedAuthorizationFailed. That is what killed the csaa deploy on 2026-07-27,
# AFTER the image update had already succeeded.
#
# THREE states, not two. On a freshly created app `registry list` exits 0 with an
# EMPTY body; treating that parse failure as "unbound" would send us straight
# into the privileged write this guard exists to avoid.
#   exit 0 -> bound     exit 1 -> genuinely unbound     exit 2 -> unreadable
REGISTRY_STATE="unknown"
if REGISTRY_JSON=$(az containerapp registry list -n "$APP" -g "$RG" -o json 2>/dev/null); then
  set +e
  printf '%s' "$REGISTRY_JSON" | python3 -c "
import json,sys
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(2)
try:
    rs = json.loads(raw) or []
except ValueError:
    sys.exit(2)
sys.exit(0 if any(r.get('server')=='${ACR}.azurecr.io' and r.get('identity')=='system' for r in rs) else 1)
" 2>/dev/null
  case $? in
    0) REGISTRY_STATE="bound" ;;
    1) REGISTRY_STATE="unbound" ;;
    *) REGISTRY_STATE="unknown" ;;
  esac
  set -e
fi

if [ "$REGISTRY_STATE" = "bound" ]; then
  ok "registry already bound to the system identity (skipping the privileged write)"
elif [ "$REGISTRY_STATE" = "unknown" ] && [ "$MODE" = "update" ]; then
  echo "  ! could not read the registry binding; the app already exists and pulls" >&2
  echo "    its image, so leaving the existing binding alone." >&2
elif az containerapp registry set -n "$APP" -g "$RG" \
       --server "${ACR}.azurecr.io" --identity system -o none; then
  ok "registry bound to the system identity"
else
  die "could not bind ${ACR}.azurecr.io to the app's system identity.
       If this is LinkedAuthorizationFailed, the deploy identity is missing
       'Microsoft.App/managedEnvironments/join/action' on ${ENV_NAME}."
fi

if [ "$MODE" = "create" ]; then
  log "Rolling the bootstrap image to $IMAGE"
  az containerapp update -n "$APP" -g "$RG" --image "$IMAGE" -o none
  ok "rolled to the real image"
fi

# ── Probes AND volume mounts (surgical read-modify-write PATCH) ───────────────
# `az containerapp update` cannot set either, and `--yaml` would re-derive the
# whole template. So READ the live resource, inject into the container we
# already have, and PATCH the result back. Because the body we send is the body
# we just read, nothing set out of band can be dropped — exactly the property
# `up` and `--yaml` fail to provide.
log "Probes and volume mounts (surgical read-modify-write PATCH)"
python3 - "$RG" "$APP" <<'PY'
import json, subprocess, sys

rg, app = sys.argv[1], sys.argv[2]

def az(*args):
    r = subprocess.run(["az", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"az {' '.join(args)} failed:\n{r.stderr}")
    return r.stdout

res_id = az("containerapp", "show", "-n", app, "-g", rg, "--query", "id", "-o", "tsv").strip()
api_ver = "2024-03-01"
live = json.loads(az("rest", "--method", "GET", "--url",
                     f"https://management.azure.com{res_id}?api-version={api_ver}"))

# Startup budget is 30 x 10s = 300s, materially longer than cherrysite's 150s.
# CWP does real work before it serves: the entrypoint takes an advisory lock and
# runs `drizzle-kit push --force` against an 83-table schema on a Burstable
# server that may be waking up.
probes = [
    {"type": "Startup",   "httpGet": {"path": "/api/readyz",  "port": 8080},
     "initialDelaySeconds": 10, "periodSeconds": 10, "timeoutSeconds": 5,  "failureThreshold": 30},
    {"type": "Readiness", "httpGet": {"path": "/api/readyz",  "port": 8080},
     "initialDelaySeconds": 5,  "periodSeconds": 15, "timeoutSeconds": 10, "failureThreshold": 3},
    {"type": "Liveness",  "httpGet": {"path": "/api/healthz", "port": 8080},
     "initialDelaySeconds": 30, "periodSeconds": 30, "timeoutSeconds": 10, "failureThreshold": 5},
]

template = live["properties"]["template"]

# Volumes are declared on the template and mounted on the container. Both halves
# are required; a volume with no mount is silently inert.
volumes = {v.get("name"): v for v in template.get("volumes") or []}
for name, share in (("uploads-vol", "uploads"), ("backups-vol", "backups")):
    volumes[name] = {"name": name, "storageType": "AzureFile", "storageName": share}
template["volumes"] = list(volumes.values())

mounts = {
    "uploads-vol": {"volumeName": "uploads-vol", "mountPath": "/app/uploads"},
    "backups-vol": {"volumeName": "backups-vol", "mountPath": "/app/backups"},
}
for c in template["containers"]:
    c["probes"] = probes
    existing = {m.get("volumeName"): m for m in c.get("volumeMounts") or []}
    existing.update(mounts)
    c["volumeMounts"] = list(existing.values())

body = {"properties": {"template": template}}
with open("/tmp/cwp_template_patch.json", "w") as fh:
    json.dump(body, fh)

az("rest", "--method", "PATCH", "--url",
   f"https://management.azure.com{res_id}?api-version={api_ver}",
   "--headers", "Content-Type=application/json",
   "--body", "@/tmp/cwp_template_patch.json")
print("  ✓ probes + /app/uploads and /app/backups mounts applied")
PY

# The PATCH is ASYNC. Reading once immediately reports the PRE-PATCH state and
# makes a successful change look like a silent failure, so poll.
log "Verifying nothing was dropped by the PATCH"
for i in $(seq 1 30); do
  N=$(az containerapp show -n "$APP" -g "$RG" \
        --query "length(properties.template.containers[0].probes || \`[]\`)" -o tsv 2>/dev/null || echo 0)
  M=$(az containerapp show -n "$APP" -g "$RG" \
        --query "length(properties.template.containers[0].volumeMounts || \`[]\`)" -o tsv 2>/dev/null || echo 0)
  if [ "${N:-0}" -ge 3 ] && [ "${M:-0}" -ge 2 ]; then ok "probes and mounts present after $((i*5))s"; break; fi
  sleep 5
done

az containerapp show -n "$APP" -g "$RG" --query \
  "{revisionMode:properties.configuration.activeRevisionsMode,
    minReplicas:properties.template.scale.minReplicas,
    maxReplicas:properties.template.scale.maxReplicas,
    ingress:properties.configuration.ingress.targetPort,
    probes:length(properties.template.containers[0].probes || \`[]\`),
    mounts:properties.template.containers[0].volumeMounts[].mountPath,
    secrets:length(properties.configuration.secrets || \`[]\`),
    env:length(properties.template.containers[0].env || \`[]\`),
    image:properties.template.containers[0].image}" -o json

FINAL_P=$(az containerapp show -n "$APP" -g "$RG" --query "length(properties.template.containers[0].probes || \`[]\`)" -o tsv)
FINAL_M=$(az containerapp show -n "$APP" -g "$RG" --query "length(properties.template.containers[0].volumeMounts || \`[]\`)" -o tsv)
[ "${FINAL_P:-0}" -ge 3 ] || die "probes were not applied (found ${FINAL_P}); refusing to report success"
[ "${FINAL_M:-0}" -ge 2 ] || die "volume mounts were not applied (found ${FINAL_M}); uploads and backups would write to an ephemeral filesystem destroyed on the next roll"

log "Done — FQDN:"
az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv
