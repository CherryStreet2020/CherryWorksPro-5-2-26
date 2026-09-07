# Template for ~/.local/pgsql/cwp-pg-env.sh — local-only keys and DB URLs. NEVER prod values.
# scripts/dev/cwp sources this file, so keep it to plain `export`s with no side effects.
# Usage: cp scripts/dev/cwp-pg-env.example.sh ~/.local/pgsql/cwp-pg-env.sh && $EDITOR ~/.local/pgsql/cwp-pg-env.sh
#
# Conventional layout (what the header of scripts/dev/cwp describes): a user-space
# PostgreSQL install, its data directory, and its bin dir PREPENDED to PATH.
export PGHOME="$HOME/.local/pgsql"
export PGDATA="$PGHOME/data"
export PGPORT="5432"
export PATH="$PGHOME/bin:$PATH"   # prepend — never replace PATH, sourcing this must not break basic tooling
# Main local dev DB used by the app, vitest (as cwp_test on the same cluster) and playwright.
# Loopback host, exact database name, NO query parameters: scripts/dev/cwp refuses to
# drop/recreate any database it cannot prove is local (libpq honours ?host= overrides).
export CWP_DATABASE_URL="postgres://<role>:<password>@localhost:5432/cwp_dev"
# Throwaway DB for `cwp migcheck` / scripts/check-migrations.sh (it DROPs the public schema).
export CWP_MIGCHECK_URL="postgres://<role>:<password>@localhost:5432/cwp_migcheck"

# --- App secrets (LOCAL-ONLY, freshly generated; NOT the prod keys) ---
# The local cwp_dev DB has no prod data, so these only need to be internally
# consistent across the app server + vitest + direct DB access in tests.
# Generate each with:  openssl rand -hex 32
export BANKING_ENCRYPTION_KEY="<fill me>"
export SMTP_ENCRYPTION_KEY="<fill me>"
export SESSION_SECRET="<fill me>"
