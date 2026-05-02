# CherryWorks Pro — Replit Agent Guide

## Overview
CherryWorks Pro is a full-stack TypeScript monorepo designed as an internal operating system for consulting firms. It covers the entire consulting workflow, including client and project management, time tracking, invoicing, payment processing, and financial reporting. Key features include multi-tenant organizational isolation, role-based access control, and financial determinism. It offers FreshBooks CSV imports, automated invoice generation, estimates, recurring invoice templates, a Client Portal, configurable GL journal entry auto-posting, receipt OCR for expense auto-filling, and an Expense Reports system. The project aims to provide an enterprise-grade solution for consulting operations, enhancing efficiency and financial accuracy with a business vision of becoming the leading platform in the market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **Routing**: Wouter.
- **State Management**: TanStack React Query v5.
- **Forms**: React Hook Form with Zod validation.
- **UI Components**: shadcn/ui built on Radix UI primitives.
- **Styling**: Tailwind CSS with CSS variables, featuring a warm, luxury aesthetic (off-white, warm navy, cherry-red accents) for light mode.
- **Code Splitting**: All page components use `React.lazy()` with `Suspense`.
- **Core Pages**: Dashboard, Import Wizard, Team Page, Estimates Page, Payments Command Center, Billing Pages, Mission Control, and a searchable Knowledge Base.

### Backend
- **Runtime**: Node.js with Express and `tsx`.
- **API**: RESTful, with modular route files.
- **Authentication**: Express sessions with `connect-pg-simple`, self-service password reset, and idle session timeout.
- **Authorization**: `ADMIN` and `TEAM_MEMBER` roles with organization scoping.
- **Financial Logic**: Strict adherence to `round2()` and `computeInvoiceTotals()` for accuracy.
- **Import Engine**: Handles FreshBooks imports with idempotency, error tracking, dry-run plans, and reconciliation.
- **PDF Generation**: Dynamic PDF creation with organization-aware date formatting and firm logo embedding.
- **Tax Calculation**: Org-level setting for `tax_after_discount` or `tax_before_discount`.
- **Email System**: Nodemailer with branded HTML templates. Marketing scheduled-send worker persists per-recipient send attempts in `email_send_attempts` and retries transient transport failures with exponential backoff (default 5 attempts, base 5min) before giving up; admins can review failed recipients per campaign / sequence step via `/api/marketing/{campaigns,sequences}/:id/failures` and the Failures dialog in the campaigns UI.
- **Receipt OCR**: Uses Groq AI vision API with Tesseract.js as a fallback for expense auto-filling.
- **Security**: Comprehensive security measures including SMTP encryption, sensitive field masking, webhook SSRF protection, and platform signature validation.
- **Account Management**: Account deletion, active sessions management, and email notification preferences.
- **Settings Page**: Reorganized into a tabbed layout for improved navigation.

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts` for type safety.
- **Migrations**: `drizzle-kit`.
- **Tenant Isolation**: All data strictly scoped by `orgId` with FK constraints and indexing.
- **Transaction Safety**: Key financial and import operations wrapped in `db.transaction()`.

### Feature Gating
- **Plan Tiers**: TRIAL, STARTER, PROFESSIONAL, BUSINESS, ENTERPRISE for feature access.
- **Shared Tier Logic**: `shared/tier-order.ts` for consistent tier evaluation.
- **Server Middleware**: `server/lib/tier-gate.ts` for enforcing minimum tier requirements on API routes.
- **Client Gating**: `useBillingStatus()` hook for client-side feature visibility.

### API & Integrations System (Zapier-Ready)
- **API Keys**: CRUD operations with scrypt hashing.
- **Auth Middleware**: Verifies API keys and plan tiers.
- **Webhook Endpoints**: CRUD operations with signed payloads, delivery tracking, and exponential backoff retries.
- **Event Emission**: Asynchronously fires HTTP POST events.

### Marketing OS (gated)
A multi-brand marketing layer is being built incrementally. This includes primitives for Brands, Contacts, and Companies. The entire Marketing OS code path is gated at runtime by environment variables.
- **Marketing Contacts**: Extends `client_contacts` with additional fields and soft-delete capabilities. Uses a unified `contact_activities` table.
- **Marketing Companies**: Adds a `companies` table with auto-linking rules for contacts based on email domains.
- **Discovery Telemetry (Task 147)**: When the locked Marketing section renders for an admin, the client posts to `POST /api/telemetry/marketing-os` (server route in `server/routes/marketing-os-telemetry-routes.ts`). The handler writes a `[telemetry] <event> {json}` line to the standard app logs. Three events are emitted:
  - `marketing_os.discovery.section_shown` — fired once per browser session per admin who renders the locked sidebar variant (deduped via `sessionStorage`).
  - `marketing_os.discovery.modal_opened` — fired when the upgrade modal opens, with `props.source` set to either `section_label` or `row_<contacts|companies>` to identify the originating element.
  - `marketing_os.discovery.checkout_clicked` — fired when the admin clicks the Upgrade button, before the Stripe redirect.
  Operators can read these via `grep "[telemetry] marketing_os.discovery" <log>`.

### Build and Test
- **Development**: `npm run dev` (Vite with `tsx`).
- **Production**: `npm run build`.
- **Quality**: Strict TypeScript, ESLint, Vitest for unit tests, Playwright for E2E tests.

## External Dependencies

### Database
- **PostgreSQL**: Primary relational database.
- **Migration pre-deploy check**: `bash scripts/check-migrations.sh` replays every `migrations/*.sql` (excluding `rollback-*`) against a throwaway database via `psql -v ON_ERROR_STOP=1`, after first pushing the Drizzle base schema to mirror the production boot order. Requires `MIGRATION_CHECK_DATABASE_URL` to point at a disposable DB. Wired into CI as the `migrations` job in `.github/workflows/ci.yml`, which spins up a Postgres 16 service. Also wired into the Replit deploy pipeline: `script/build.ts` (invoked by `npm run build`) runs the same script as its first step and aborts the build on a non-zero exit, so the Replit "Deploy" path can never ship a SQL file the replay rejects. The deploy environment must therefore have `psql` on PATH and `MIGRATION_CHECK_DATABASE_URL` pointed at a throwaway Postgres (never prod / `DATABASE_URL`).

### Payment Processing
- **Stripe**: For credit card payments, webhooks, and managing 1099/C2C independents.

### Email
- **Nodemailer**: For sending all system-generated emails when an org is configured for `provider='smtp'` (Custom SMTP) or when the OAuth flag is off.
- **Microsoft Graph (`sendMail`)** and **Gmail API (`users.messages.send`)**: OAuth2 transports introduced in Sprint 2g to handle the 2026-04-30 Microsoft SMTP Basic Auth removal. Selected per-org via the new `email_provider_type` enum on `orgs` (`smtp` | `m365` | `google`) and gated globally by `EMAIL_OAUTH_ENABLED`. With the flag off, behavior is identical to the pre-2g SMTP path. With the flag on, M365 and Gmail orgs route sendMail/messages.send through Graph/Gmail using a refresh token persisted in `email_oauth_refresh_token` (AES-256-GCM via `SMTP_ENCRYPTION_KEY`). Required production secrets when enabling: `EMAIL_OAUTH_ENABLED`, `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET`, `MS_OAUTH_TENANT` (default `common`), `MS_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Test-only override `GRAPH_TRANSPORT_TEST_URL_OVERRIDE` exists for stubbing the Graph send URL in CI.

### APIs
- **Clearbit / Google Favicons**: For fetching client logos.
- **Frankfurter API**: For real-time currency exchange rates.
- **Groq AI Vision API**: Primary OCR solution for receipt scanning.
- **Tesseract.js**: Fallback OCR solution for receipt scanning.

## Repo History Reset (Task #426, 2026-05-02)
A fresh-history reset was started against the new `origin` (`https://github.com/CherryStreet2020/CherryWorksPro-5-2-26`). Pre-work that DID land:
- Full `.git` backup at `/home/runner/.git-backup-pre-reset-20260502-193942` (4.5G, intact).
- `.gitignore` now excludes `uploads/`, `*.zip`, `audit-results/`, `proof-bundle-*/`, plus the root proof artifacts (`CHANGES.md`, `HELP_PHASE3_VERIFY.md`, `PROD_MIGRATION_RESULT.md`, `account-audit-results.json`, `codebase-mchat1.zip`, `codebase-sprint5-help-verify.txt`).
- Stale clutter physically removed from disk: `audit-results/`, `proof-bundle-29/`, and the seven root proof files. `uploads/receipts/*.pdf` (real customer data) and `exports/*.zip` are kept on disk for runtime but are now gitignored.

The destructive part (orphan commit, prune ~209 `subrepl-*` branches/remotes, `gc --prune`, force-push) is **blocked at the sandbox level for the main agent** (every mutating git command, including `git add` / `git write-tree` / `git update-ref`, returns "Destructive git operations are not allowed in the main agent"). The exact runbook is staged at `.local/clean-git-runbook.sh` — it must be executed either from the Replit Shell tab directly or from an isolated task agent.