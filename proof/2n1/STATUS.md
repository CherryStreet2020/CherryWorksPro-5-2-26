# Sprint 2n.1 — "Ship-It-Clean" Hot-Patch Status (Task #359)

Date: 2026-04-22
Scope: marketing-only; no schema changes; preserve `--lux-*` tokens; focus-ring rule unchanged.

## A. Goal recap
Resolve four post-build E2E findings from Sprint 2n:

1. CRITICAL — PremiumDialog viewport overflow at `/settings/brands` (modal cut off below fold).
2. HIGH — Stale `BrandB %` / `Phase7 Activity Brand %` brand pollution in dev DB.
3. HIGH — Stale `E2E Test Vendor` row pollution on `/expenses`.
4. LOW — React `Removing animation animationDelay` shorthand-vs-longhand console warning.

## B. Code changes shipped
| File | Change |
|---|---|
| `client/src/components/marketing-os/premium/premium-dialog.tsx` | Outer `DialogContent` → `max-w-4xl max-h-[90vh] overflow-y-auto`. Header div → `sticky top-0 z-20 backdrop-blur-sm`; gradient now fades into `var(--lux-surface)`. |
| `client/src/components/marketing-os/brands/brand-modal.tsx` | Footer wrapper → `sticky bottom-0 z-10 -mx-6 -mb-6 px-6 py-4` with `background: var(--lux-surface)` so Cancel / Save remain visible while the body scrolls. |
| `client/src/components/help-panel.tsx` (×2) | `animation: "helpCardSlideIn 0.3s ease-out both"` split into longhand `animationName/Duration/TimingFunction/FillMode` to avoid React warning when used with `animationDelay`. |
| `client/src/pages/marketing/home.tsx` (KPI shimmer + delayed social-proof glow dot) | Same shorthand→longhand split. |
| `e2e/marketing-os-activity.spec.ts` (×2 `afterAll` hooks) | Replaced silent `try { … } catch (e) { console.error(…) }` with hard-delete cascade `cleanupE2EBrandPollution([brand.id])`; cleanup failures now fail the suite instead of leaking orphans. |

## C. Database cleanup (dev)
Manual sweep ran in this session (test org `30cb6705-f98e-44c5-8e2a-fbe3f150a3eb`):
- Detached FK references in `companies`, `clients`, `client_contacts`, then deleted dependents in `contact_activities`, `contact_import_presets`, `contact_imports`, `contact_segments`, `contact_tags`, `marketing_campaigns`, `marketing_sequences`.
- `DELETE 21` rows from `brands` matching `BrandB %` or `Phase7 Activity Brand %`.
- `DELETE 1` row from `expenses` where `vendor = 'E2E Test Vendor'`.

## D. Schema parity audit
- `\d brands` matches `shared/schema.ts` (id varchar(36), org_id varchar(36) FK→orgs, name text, slug text, logo_url, primary_color, domain, from_email, from_name, reply_to, signature_html, active boolean default true, created_at/updated_at). Unique index `brands_org_slug_idx` on (org_id, slug). No drift.
- `\d org_entitlements` matches schema (id, org_id, feature enum, active boolean default false, activated_at, stripe_subscription_id, grace_period_ends_at, created_at/updated_at). Unique index on (org_id, feature). No drift.
- Current entitlement counts: `pso_core=18`, `marketing_os=3`.

## E. HARD RULE 5 — animation shorthand+longhand grep
`grep -P "animation:\s*['\"][^'\"]+['\"][\s\S]{0,200}animationDelay|animationDelay[\s\S]{0,200}animation:\s*['\"]" client/src` → **0 matches**. The line at `home.tsx:246` still uses shorthand but has no `animationDelay`, so it does not trigger the warning.

## F. Token audit
`--lux-accent`, `--lux-surface`, `--lux-border`, and `--lux-card-shadow-hover` references intact across the touched files. Premium close-button focus ring still uses `box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb), 0.25)` on `:focus-visible`.

## G. E2E teardown audit
- `e2e/marketing-os-brand-switch.spec.ts` already uses the cascade cleanup (`cleanupE2EBrandPollution`) — unchanged.
- `e2e/marketing-os-activity.spec.ts` was the leak source; now hardened to use the same cascade and re-throw on failure (see B).
- No other spec was found seeding `BrandB`, `Phase7 Activity Brand`, or `E2E Test Vendor` patterns.

## H. Verification
- Workflow `Start application` restarted cleanly after edits (`serving on port 5000`, all background migrations completed).
- Browser console after Vite HMR: no `Removing animation animationDelay` warnings.
- Architect code review: PASS.

## I. Out of scope / follow-ups
- E2E hardening + sweeper for any future test-data prefixes → tracked as follow-up #360.
- `proof/2n1/settings-brands-after.jpg` saved as a single before-auth reference shot.

## J. Authenticated proof bundle (Task #361)
Captured the requested 8-shot matrix at `/settings/brands` with the Add Brand
modal open and scrolled to the middle so the sticky header (`Add brand` /
subtitle) **and** sticky footer (`X of 3 required fields complete` / Cancel /
Create brand) are both visible — the exact viewport-fix behavior from
PremiumDialog + brand-modal that Sprint 2n.1 shipped.

| Theme | 1280 | 1366 | 1440 | 1920 |
|---|---|---|---|---|
| Light | `proof/2n1/brand-modal-light-1280.jpg` | `proof/2n1/brand-modal-light-1366.jpg` | `proof/2n1/brand-modal-light-1440.jpg` | `proof/2n1/brand-modal-light-1920.jpg` |
| Dark  | `proof/2n1/brand-modal-dark-1280.jpg`  | `proof/2n1/brand-modal-dark-1366.jpg`  | `proof/2n1/brand-modal-dark-1440.jpg`  | `proof/2n1/brand-modal-dark-1920.jpg`  |

Capture script: `scripts/capture-2n1-proofs.ts` (Playwright). It logs in as
the admin specified by `PROOF_ADMIN_EMAIL` / `PROOF_ADMIN_PASSWORD` (no
credentials are baked into the repo), pre-seeds the `cherry-st` org slug and
`cherryworks_theme` via `localStorage`, opens the Add Brand modal, scrolls
the dialog body to its midpoint, and asserts the dialog header *and* the
Cancel/Save footer are both inside the visible viewport before writing the
JPEG (so a regression that re-breaks the viewport fix would fail the script
instead of silently shipping a bad proof). Re-run with:

```
PROOF_ADMIN_EMAIL=… PROOF_ADMIN_PASSWORD=… \
  THEMES=light,dark npx tsx scripts/capture-2n1-proofs.ts
```
