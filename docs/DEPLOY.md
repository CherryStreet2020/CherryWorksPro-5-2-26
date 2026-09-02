# Deploying CherryWorks Pro on Azure

> Written during the Replit → Azure migration. Until the cutover completes,
> **production is still Replit** and this document describes the target state.

---

## ⚠️ READ THIS FIRST: `migrations/*.sql` DO NOT REPLAY ON AZURE

On Azure the app runs with `SKIP_STARTUP_MIGRATIONS=1`, and the container
entrypoint runs **only** `drizzle-kit push --force`.

`drizzle-kit push` reconciles the live database against `shared/schema.ts`. It
does **not** read `migrations/` at all. `server/migrate-production.ts` — the code
that replays those `.sql` files — is exactly what `SKIP_STARTUP_MIGRATIONS=1`
turns off.

**Consequences, all of which have bitten someone somewhere:**

1. Any migration whose effect is *not* expressible as a schema difference —
   a data backfill, a `UPDATE`, a one-off correction, a trigger, a view —
   **will never run on Azure**. `push` only converges structure.
2. **The fourteen-assertion deploy gate cannot see that it was skipped.** The
   app boots, the schema matches `shared/schema.ts`, `/api/readyz` reports
   Healthy, and the release is green while the backfill never happened.

**Therefore: every future `migrations/*.sql` that does more than change
structure must be applied BY HAND against the Azure `DATABASE_URL` BEFORE the
deploy that depends on it.**

```bash
# From a machine with the Postgres 16 client (see ~/cwp-migration/bin/psql)
psql "$AZURE_DATABASE_URL" -f migrations/00NN-whatever.sql
```

Then deploy. The CI "Replay migrations on a fresh database" job still proves the
`.sql` files are internally consistent; it does not prove they ran on Azure.

---

## How a release happens

**Deploys are manual, by button.** There is deliberately no `push` trigger on
`deploy-azure.yml`.

Why: the entrypoint runs `drizzle-kit push --force` on **every boot**, and
`push` converges by **DROPPING**. Every deploy is therefore a schema-mutating
event against the database holding real invoices, payments, payouts and the
general ledger. A human chooses the moment. (This is the csaa posture. The
consulting site deploys on merge because it runs no boot-time DDL — do not
copy that pattern here.)

Reinforcing it: this repository is **public** and `main` has no branch
protection, so a push trigger would let any direct push roll production.

### To deploy

1. Merge to `main`.
2. **Actions → deploy-azure → Run workflow.**
3. `confirm` = `DEPLOY` (the literal string; anything else fails the run).
4. `image_tag` = blank to build and deploy `HEAD`.

The run builds in ACR, rolls by immutable digest, and then runs a post-roll gate
of fourteen assertions. Any failure auto-restores the previous image.

### To roll back — no rebuild

**Actions → deploy-azure → Run workflow**, `confirm` = `DEPLOY`,
`image_tag` = either

* `last-known-good` — re-tagged automatically after every verified-good deploy, or
* a `sha256:…` digest from a prior run summary, for a byte-exact rollback.

> **A rollback restores the IMAGE ONLY.**
> It does **not** undo schema changes the failed release already applied. If the
> bad release dropped or altered a column, the recovery is an **Azure Postgres
> point-in-time restore**, not a rollback. Retention is 35 days.
> It also does not repair a dropped probe or an unbound secret — re-apply the
> template with `scripts/azure/deploy_cwp.sh`.

---

## The three commands that must never be run

```
az containerapp up
az containerapp update --yaml ...
az containerapp update --replace-env-vars ...
```

Each re-derives the whole template from its arguments and silently drops what
was set out of band. Here that is `DATABASE_URL`, both encryption keys, the
Stripe keys, the OAuth client secrets, and the two volume mounts — i.e.
invoicing, payments, email and every uploaded file, all at once.

Change images with `az containerapp update --image` and **nothing else on the
command line**.

`--set-env-vars` appears exactly once in the whole workflow: on the rollback
path, carrying `SKIP_DB_PUSH=1`. That flag is what stops a rolled-back *older*
image from running `push --force` and **dropping the columns the newer release
added**. Because `--set-env-vars` can itself re-derive template fragments, the
rollback re-asserts every secret binding immediately afterwards.

---

## The estate

| | |
|---|---|
| Subscription | CS Azure Sub June26 `e5a6f7c8-fb0a-45af-84fa-1ee18b4b7032` |
| Tenant | `48234fc8-b6ba-4435-accb-6fdfdaf77efd` |
| Region | `eastus2` — app, registry, database and storage all co-located |
| Resource group | `cwp-rg` (fourth; cherryeam-rg, csaa-rg, cherrysite-rg are the others) |
| Registry | `cwpacr`, Basic, **admin user disabled** |
| App | `cwp-app` in `cwp-env`, single-revision, **1/1 replicas**, 1 vCPU / 2 GiB, port 8080 |
| Database | `cwp-pg`, Flexible Server 16, Standard_B2s, 35-day retention, geo-redundant |
| Storage | `cwpstore26` — Azure Files shares `uploads` + `backups`, blob container `public-objects` |
| Deploy identity | `cwp-deploy-uami`, federated to `refs/heads/main` and `environment:production` |

### Why `1/1` replicas and single-revision mode are both load-bearing

Neither may be raised.

* The entrypoint runs schema DDL on boot, and ACA brings a **new revision up
  before draining the old one** — so the replica cap alone does not remove the
  overlap, and single-revision mode alone does not either.
* `min-replicas` is **1, never 0**: sixteen schedulers run as in-process timers.
  Scaling to zero silently stops reminders, recurring invoices, marketing sends
  and every cleanup sweep.

### Architectural honesty

One replica, a Burstable database, no HA, no zone redundancy, no read replica.
Routine Azure Postgres maintenance restarts the server; readiness then fails and
traffic gets 503 for the duration. **Expect occasional multi-minute
unavailability in normal operation.** This is the same posture Replit had, but
it should be stated rather than implied.

---

## Environment and secrets

Secrets are **Container App secrets referenced by `secretref`**, never literal
env values. The deploy gate asserts the *binding*, not the name — because the
failure that actually happens is the entry surviving while its `secretRef` is
dropped, leaving an empty literal behind a perfectly healthy-looking app.

### Values that must be carried across BYTE-FOR-BYTE

| Secret | If it differs by even one character |
|---|---|
| `BANKING_ENCRYPTION_KEY` | stored bank details become permanently unreadable |
| `SMTP_ENCRYPTION_KEY` | every org's stored SMTP password and every Graph/Gmail refresh token becomes unreadable |
| `SESSION_SECRET` | every logged-in user is signed out at cutover |

`/api/readyz` exposes a non-reversible sha256 prefix of each (behind
`INTERNAL_MAINTENANCE_TOKEN`). **Compare those fingerprints between Replit and
Azure before trusting a cutover** — it is the only check that catches a
mistyped key before the data becomes unreadable. Once a known-good set exists,
put it in the `EXPECTED_KEY_FINGERPRINTS` repo variable and the gate enforces it
on every deploy.

> ⚠️ `SMTP_ENCRYPTION_KEY` is used **verbatim, untrimmed**. If it carries
> leading or trailing whitespace, that whitespace is part of the key. The app
> warns loudly at boot. Do **not** "clean it up" — re-pasting it without the
> whitespace derives a different key.

### Values that must CHANGE for Azure

| Variable | Value |
|---|---|
| `BASE_URL` | `https://cherryworkspro.com` |
| `APP_BASE_URL` | `https://cherryworkspro.com` — **both are required** |
| `MS_OAUTH_REDIRECT_URI` | re-registered in Entra |
| `OBJECT_STORAGE_DRIVER` | `azure` |
| `AZURE_STORAGE_BLOB_ENDPOINT` | `https://cwpstore26.blob.core.windows.net` |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `/public-objects/public` |
| `PRIVATE_OBJECT_DIR` | `/public-objects/private` |
| `SKIP_STARTUP_MIGRATIONS` | exactly `1` |
| `NODE_ENV` | exactly `production` |

**Both `BASE_URL` and `APP_BASE_URL` are required.** There are five base-URL
helpers with five precedence orders, and `server/routes/auth-routes.ts:609`
reads `APP_BASE_URL` → `REPLIT_DOMAINS` → `http://localhost:5000`, with **no
`BASE_URL` in its chain**. Setting only `BASE_URL` sends every password-reset
email to `localhost`.

**`NODE_ENV` must be exactly `production`.** `server/db.ts` trims and lowercases
it while `server/routes/middleware.ts` compares it exactly — so `production `
with a trailing space yields database TLS enforcement *together with* no CSP, no
HSTS, insecure cookies and stack traces in 500 responses. The gate asserts the
exact value for this reason.

### Google / Gmail is deliberately NOT carried over

Dean's decision, 2026-09-02: **Microsoft 365 only.** Google mailbox OAuth is not
configured on Azure — no `GOOGLE_OAUTH_*` variables, no `google-oauth-client-secret`,
and no redirect URI registered in Google Cloud.

Verified safe before removing: **zero orgs use a Google provider.** In production
today, one org (Cherry Street Consulting) is on `m365` and holds the single stored
OAuth refresh token; every other org is plain `smtp`. Every Google code path is
guarded by a null check inside a route handler — nothing runs at boot — so the
"connect Gmail" button simply returns a clear "not configured" error rather than
breaking anything.

The code in `server/email/gmail-transport.ts` and the Google branches of
`server/routes/oauth-mailbox-routes.ts` are left in place; only the configuration
is withheld. Re-enabling later means setting the two variables and registering a
redirect URI — no code change.

### New secret required

`BACKUP_ENCRYPTION_KEY` was **never set on Replit**, so the app fell back to a
key derived from a literal string in this public repository — meaning every
backup taken to date is effectively unencrypted. It is now fail-closed: the
container refuses to boot without a real value. Generate one:

```bash
openssl rand -hex 32
```

---

## Scripts

| Script | What it does |
|---|---|
| `scripts/azure/provision_cwp.sh` | Idempotent: resource group, ACR, Log Analytics, environment, deploy identity, federated credentials. |
| `scripts/azure/deploy_cwp.sh` | Create-or-update the Container App; applies probes and both volume mounts via a surgical read-modify-write PATCH. |

**Neither script performs role assignments.** On this project Dean performs IAM
changes himself; the scripts check each grant and fail closed with the exact
command and scope if one is missing. Every scope is an individual **resource** —
never the resource group, never the subscription.

`provision_cwp.sh` also does not create the Postgres server, set secrets, or
create the Container App. It says so loudly in its summary, because a script
that silently omits them looks like it built a working estate when it did not.

---

## When a deploy fails

The gate prints revision and replica tables rather than `az containerapp logs
show` — that command needs `Microsoft.App/managedEnvironments/read`, which the
deploy identity deliberately lacks. The failed revision is selected **by image**,
not by recency.

If a run is stuck in `queued`, it holds the `cwp-deploy` concurrency group
indefinitely:

```bash
gh run list --workflow=deploy-azure.yml --json headSha,status,createdAt,updatedAt
```

`updatedAt == createdAt` while queued means no runner ever claimed it, and
cancelling that run is safe.
