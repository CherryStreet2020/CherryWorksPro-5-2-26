#!/usr/bin/env bash
#
# Rollback floors, sourced by deploy_gate.sh (and by its shell test, which
# replaces image_has_floor_label with a stub).
#
# THE ACS FLOOR (PLAN §5, ACS marketing transport). An image older than the
# one that added `accepted`/`deferred` to the send-attempt status enum would
# (a) treat an `accepted` row as unknown and could re-send it, and (b) run
# `drizzle-kit push`, which recreates the enum without those values and fails
# the boot on any row that holds one. So no deploy may land on an image that
# lacks the Dockerfile label `cwp.acs-enum=1`. There is no data check and no
# override flag. The one exception is the automatic restore after the deploy
# of the FIRST labeled image itself: ACS ships dark, so nothing can have
# written the new values yet, and the restore runs with SKIP_DB_PUSH=1.
#
# A manual `az containerapp update --image <older>` bypasses this gate and is
# forbidden (docs/DEPLOY.md).

FLOOR_LABEL_KEY="cwp.acs-enum"
FLOOR_LABEL_VALUE="1"

# image_has_floor_label <image-ref>
# Exit 0 only when the image's config carries cwp.acs-enum=1. Any lookup
# failure, and any image outside $LOGIN/$IMAGE_REPO, counts as unlabeled:
# the floor fails closed.
image_has_floor_label() {
  local ref="$1" repo_ref reference refresh token manifest config_digest labels
  case "$ref" in
    "$LOGIN/$IMAGE_REPO@"*) reference="${ref#"$LOGIN/$IMAGE_REPO@"}" ;;
    "$LOGIN/$IMAGE_REPO:"*) reference="${ref#"$LOGIN/$IMAGE_REPO:"}" ;;
    *) echo "floor: $ref is not in $LOGIN/$IMAGE_REPO — treated as unlabeled" >&2; return 1 ;;
  esac
  repo_ref="$IMAGE_REPO"

  # `az acr` has no command that returns an image's config blob, so read it
  # from the registry API with a pull-scoped token for this repository only.
  refresh=$(az acr login -n "$ACR" --expose-token --query accessToken -o tsv 2>/dev/null) || return 1
  [ -n "$refresh" ] || return 1
  token=$(curl -fsS --max-time 20 -X POST "https://$LOGIN/oauth2/token" \
      --data-urlencode "grant_type=refresh_token" \
      --data-urlencode "service=$LOGIN" \
      --data-urlencode "scope=repository:$repo_ref:pull" \
      --data-urlencode "refresh_token=$refresh" 2>/dev/null | jq -r '.access_token // empty') || return 1
  [ -n "$token" ] || return 1

  local accept="application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.index.v1+json"
  manifest=$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" -H "Accept: $accept" \
      "https://$LOGIN/v2/$repo_ref/manifests/$reference" 2>/dev/null) || return 1
  # A multi-platform index: follow the linux/amd64 entry (what ACA runs).
  if echo "$manifest" | jq -e '.manifests' >/dev/null 2>&1; then
    reference=$(echo "$manifest" | jq -r '[.manifests[] | select(.platform.os=="linux" and .platform.architecture=="amd64")][0].digest // empty')
    [ -n "$reference" ] || return 1
    manifest=$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" -H "Accept: $accept" \
        "https://$LOGIN/v2/$repo_ref/manifests/$reference" 2>/dev/null) || return 1
  fi
  config_digest=$(echo "$manifest" | jq -r '.config.digest // empty')
  [ -n "$config_digest" ] || return 1
  labels=$(curl -fsSL --max-time 20 -H "Authorization: Bearer $token" \
      "https://$LOGIN/v2/$repo_ref/blobs/$config_digest" 2>/dev/null | jq -c '.config.Labels // {}') || return 1
  echo "$labels" | jq -e --arg k "$FLOOR_LABEL_KEY" --arg v "$FLOOR_LABEL_VALUE" '.[$k] == $v' >/dev/null
}

# assert_target_above_floor <image-ref>
# Every roll target — a forward build or an explicit image_tag — must carry
# the label. Prints the reason and returns 1 when it does not.
assert_target_above_floor() {
  if image_has_floor_label "$1"; then
    echo "floor: $1 carries $FLOOR_LABEL_KEY=$FLOOR_LABEL_VALUE"
    return 0
  fi
  echo "::error::REFUSED: $1 does not carry the label $FLOOR_LABEL_KEY=$FLOOR_LABEL_VALUE (or it could not be read). Images older than the ACS marketing transport can re-send accepted emails and fail their boot on the newer enum values — see docs/DEPLOY.md, 'Rollback floors'. Fix forward instead."
  return 1
}

# restore_allowed <restore-target> <failing-image>
# The automatic restore may go to an unlabeled image only when the image that
# just failed is the first labeled one: the previous image being unlabeled
# while the failing one is labeled means this deploy is the one that
# introduced the label, and ACS has never been switched on.
restore_allowed() {
  local target="$1" failing="$2"
  if image_has_floor_label "$target"; then return 0; fi
  if image_has_floor_label "$failing"; then
    echo "::warning::floor: restoring to unlabeled $target is allowed once — $failing is the first labeled image and ACS ships dark"
    return 0
  fi
  echo "::error::REFUSED automatic restore to $target: it is below the ACS rollback floor and the failing image $failing is not the first labeled one"
  return 1
}
