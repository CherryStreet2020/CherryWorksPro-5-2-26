#!/usr/bin/env bash
#
# Provision the CherryWorks Pro estate on Azure Container Apps.
#
# Modelled on scripts/azure/provision_cherrysite.sh and provision_csaa.sh. Same
# subscription, same region, same OIDC-no-stored-secrets posture, same
# resource-group separation. CWP is the FOURTH app in this subscription.
#
# IDEMPOTENT: every step is create-if-absent, so re-running converges rather
# than failing. Safe to re-run after a partial failure.
#
# DELIBERATELY NOT `az containerapp up` AND NOT `--yaml`. Both re-derive the
# whole template from their arguments and silently drop fields set out of band.
#
# SEPARATION: cherryeam-rg, csaa-rg and cherrysite-rg already exist and are not
# touched. One subscription exists in the tenant, so the resource group is the
# available RBAC / lifecycle / cost boundary.
#
# REGION: everything in East US 2, INCLUDING the registry and the database.
# cherryeam's ACR sits in East US while its app is in East US 2 — a cross-region
# image pull on every deploy. csaa corrected that; this follows csaa.
#
# ── FOUR THINGS THIS SCRIPT DELIBERATELY DOES NOT DO ─────────────────────────
#   1. It does not create the Postgres server (choosing an admin password is a
#      human decision).
#   2. It does not set the app's secrets.
#   3. It does not create the Container App (deploy_cwp.sh does, and it needs an
#      image in the registry first).
#   4. It does not perform ROLE ASSIGNMENTS. For CherryWorks Pro the standing
#      rule is that Dean performs IAM changes himself — that rule was retired
#      for Cherry-Consulting-Site ONLY and remains in force here. This script
#      PRINTS the exact commands and the exact values instead.
# The closing summary restates all four. A script that silently omits them looks
# like it built a working estate when it did not.

set -euo pipefail

SUB_ID="e5a6f7c8-fb0a-45af-84fa-1ee18b4b7032"   # CS Azure Sub June26
LOCATION="eastus2"
RG="cwp-rg"
ACR="cwpacr"                                     # ACR names are alphanumeric only
ENV_NAME="cwp-env"
APP="cwp-app"
UAMI="cwp-deploy-uami"
LOG_WS="cwp-logs"

GITHUB_ORG="CherryStreet2020"
GITHUB_REPO="CherryWorksPro-5-2-26"

log() { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()  { echo "  ✓ $*"; }

az account set --subscription "$SUB_ID"
ok "subscription: $(az account show --query name -o tsv)"

# ── Resource group ────────────────────────────────────────────────────────────
log "Resource group $RG"
if az group show -n "$RG" >/dev/null 2>&1; then
  ok "already exists"
else
  az group create -n "$RG" -l "$LOCATION" \
    --tags app=cwp managed-by=provision_cwp.sh \
           separate-from=cherryeam-rg,csaa-rg,cherrysite-rg -o none
  ok "created in $LOCATION"
fi

# ── Container registry ────────────────────────────────────────────────────────
# adminUserEnabled=false ON PURPOSE, matching cherrysiteacr and csaaacr. The app
# pulls with its own system-assigned identity and the workflow pushes with a
# federated credential, so no static registry password exists anywhere to leak.
# (cherryeam's registry still has AdminEnabled=true — acknowledged debt there,
# not a pattern to copy.)
log "Container registry $ACR"
if az acr show -n "$ACR" >/dev/null 2>&1; then
  ok "already exists"
else
  az acr create -n "$ACR" -g "$RG" -l "$LOCATION" --sku Basic \
    --admin-enabled false -o none
  ok "created (Basic, admin DISABLED, $LOCATION)"
fi

# ── Log Analytics ─────────────────────────────────────────────────────────────
log "Log Analytics workspace $LOG_WS"
if az monitor log-analytics workspace show -g "$RG" -n "$LOG_WS" >/dev/null 2>&1; then
  ok "already exists"
else
  az monitor log-analytics workspace create -g "$RG" -n "$LOG_WS" -l "$LOCATION" -o none
  ok "created"
fi
LOG_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LOG_WS" --query customerId -o tsv)
LOG_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LOG_WS" --query primarySharedKey -o tsv)

# ── Container Apps environment ────────────────────────────────────────────────
log "Container Apps environment $ENV_NAME"
if az containerapp env show -n "$ENV_NAME" -g "$RG" >/dev/null 2>&1; then
  ok "already exists"
else
  az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" \
    --logs-workspace-id "$LOG_ID" --logs-workspace-key "$LOG_KEY" -o none
  ok "created"
fi

# ── Deploy identity (user-assigned, for GitHub OIDC) ──────────────────────────
# clientId is what azure/login consumes; principalId is what role assignments
# take. Crossing them fails in ways the error messages do not explain, so both
# are captured and labelled explicitly.
log "Managed identity $UAMI"
if az identity show -n "$UAMI" -g "$RG" >/dev/null 2>&1; then
  ok "already exists"
else
  az identity create -n "$UAMI" -g "$RG" -l "$LOCATION" -o none
  ok "created"
fi
UAMI_CLIENT_ID=$(az identity show -n "$UAMI" -g "$RG" --query clientId -o tsv)
UAMI_PRINCIPAL_ID=$(az identity show -n "$UAMI" -g "$RG" --query principalId -o tsv)
ok "clientId (for azure/login)     = $UAMI_CLIENT_ID"
ok "principalId (for role assign)  = $UAMI_PRINCIPAL_ID"

# ── Federated credentials for GitHub OIDC ─────────────────────────────────────
# --audiences MUST be api://AzureADTokenExchange, stated EXPLICITLY rather than
# relying on a default: az CLI >= 2.74 no longer defaults it, and a federated
# credential with a wrong or empty audience makes every OIDC login fail 70021
# with an error that does not name the audience as the cause.
# The issuer has NO trailing slash — Entra matches iss/sub/aud as case-sensitive
# strings, so a trailing slash silently never matches.
log "Federated credentials (GitHub OIDC)"
add_fic() {
  local name="$1" subject="$2"
  if az identity federated-credential show --identity-name "$UAMI" -g "$RG" -n "$name" >/dev/null 2>&1; then
    ok "$name already exists"
  else
    az identity federated-credential create \
      --identity-name "$UAMI" -g "$RG" -n "$name" \
      --issuer "https://token.actions.githubusercontent.com" \
      --subject "$subject" \
      --audiences "api://AzureADTokenExchange" -o none
    ok "$name created"
  fi
}
add_fic "gh-main"     "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main"
add_fic "gh-env-prod" "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:production"

log "Echo-back verify (Entra matches iss/sub/aud as case-sensitive strings)"
for n in gh-main gh-env-prod; do
  az identity federated-credential show --identity-name "$UAMI" -g "$RG" -n "$n" \
    --query "{name:name, iss:issuer, sub:subject, aud:audiences}" -o json
done

ACR_ID=$(az acr show -n "$ACR" --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
APP_ID=$(az containerapp show -n "$APP" -g "$RG" --query id -o tsv 2>/dev/null || echo "<app does not exist yet>")

cat <<SUMMARY

═══════════════════════════════════════════════════════════════════════
 PROVISIONED
═══════════════════════════════════════════════════════════════════════
 subscription : CS Azure Sub June26 ($SUB_ID)
 resource grp : $RG   (separate from cherryeam-rg, csaa-rg, cherrysite-rg)
 registry     : $ACR.azurecr.io  (Basic, admin DISABLED, $LOCATION)
 environment  : $ENV_NAME
 log analytics: $LOG_WS
 deploy id    : $UAMI
   clientId   : $UAMI_CLIENT_ID   <- AZURE_CLIENT_ID for azure/login
   principalId: $UAMI_PRINCIPAL_ID   <- role assignments ONLY
 tenant       : $TENANT_ID

 ── GitHub repo Variables (none are sensitive, so Variables not Secrets):

   gh variable set AZURE_CLIENT_ID       -R $GITHUB_ORG/$GITHUB_REPO -b "$UAMI_CLIENT_ID"
   gh variable set AZURE_TENANT_ID       -R $GITHUB_ORG/$GITHUB_REPO -b "$TENANT_ID"
   gh variable set AZURE_SUBSCRIPTION_ID -R $GITHUB_ORG/$GITHUB_REPO -b "$SUB_ID"
   gh variable set ACR_NAME              -R $GITHUB_ORG/$GITHUB_REPO -b "$ACR"
   gh variable set ACR_LOGIN_SERVER      -R $GITHUB_ORG/$GITHUB_REPO -b "$ACR.azurecr.io"
   gh variable set ACA_EXT_VERSION       -R $GITHUB_ORG/$GITHUB_REPO -b "<the version proven by the Phase 9 dry roll>"

 ═══════════════════════════════════════════════════════════════════════
 ⚠️  FOUR THINGS THIS SCRIPT DID NOT DO
 ═══════════════════════════════════════════════════════════════════════

 1. ROLE ASSIGNMENTS — Dean performs these. For CherryWorks Pro the standing
    rule ("I grant the permission, but I click it") is still in force; it was
    retired for Cherry-Consulting-Site only. Every scope below is an INDIVIDUAL
    RESOURCE, never the resource group and never the subscription.

    Portal: https://portal.azure.com/#@${TENANT_ID}/resource${ACR_ID}/users
      -> Add role assignment

    (a) AcrPush     on the REGISTRY  to principal $UAMI_PRINCIPAL_ID
    (b) Contributor on the REGISTRY  to principal $UAMI_PRINCIPAL_ID

        AcrPush ALONE IS NOT ENOUGH — proven in a live run on csaa. AcrPush
        grants only DATA actions (pull/push); \`az acr build\` additionally needs
        registries/read to resolve the registry by name and scheduleRun/action
        to queue the build. With AcrPush only, the workflow fails with
        "resource with name '$ACR' could not be found" — an error that reads
        like a missing registry rather than a missing permission.

    (c) Contributor on the CONTAINER APP to principal $UAMI_PRINCIPAL_ID
        Scope: $APP_ID
        DEFERRED until deploy_cwp.sh has created the app. Re-run this script
        afterwards to print the exact scope. Without it the workflow
        authenticates, builds, and only THEN fails at the deploy step.

    Equivalent CLI, if Dean prefers to paste rather than click:
      az role assignment create --assignee-object-id $UAMI_PRINCIPAL_ID \\
        --assignee-principal-type ServicePrincipal --role AcrPush --scope $ACR_ID
      az role assignment create --assignee-object-id $UAMI_PRINCIPAL_ID \\
        --assignee-principal-type ServicePrincipal --role Contributor --scope $ACR_ID

 2. THE POSTGRES SERVER. Choosing an admin password is a human decision, and
    two of its settings CANNOT be changed after creation (geo-redundant backup,
    and public-access mode). Decided for CWP: B2s, 35-day retention,
    geo-redundant ON.

      az postgres flexible-server create -n cwp-pg -g $RG -l $LOCATION \\
        --version 16 --tier Burstable --sku-name Standard_B2s \\
        --storage-size 64 --admin-user cwpadmin --admin-password '<CHOOSE>' \\
        --database-name cwp --backup-retention 35 --geo-redundant-backup Enabled \\
        --public-access 0.0.0.0 --yes

    NOTE --public-access 0.0.0.0, NOT None. \`None\` sets publicNetworkAccess
    Disabled with no delegated subnet: nothing can connect and firewall rules go
    inert. (provision_cherrysite.sh line ~211 still carries the stale \`None\`
    guidance — do not copy it.) 0.0.0.0 is the "allow Azure services" marker;
    the protection is the password and TLS, not the network. Do NOT try to
    allow-list the app's outbound IPs — a Consumption environment egresses from
    hundreds of rotating addresses.

 3. THE APP'S SECRETS. deploy_cwp.sh takes only an image tag and sets none of
    them. They must be Container App SECRETS with secretref env vars, never
    literal env values. See docs/DEPLOY.md for the full list, and note that
    BANKING_ENCRYPTION_KEY and SMTP_ENCRYPTION_KEY must be carried across
    BYTE-FOR-BYTE from Replit or existing encrypted data becomes unreadable.

 4. THE CONTAINER APP ITSELF — deploy_cwp.sh creates it, and it needs an image
    in the registry first.
 ═══════════════════════════════════════════════════════════════════════
SUMMARY
