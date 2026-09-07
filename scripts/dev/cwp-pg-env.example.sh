# Template for ~/.local/pgsql/cwp-pg-env.sh — local-only keys and DB URLs. NEVER prod values.
# Source this to get CWP local Postgres on PATH + standard vars.
# Usage: source ~/.local/pgsql/cwp-pg-env.sh
export PGHOME="<fill me>"
export PGDATA="<fill me>"
export PGPORT="<fill me>"
export PATH="<fill me>"
# Main local dev/test DB used by the app, vitest, and playwright.
export CWP_DATABASE_URL="<fill me>"
# Throwaway DB for scripts/check-migrations.sh (it DROPs the public schema).
export CWP_MIGCHECK_URL="<fill me>"

# --- App secrets (LOCAL-ONLY, freshly generated; NOT the prod keys) ---
# The local cwp_dev DB has no prod data, so these only need to be internally
# consistent across the app server + vitest + direct DB access in tests.
export BANKING_ENCRYPTION_KEY="<fill me>"
export SMTP_ENCRYPTION_KEY="<fill me>"
export SESSION_SECRET="<fill me>"
