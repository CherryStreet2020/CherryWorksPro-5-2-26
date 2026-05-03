# CherryWorks Pro — Functionality Audit & Coverage Gap Analysis

> **Scope.** Single source of truth for every user-facing feature in
> CherryWorks Pro, the current automated test coverage, and any
> known-broken or fragile behavior. Input to the next task
> ("Exhaustive E2E test suite expansion").
>
> **Method.** Routes were reconciled directly against
> `client/src/App.tsx` (top-level outer `<Switch>` for public/auth
> shells, plus the inner `Router()` for authenticated app pages).
> Pages were inventoried under `client/src/pages/`. Test coverage was
> mapped by reading every spec under `e2e/`, `tests/e2e/`,
> `tests/integration/`, and `tests/unit/`.
>
> **Hands-on browser verification.** Three live Playwright walk-throughs
> were executed against the running dev server (in addition to in-tool
> screenshots of `/` and `/login` to confirm route shapes):
> 1. **Public site** — visited every public marketing route plus
>    `/login`, `/forgot-password`, `/reset-password/:token`, and
>    `/unknown-route-xyz` as an unauthenticated visitor.
> 2. **Authenticated app** — logged in as the seeded admin
>    `dean@cherrystconsulting.com / admin123` (password reset via
>    `e2e/global-setup.ts`'s logic before the run), navigated through
>    every route in the inner `Router()` plus `/403`, `/500`, and an
>    unknown URL.
> 3. **Marketing OS** — logged in as admin and walked every
>    `/marketing/*` route.
>
> Findings from the live walks are folded into §6 ("Bugs / Fragile UI /
> Dead Code"). The most significant live-audit finding is the
> **`AdminSetupGate` shell behavior** documented in §6.1 — for an admin
> whose firm profile is not yet complete, every authenticated route
> (except a tiny allow-list) renders the Getting Started gate instead
> of the page's own content. This is by design but had previously been
> opaque, and any spec the next task writes _must_ either pre-complete
> the firm profile or test the gate explicitly.
>
> **Coverage labels.**
> - **Covered** — Playwright spec(s) exercise the primary happy path
>   _and_ at least one error/edge path of every major listed feature.
> - **Partial** — at least one spec touches the page but several
>   listed features are not exercised.
> - **Untested** — no Playwright spec exercises the page meaningfully.
>
> **Spec counts (snapshot).** `e2e/`: 32 specs. `tests/e2e/`: 21 specs
> (the latter are not picked up by the default `playwright.config.ts`
> `testDir: ./e2e` — see §5.1). `tests/integration/`: 26 specs.
> `tests/unit/`: 122 tests.

---

## 1. Route Table (verified against `client/src/App.tsx`)

The app uses a two-tier routing model:

1. **Outer `<Switch>` in `App` (lines 609–647)** — handles public
   token routes, public marketing pages, and a few redirects. These
   render with no auth.
2. **`AppContent` (lines 539–597)** — when unauthenticated, falls
   through to specific public pages: `/` → marketing home,
   `/login` → login, `/forgot-password` → forgot, `/reset-password/*`
   → reset. Otherwise redirects to `/login?auth=required`. When
   authenticated, mounts the sidebar shell + inner `Router()`.
3. **Inner `Router()` (lines 274–357)** — authenticated app pages.

> **Note on the marketing home.** When unauthenticated, hitting `/`
> renders `MarketingHomePage` (verified by screenshot — black
> homepage with "Run your firm like a Fortune 500" hero and nav
> links to Features / Tour / Compare / Pricing / Marketing Hub /
> Integrations / About). When authenticated, `/` renders the
> Dashboard.

### 1.1 Public routes (no auth required)

| Route | Component file | Notes |
| --- | --- | --- |
| `/` (logged out) | `pages/marketing/home.tsx` | Marketing home |
| `/i/:token` | `pages/public-invoice.tsx` | Public invoice viewer |
| `/e/:token` | `pages/public-estimate.tsx` | Public estimate viewer |
| `/portal/:token` | `pages/client-portal.tsx` | Client portal |
| `/login` | `pages/login.tsx` | Login (also handles MFA prompt + multi-org picker) |
| `/forgot-password` | `pages/forgot-password.tsx` | Initiate reset |
| `/reset-password/:token` | `pages/reset-password.tsx` | Complete reset |
| `/signup` | `pages/marketing/signup.tsx` | New-org signup |
| `/features` | `pages/marketing/features.tsx` | |
| `/pricing` | `pages/marketing/pricing.tsx` | |
| `/marketing` | `pages/marketing/marketing.tsx` | Marketing OS landing |
| `/marketing-os` | redirect → `/marketing` | |
| `/about` | `pages/marketing/about.tsx` | |
| `/contact` | `pages/marketing/contact.tsx` | |
| `/demo` | `pages/marketing/demo.tsx` | Interactive UI mockups |
| `/integrations` | `pages/marketing/integrations.tsx` | |
| `/security` | `pages/marketing/security.tsx` | |
| `/terms` | `pages/marketing/terms.tsx` | |
| `/privacy` | `pages/marketing/privacy.tsx` | |
| `/compare` | `pages/marketing/switch-freshbooks.tsx` (comparison hub) | |
| `/switch-from-quickbooks` ‧ `-freshbooks` ‧ `-xero` ‧ `-wave` ‧ `-harvest` ‧ `-bigtime` ‧ `-scoro` ‧ `-paymo` | `pages/marketing/switch-*.tsx` | Competitor migration LPs |
| `/tour` | redirect → `/demo` | |
| `/blog`, `/careers` | redirect → `/` | Dead routes — see §6 |
| `/timesheets` | redirect → `/time` (auth) | |

### 1.2 Authenticated routes (inner `Router()`)

Every route below requires a session. Role gating is shown via the
wrapper component used in `App.tsx`:

- **`AdminRoute`** — `user.role === "ADMIN"`, else 403.
- **`ManagerRoute`** — `user.role === "ADMIN" || "MANAGER"`, else 403.
- **`LazyRoute`** — any authenticated role.

| Route | Component | Wrapper / Gating |
| --- | --- | --- |
| `/`, `/dashboard`, `/home` | `dashboard.tsx` | LazyRoute (all roles) |
| `/clients`, `/clients/:id` | `clients.tsx`, `client-detail.tsx` | LazyRoute |
| `/profile` | `profile.tsx` | LazyRoute |
| `/change-password` | `change-password.tsx` | LazyRoute |
| `/onboarding` | `onboarding.tsx` | LazyRoute (also auto-mounted for non-admins with `!onboardingComplete`) |
| `/projects`, `/projects/:id` | `projects.tsx`, `project-detail.tsx` | LazyRoute |
| `/time` | `time-tracking.tsx` | LazyRoute |
| `/invoices`, `/invoices/:id`, `/invoices/recurring` | `invoices.tsx`, `recurring-templates.tsx` | ManagerRoute |
| `/payments` | `payments.tsx` | ManagerRoute |
| `/payouts` | `payouts.tsx` | AdminRoute |
| `/reports` | `reports.tsx` | ManagerRoute |
| `/expenses` | `expenses.tsx` | LazyRoute |
| `/expense-reports` | `expense-reports.tsx` | LazyRoute (server checks role) |
| `/estimates` | `estimates.tsx` | ManagerRoute |
| `/notifications` | `notifications.tsx` | LazyRoute |
| `/activity` | `activity.tsx` | ManagerRoute |
| `/approvals` | `approvals.tsx` | ManagerRoute + tier gate (PROFESSIONAL+) |
| `/team` | `team.tsx` | ManagerRoute |
| `/import` | `import.tsx` | ManagerRoute |
| `/admin/rate-matrix/:projectId` | `admin/rate-matrix.tsx` | ManagerRoute |
| `/admin/m365-rescope` | `admin/m365-rescope.tsx` | LazyRoute + page-level `isPlatformOperator` gate |
| `/admin/marketing-retry-policies` | `admin/marketing-retry-policies.tsx` | LazyRoute + page-level operator/admin gate |
| `/admin/data`, `/admin/data/:entity`, `/admin/data/:entity/:id` | `admin-data-console.tsx` | AdminRoute |
| `/settings` | `settings.tsx` | AdminRoute |
| `/settings/brands` | `settings/brands.tsx` | AdminRoute |
| `/settings/billing` | `settings/billing.tsx` | AdminRoute |
| `/api-integrations` | `integrations.tsx` (top-level, not the public site) | AdminRoute |
| `/services` | `services.tsx` | ManagerRoute |
| `/accounting`, `/billing`, `/management` | hub pages | ManagerRoute |
| `/system` | `system.tsx` | AdminRoute |
| `/gl/accounts`, `/gl/ledger`, `/gl/journal-entries`, `/gl/trial-balance` | `gl-*.tsx` | ManagerRoute |
| `/banking` | `bank-connections.tsx` | AdminRoute |
| `/close-periods` | `close-periods.tsx` | ManagerRoute |
| `/getting-started` | `getting-started.tsx` (mounted by its own auth shell, not inner Router) | requires auth |
| `/marketing/contacts`, `/marketing/contacts/import`, `/marketing/contacts/:id`, `/marketing/companies`, `/marketing/companies/:id`, `/marketing/tags`, `/marketing/segments`, `/marketing/campaigns`, `/marketing/sequences`, `/marketing/activity` | `marketing-os/*.tsx` | ManagerRoute **+ `marketing_os` entitlement gate** (else `MarketingOsLockedCard` for any `/marketing/*`) |
| `/403`, `/500` | `error-403.tsx`, `error-500.tsx` | LazyRoute |
| `/__premium-showcase` | `__premium-showcase.tsx` | DEV-only (tree-shaken in prod) |
| _default_ (no match) | `not-found.tsx` | LazyRoute |

---

## 2. Per-Page Audit

For each page: purpose → user-facing features → gating → existing
specs → coverage label.

### 2.1 Authenticated app pages (top-level)

#### `/` `/dashboard` `/home` — `dashboard.tsx`
- **Purpose.** Personal/role overview: KPIs, active timer, project status,
  notifications, telemetry.
- **Features.** Outstanding/Collected/Net-Cash/Overdue KPI tiles; revenue
  trend chart; weekly time summary; team utilization list; active timer
  widget; recent activity feed; **admin-only** Email Failure Alerts card;
  Marketing OS telemetry widget (cleanup history, overdue banner,
  conversion funnel) — admin-only; role-aware variants from
  `role-dashboards-routes`.
- **Gating.** All authenticated roles. Admin-only widgets gated by role.
- **Specs.** `e2e/dashboard-kpi.spec.ts`,
  `e2e/email-failure-alerts-card.spec.ts`,
  `e2e/marketing-os-telemetry-widget.spec.ts`,
  `e2e/marketing-os-telemetry-cleanup-history.spec.ts`,
  `e2e/marketing-os-telemetry-cleanup-overdue.spec.ts`,
  `tests/e2e/smoke.spec.ts`, `tests/e2e/getting-started-theme.spec.ts`.
- **Coverage.** **Partial** — KPI + telemetry + alert card touched;
  role-aware variants, recent activity feed, drill-downs not asserted.

#### `/clients` — `clients.tsx`
- **Purpose.** Client list + lifecycle/source columns when Marketing OS
  active.
- **Features.** Searchable table, "Add Client" modal, status filter,
  archive bulk action.
- **Gating.** All roles; create/edit gated to MANAGER+ at the API.
- **Specs.** `tests/e2e/client-crud.spec.ts`.
- **Coverage.** **Partial** — CRUD covered; lifecycle filter, archive bulk
  not exercised.

#### `/clients/:id` — `client-detail.tsx`
- **Purpose.** One client's contacts, projects, invoices, notes, activity.
- **Features.** Contact table; primary-contact toggle; project list;
  invoice history; notes pane; activity timeline; billing settings form.
- **Specs.** Indirectly via `client-crud.spec.ts`.
- **Coverage.** **Partial**.

#### `/profile` — `profile.tsx` (987 lines)
- **Purpose.** Personal info + tax + payment + Stripe Connect.
- **Features.** Personal info form; address (structured); tax (W9/EIN
  last4); payment method (Bank/Zelle); worker type; agreement-signed
  toggle; avatar upload; Stripe Connect onboarding link.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/change-password` — `change-password.tsx`
- **Purpose.** Authenticated password change (also auto-shown when
  `user.tempPassword` is true).
- **Features.** Current/new password form with strength validation.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/onboarding` — `onboarding.tsx` (495 lines)
- **Purpose.** First-run wizard (firm profile, brand, optional Marketing OS).
- **Features.** Multi-step wizard.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/projects` — `projects.tsx`
- **Purpose.** Project directory + budget bars + member strip.
- **Features.** Card/list view; budget bars; "New Project" modal; client
  filter; status filter; member strip.
- **Specs.** `tests/e2e/project-crud.spec.ts`,
  `tests/integration/project-list-team-member-strip.test.ts`,
  `tests/integration/project-routes-cost-visibility.test.ts`.
- **Coverage.** **Partial** — CRUD + integration assertions covered;
  status filter and member-strip UI gating not asserted in E2E.

#### `/projects/:id` — `project-detail.tsx` (1136 lines)
- **Purpose.** Full project workspace.
- **Features.** Members & rates panel; services panel; time entries;
  expenses; invoices; budget vs actuals; archive/clone; link to
  `/admin/rate-matrix/:projectId`.
- **Specs.** Touched by `project-crud.spec.ts` and `womb-to-tomb.spec.ts`.
- **Coverage.** **Partial**.

#### `/time` — `time-tracking.tsx` (1423 lines)
- **Purpose.** Daily/weekly time logging.
- **Features.** Weekly grid; start/stop timer; project & service
  selectors; notes; billable toggle; copy-week; submit-for-approval;
  week navigation.
- **Specs.** `tests/e2e/time-crud.spec.ts`, `tests/e2e/timesheet.spec.ts`.
- **Coverage.** **Partial** — CRUD covered; copy-week, submit, week-nav
  untested.

#### `/invoices`, `/invoices/:id` — `invoices.tsx` (2263 lines)
- **Purpose.** AR hub.
- **Features.** Status filters (DRAFT/SENT/PAID/PARTIAL/VOID); bulk send;
  bulk remind; AR totals summary; CSV/PDF export; theme picker;
  send-with-AVS; line-item editor; multi-currency.
- **Gating.** ManagerRoute.
- **Specs.** `tests/e2e/invoice-crud.spec.ts`,
  `tests/e2e/email-resend.spec.ts`,
  `e2e/email-oauth-happy-path.spec.ts`, `e2e/dashboard-kpi.spec.ts`.
- **Coverage.** **Partial** — CRUD + send happy path covered; bulk
  actions, themes, multi-currency rollup, void/partial transitions, CSV
  export untested.

#### `/invoices/recurring` — `recurring-templates.tsx`
- **Purpose.** Recurring invoice templates.
- **Features.** Template list; "Generate now"; frequency editor; next-run
  preview.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/payments` — `payments.tsx` (2015 lines)
- **Purpose.** Payment history + manual entry + refunds.
- **Features.** Payment table; record-manual-payment dialog; refund;
  allocate to invoice; Stripe link-back; multi-currency rollup.
- **Specs.** `tests/e2e/payment-crud.spec.ts`,
  `tests/e2e/stripe-webhook.spec.ts`.
- **Coverage.** **Partial** — manual payment covered; refunds, partial
  allocations untested.

#### `/payouts` — `payouts.tsx` (771 lines)
- **Purpose.** Stripe Connect payouts.
- **Features.** Status table (PENDING/COMPLETED/VOID); reconcile; void.
- **Gating.** AdminRoute.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/reports` — `reports.tsx` (969 lines)
- **Purpose.** Time/revenue/profitability/WIP/1099 reporting suite.
- **Features.** Tabs for each report; date-range filter chips
  (YTD/QTD/MTD/custom); CSV export; scheduled reports.
- **Gating.** ManagerRoute.
- **Specs.** `e2e/reports-filter-chips.spec.ts`,
  `tests/e2e/profitability-wip-1099.spec.ts`.
- **Coverage.** **Partial** — chips + 3 reports covered; CSV exports +
  scheduled reports untested.

#### `/expenses` — `expenses.tsx`
- **Purpose.** Expense capture + OCR.
- **Features.** Drag-and-drop receipt upload; Groq OCR (Tesseract
  fallback); category filter; multi-currency; submit-for-reimbursement.
- **Specs.** None E2E; OCR fallback path untested at any level.
- **Coverage.** **Untested**.

#### `/expense-reports` — `expense-reports.tsx`
- **Purpose.** Submitted reports + manager approve/reject.
- **Features.** Status badges (Draft/Submitted/Approved/Paid);
  approve/reject (manager).
- **Specs.** Server-side only:
  `tests/integration/expense-approval-emails-route.test.ts`,
  `tests/integration/expense-rejection-emails-route.test.ts`.
- **Coverage.** **Untested** (UI).

#### `/estimates` — `estimates.tsx`
- **Purpose.** Estimate hub.
- **Features.** Status table; "Create Estimate" wizard; PDF export;
  convert-to-invoice; public-link share; client accept/decline (via
  `/e/:token`).
- **Gating.** ManagerRoute.
- **Specs.** `tests/e2e/estimates.spec.ts`.
- **Coverage.** **Partial** — happy path; convert-to-invoice and
  client accept/decline untested.

#### `/notifications` — `notifications.tsx`
- **Purpose.** In-app notification list.
- **Features.** List; mark-read; type filters.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/activity` — `activity.tsx`
- **Purpose.** Org-wide audit/activity log.
- **Features.** Search by user/entity; date filter.
- **Gating.** ManagerRoute.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/approvals` — `approvals.tsx`
- **Purpose.** Manager review of submitted hours.
- **Features.** Weekly grid of submitted hours; bulk approve/reject;
  status filters (Pending/Approved); UpgradeWall when tier <
  PROFESSIONAL.
- **Gating.** ManagerRoute + `requireMinTier("PROFESSIONAL")`.
- **Specs.** `tests/e2e/approvals-crud.spec.ts`,
  `tests/unit/approvals-bulk.test.ts`. Tier gate behaviour **not** E2E.
- **Coverage.** **Partial** — happy-path bulk covered; tier-gate UX
  untested.

#### `/team` — `team.tsx` (1722 lines)
- **Purpose.** Member management.
- **Features.** Invite member; role picker (Admin/Manager/Team);
  seat limit indicator; deactivate/reactivate; edit member; cost-rate
  fields; payroll provider hookup; 1099 eligibility.
- **Gating.** ManagerRoute; seat limits via `useBillingStatus`.
- **Specs.** `tests/e2e/team-member-flow.spec.ts`.
- **Coverage.** **Partial** — invite/role covered; seat-limit edge
  cases (over-quota), deactivate/reactivate, pay-rate fields untested.

#### `/import` — `import.tsx`
- **Purpose.** External data import wizard.
- **Features.** CSV import for clients/projects/time/invoices from
  FreshBooks/QuickBooks/Xero; preview; conflict resolution.
- **Gating.** ManagerRoute.
- **Specs.** `tests/e2e/import-wizard.spec.ts`,
  `tests/unit/contact-import.test.ts`, fixtures
  `tests/fixtures/freshbooks/`.
- **Coverage.** **Partial** — one source path covered; conflict
  resolution UI untested.

#### `/admin/data*` — `admin-data-console.tsx`
- **Purpose.** Low-level entity browser/editor for admins.
- **Features.** Entity picker (Clients/Projects/Invoices/etc.);
  searchable tables; record detail; CRUD forms.
- **Gating.** AdminRoute.
- **Specs.** `tests/e2e/admin-data-console.spec.ts`,
  `tests/unit/admin-data-console.test.ts`.
- **Coverage.** **Partial** — single entity tab fully exercised.

#### `/admin/rate-matrix/:projectId` — `admin/rate-matrix.tsx`
- **Purpose.** Per-project bill/cost rate grid.
- **Features.** Member×Service grid; inline numeric editors; delete.
- **Gating.** ManagerRoute.
- **Specs.** Unit-only (`tests/unit/rate-matrix-*.test.ts`).
- **Coverage.** **Untested** (UI E2E).

#### `/admin/m365-rescope` — `admin/m365-rescope.tsx`
- **Purpose.** Push M365 OAuth scope upgrades to orgs.
- **Features.** Scan; affected-orgs table; bulk email notification.
- **Gating.** Page-level `isPlatformOperator` (global owner only).
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/admin/marketing-retry-policies` — `admin/marketing-retry-policies.tsx`
- **Purpose.** Cross-org retry/backoff policy admin card.
- **Features.** Per-org retry/backoff settings; status indicators.
- **Specs.** Org-scoped flow covered by
  `e2e/settings-marketing-retry-policy.spec.ts`;
  `tests/integration/marketing-retry-policies-route.test.ts`. The
  cross-org admin _card_ UI is listed as a planned follow-up task in
  the project task list.
- **Coverage.** **Partial**.

#### `/settings` — `settings.tsx` (2107 lines)
- **Purpose.** Workspace settings hub (tabs).
- **Features.** General; accounting/email tabs (transport health,
  webhook config + recent test history, suppressions list, retry
  policy); MFA; SAML; security headers; GDPR exports; notification
  preferences; quiet hours; retention.
- **Gating.** AdminRoute.
- **Specs.** `e2e/email-alert-webhook-panel.spec.ts`,
  `e2e/email-failure-alerts-card.spec.ts`,
  `e2e/email-recipient-suppression*.spec.ts`,
  `e2e/email-transport-health-panel.spec.ts`,
  `e2e/settings-marketing-retry-policy.spec.ts`, plus many
  `tests/unit/email-*` component tests.
- **Coverage.** **Partial** — email/health/webhook tabs heavily
  covered; MFA, SAML, GDPR export, retention, quiet-hours UI
  untested.

#### `/settings/brands` — `settings/brands.tsx`
- **Purpose.** Multi-brand config.
- **Features.** Brand cards; create/edit (name, logo, colors); default
  toggle.
- **Gating.** AdminRoute.
- **Specs.** `e2e/brands-smoke.spec.ts`,
  `tests/integration/brand-stats-cache-*.test.ts`,
  unit `brands-*.test.ts` family.
- **Coverage.** **Partial** — CRUD covered; logo URL validation +
  color picker via unit tests; default-toggle interaction not E2E.

#### `/settings/billing` — `settings/billing.tsx`
- **Purpose.** Subscription + add-on management.
- **Features.** Plan/seats display; "Manage in Stripe"; entitlement
  add-on cards (Marketing OS); grace-period badges; upgrade CTA.
- **Gating.** AdminRoute.
- **Specs.** `tests/unit/addon-checkout-route.test.ts`,
  `tests/unit/addon-webhook.test.ts`, `entitlements-grace.test.ts`.
  UI not E2E-covered.
- **Coverage.** **Partial**.

#### `/services` — `services.tsx`
- **Purpose.** Org service catalog.
- **Features.** List (name, default rate, active flag); CRUD.
- **Gating.** ManagerRoute.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/accounting`, `/billing`, `/management`, `/system` — hub pages
- **Purpose.** Card-link landing pages routing to GL/AP/AR/HR/Admin
  sections.
- **Gating.** ManagerRoute, except `/system` which is AdminRoute.
- **Specs.** Render-touched by `tests/e2e/smoke.spec.ts` only.
- **Coverage.** **Partial** (render-only).

#### `/gl/accounts` — `gl-accounts.tsx`
- **Purpose.** Chart of accounts.
- **Features.** Hierarchical list; type classification (Asset, Liability,
  Equity, Revenue, Expense, Cost-of-Services); new-account form.
- **Gating.** ManagerRoute.
- **Specs.** `tests/test-gl-accounts.spec.ts`,
  `tests/test-gl-accounts.js`.
- **Coverage.** **Partial**.

#### `/gl/ledger`, `/gl/journal-entries`, `/gl/trial-balance`
- **Purpose.** Ledger drill-down, JE grid (debit/credit), trial balance
  with collapsible sections.
- **Features.** Account filter; period filter; auto-post-on-paid-invoice
  flag effects; close-period interaction.
- **Gating.** ManagerRoute.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/banking` — `bank-connections.tsx`
- **Purpose.** Bank connection management.
- **Features.** Plaid/Stripe connection cards; sync status; manual entry.
- **Gating.** AdminRoute.
- **Specs.** `tests/unit/banking-auto-match.test.ts` only.
- **Coverage.** **Untested** (UI).

#### `/close-periods` — `close-periods.tsx`
- **Purpose.** Open/close fiscal periods.
- **Features.** Open/close period; lock entries; reopen.
- **Gating.** ManagerRoute.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/api-integrations` — `integrations.tsx` (top-level, 749 lines)
- **Purpose.** API keys + webhook subscriptions + OpenAPI link.
- **Gating.** AdminRoute.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/getting-started` — `getting-started.tsx`
- **Purpose.** First-run guidance shell.
- **Specs.** `tests/e2e/getting-started-theme.spec.ts` (theme smoke).
- **Coverage.** **Partial**.

#### `/login` — `login.tsx`
- **Purpose.** Sign in.
- **Features.** Email/password; "Forgot password?" link; multi-org picker
  (when email matches more than one org); "Remember workspace"
  (`localStorage`); MFA prompt.
- **Specs.** `e2e/login-auto-pick-workspace.spec.ts`,
  `tests/e2e/smoke.spec.ts`. MFA prompt + multi-org picker UI **not**
  E2E.
- **Coverage.** **Partial**.

#### `/forgot-password` — `forgot-password.tsx`
- **Purpose.** Send reset email.
- **Specs.** None directly.
- **Coverage.** **Untested**.

#### `/reset-password/:token` — `reset-password.tsx`
- **Purpose.** Token-based password reset (route shape verified —
  matches via `location.startsWith("/reset-password/")`).
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/403`, `/500`, NotFound (default)
- **Purpose.** Error pages with `data-testid="text-error-title"`.
- **Specs.** Render touched by smoke / full-lifecycle.
- **Coverage.** **Partial** — no spec asserts each is reached for the
  right reason (e.g. role mismatch → 403, fallthrough → 404).

#### `/__premium-showcase` — `__premium-showcase.tsx`
- DEV-only. Out of scope.

### 2.2 Public token pages

#### `/i/:token` — `public-invoice.tsx` (397 lines)
- **Purpose.** Pay or view invoice without login.
- **Features.** Invoice viewer; "Pay" CTA → Stripe Checkout; download
  PDF.
- **Specs.** `tests/e2e/public-invoice.spec.ts`.
- **Coverage.** **Partial** — happy path; expired/invalid token
  untested.

#### `/e/:token` — `public-estimate.tsx` (226 lines)
- **Purpose.** View estimate; accept/decline.
- **Features.** Estimate viewer; Accept/Decline buttons.
- **Specs.** None.
- **Coverage.** **Untested**.

#### `/portal/:token` — `client-portal.tsx`
- **Purpose.** Long-lived client-portal landing for a specific client.
- **Specs.** `tests/e2e/client-portal.spec.ts`,
  `tests/unit/client-portal.test.ts`.
- **Coverage.** **Partial**.

### 2.3 Marketing OS pages (`pages/marketing-os/`)

All gated by **`marketing_os` entitlement** (server + `useEntitlement`
in `App.tsx`) **and** `ManagerRoute`. Without the entitlement, every
`/marketing/*` falls into `MarketingOsLockedCard`.

#### `/marketing/contacts` — `contacts.tsx`
- **Features.** Contacts list; lifecycle/lead-status filters;
  multi-select bulk tag/update; "Save as Segment"; brand-aware columns;
  link to import.
- **Specs.** `e2e/marketing-contacts-smoke.spec.ts`,
  `e2e/marketing-add-brand-lock.spec.ts`,
  `e2e/marketing-os-brand-switch.spec.ts`.
- **Coverage.** **Partial** — CRUD covered; bulk filters and saved
  segments not exhaustively asserted.

#### `/marketing/contacts/import` — `contacts-import.tsx` (1722 lines)
- **Features.** CSV upload; column mapping wizard; dedupe/merge preview;
  dry-run import.
- **Specs.** `tests/unit/contact-import.test.ts` only.
- **Coverage.** **Untested** (UI).

#### `/marketing/contacts/:id` — `contact-detail.tsx`
- **Features.** Activity timeline; owner; tags; segments; enrollments;
  send history; unsubscribe/bounce flags.
- **Specs.** Touched by contacts-smoke.
- **Coverage.** **Partial**.

#### `/marketing/companies` — `companies.tsx`
- **Features.** Company table; industry/size filters; "Add Company";
  auto-link contacts by domain.
- **Specs.** `e2e/marketing-companies-smoke.spec.ts`,
  `e2e/marketing-add-brand-lock.spec.ts`.
- **Coverage.** **Partial** — CRUD + auto-link covered by smoke;
  filters not exhaustively asserted.

#### `/marketing/companies/:id` — `company-detail.tsx`
- **Features.** Company profile; related contacts; activity; tags.
- **Specs.** Touched by companies-smoke.
- **Coverage.** **Partial**.

#### `/marketing/tags` — `tags.tsx`
- **Features.** Tag CRUD; bulk assign/unassign across contacts;
  cross-brand validation (400s expected).
- **Specs.** `e2e/marketing-tags-smoke.spec.ts`,
  `tests/integration/marketing-tags-routes.test.ts`.
- **Coverage.** **Covered**.

#### `/marketing/segments` — `segments.tsx`
- **Features.** Segment CRUD; AND-intersect filter builder; member
  count; cleanup cascade.
- **Specs.** `e2e/marketing-segments-smoke.spec.ts`,
  `tests/integration/marketing-segments-routes.test.ts`.
- **Coverage.** **Covered**.

#### `/marketing/campaigns` — `campaigns.tsx` (937 lines)
- **Features.** Campaign list (Draft/Running/Sent/Failed); editor with
  audience picker, large-audience warning, recipient preview, schedule;
  failures dialog; metrics tiles.
- **Specs.** `e2e/marketing-campaign-audience-picker.spec.ts`,
  `e2e/marketing-campaign-audience-preview.spec.ts`,
  `e2e/marketing-campaign-large-audience-warning.spec.ts`,
  `e2e/marketing-campaign-sequence-editors.spec.ts`,
  `tests/integration/marketing-campaigns-audience-routes.test.ts`.
- **Coverage.** **Partial** — editor covered; metrics drill-down +
  scheduled-send worker not asserted from UI.

#### `/marketing/sequences` — `sequences.tsx` (1215 lines)
- **Features.** Multi-step sequence builder; enrollment table;
  pause/resume; failures dialog (per-step + all-step).
- **Specs.** `e2e/marketing-campaign-sequence-editors.spec.ts`,
  `e2e/marketing-sequence-enrollment-cadence.spec.ts`,
  `e2e/marketing-sequence-enrollment-failure-cadence.spec.ts`,
  `e2e/marketing-sequence-failures-dialog.spec.ts`. (Recipient-count
  preview UI is queued as a follow-up task.)
- **Coverage.** **Partial**.

#### `/marketing/activity` — `marketing-os/activity.tsx`
- **Features.** Activity firehose; filter by type/date/limit;
  per-contact timeline isolation.
- **Specs.** `e2e/marketing-os-activity.spec.ts`.
- **Coverage.** **Covered**.

### 2.4 Public marketing site

> Copy was rebranded in earlier sprints — that work is out of scope.
> Audit catalogs route + behavior only.

| Route | File (lines) | Notable behavior | Coverage |
| --- | --- | --- | --- |
| `/` (logged out) | `marketing/home.tsx` (1223) | Hero, KPI showcase, feature grid, CTAs to `/signup` and `/demo` | **Partial** — `tests/e2e/smoke.spec.ts` & `e2e/full-lifecycle.spec.ts` touch render |
| `/features` | `marketing/features.tsx` (1337) | Feature deep-dive sections | **Untested** |
| `/pricing` | `marketing/pricing.tsx` (375) | Tier cards; Stripe Checkout deep-link | **Untested** |
| `/marketing` | `marketing/marketing.tsx` (1340) | Marketing OS add-on landing | **Untested** |
| `/signup` | `marketing/signup.tsx` (410) | Email/name/password → POST `/api/auth/signup` (creates Stripe customer + 14d TRIAL org) | **Untested** |
| `/about` | `marketing/about.tsx` (267) | Static | **Untested** |
| `/contact` | `marketing/contact.tsx` (292) | Contact form → server | **Untested** |
| `/demo` | `marketing/demo.tsx` (1878) | Interactive UI mockups (no backend) | **Partial** (smoke render) |
| `/integrations` | `marketing/integrations.tsx` (212) | Static integrations grid | **Untested** |
| `/security` | `marketing/security.tsx` (104) | Static | **Untested** |
| `/terms` | `marketing/terms.tsx` (118) | Static | **Untested** |
| `/privacy` | `marketing/privacy.tsx` (108) | Static | **Untested** |
| `/compare` | `marketing/switch-freshbooks.tsx` (289) | Comparison hub matrix + filters | **Untested** |
| `/switch-from-quickbooks` ‧ `-freshbooks` ‧ `-xero` ‧ `-wave` ‧ `-harvest` ‧ `-bigtime` ‧ `-scoro` ‧ `-paymo` | `marketing/switch-*.tsx` (~258 ea.) | Pain grid; head-to-head; migration timeline; CTA | **Untested** |

---

## 3. Cross-Cutting Concerns

### 3.1 Auth flows
- **Login** — `server/routes/auth-routes.ts`. Multi-org picker when an
  email exists in multiple orgs (returns the org list from
  `/api/auth/login`). Sessions persisted in PG (`connect-pg-simple`).
  MFA prompt when `mfaPending` is set.
  - Covered: `e2e/login-auto-pick-workspace.spec.ts`, smoke.
  - **Untested:** MFA prompt UI; multi-org picker UI; failed-login
    lockout; password-strength banner.
- **Signup** — `auth-routes.ts:362`. Creates Stripe customer + 14-day
  TRIAL org. **No E2E spec.**
- **Password reset** — `forgotPasswordLimiter` + email + token table
  `passwordResetTokens`; route is `/reset-password/:token`. **No E2E.**
- **Idle timeout** — `SESSION_IDLE_TIMEOUT_MS = 30 min` in
  `server/routes.ts`; destroys session and 401s. **No E2E.**
- **Session activity write-through** — DB updates throttled to 60s.
- **Role guards** — `requireAdmin`, `requireManagerOrAbove`,
  `requireAdminOrManager` in `routes/middleware.ts`; `AdminRoute` /
  `ManagerRoute` in `App.tsx`. Partially covered via API specs.
- **Multi-org switching** — `BrandSwitcher` (sidebar) for brand swap;
  org switch is implicit at login.
  `e2e/marketing-os-brand-switch.spec.ts` covers brand switch.
- **CSRF** — token cookie + header pair; exempt prefix list in
  `server/routes.ts`. No dedicated spec.

### 3.2 Tier gating
Tiers (`shared/tier-order.ts`): `TRIAL=0`, `STARTER=1`,
`PROFESSIONAL=2`, `BUSINESS=3`, `ENTERPRISE=4`. Server-side enforced
via `requireTier(minTier)` in `server/lib/tier-gate.ts`.

Visible gating in app:
- **`/approvals`** — `requireMinTier("PROFESSIONAL")` (UpgradeWall).
- **Marketing OS** — auto-granted on BUSINESS/ENTERPRISE; otherwise
  add-on (`server/services/marketing-os-tier.ts`).
- Various API routes (audit reports, scheduled reports) gate higher
  tiers.

**Coverage.** Entitlement on/off covered by `entitlement-on-smoke` and
`entitlement-off-smoke` for Marketing OS. Tier-derived migration
covered by `marketing-os-tier-derived-migration.test.ts`. Approvals
tier gate **untested in E2E**. Other tier-gated APIs **untested**.

### 3.3 Multi-tenant org isolation
- Every storage method scopes by `req.session.orgId`. Storage interface
  in `server/storage.ts` always applies
  `where(eq(table.orgId, orgId))`.
- Entitlement context cached per-request via `AsyncLocalStorage`.
- Tested at the seam: `tests/integration/brand-stats-cache-cross-org.test.ts`,
  `tests/integration/cleanup-e2e-brand-pollution-org-scope.test.ts`.
- **Gap.** No end-to-end spec proves user A in org X cannot read/write
  data in org Y across all entity types — needed.

### 3.4 Feature flags
- **`MARKETING_OS_ENABLED`** — env-level kill switch read in
  `server/lib/featureFlags.ts` and on the client. Independent of the
  per-org `marketing_os` entitlement.
- **`EMAIL_OAUTH_ENABLED`** — gates Gmail + M365 OAuth flows in
  `server/email/feature-flag.ts`, `routes/oauth-mailbox-routes.ts`.
- **Coverage.** Off/on env-flag behavior covered at E2E by
  `e2e/feature-flag-marketing-os.spec.ts` (brands + marketing chat 404
  when flag OFF; brands reachable when flag ON; entitlement gate still
  fires when flag ON but entitlement absent) and
  `e2e/feature-flag-email-oauth.spec.ts` (oauth start/callback 404 +
  `oauthFlagEnabled=false` when flag OFF; reachable + flag-enabled
  surface when flag ON). Both rely on a dev-only runtime override
  endpoint at `POST /api/__test__/feature-flags`. **Gap remaining:**
  the marketing kill switch is currently only wired into
  `routes/brands.ts` and `routes/marketing/chat.ts`; the
  `requireFeature("marketing_os")` middleware is entitlement-only, so
  flag-OFF + entitlement-ON still serves `/api/marketing/contacts` &
  friends. Sidebar visibility is also entitlement-only. Tracked under
  audit §7 #15 — refactor out of scope for this task.

### 3.5 Error pages
- 403 → `pages/error-403.tsx` (rendered by `AdminRoute`/`ManagerRoute`
  on role mismatch).
- 500 → `pages/error-500.tsx` (rendered by `ErrorBoundary` on render
  crash; also reachable directly at `/500`).
- Not-found → `pages/not-found.tsx` (default `<Route>` in `App.tsx`).
- Each has `data-testid="text-error-title"`. **No spec asserts each is
  reachable for the right reason** (role mismatch → 403, unknown URL
  → 404).

### 3.6 Integration touchpoints
| Integration | Location | Used for | E2E coverage |
| --- | --- | --- | --- |
| Stripe (subscriptions, Checkout, Connect, webhooks) | `server/stripe.ts`, `server/stripe_webhook.ts`, `routes/auto-charge-routes.ts`, `routes/payout-routes.ts`, `routes/entitlement-checkout-routes.ts` | Plan tier billing, add-on Checkout, Connect payouts | `tests/e2e/stripe-webhook.spec.ts`, unit `addon-webhook.test.ts`, `addon-checkout-route.test.ts` |
| Groq OCR | `server/lib/llm-providers.ts` | Receipt OCR primary | None |
| Tesseract fallback | `server/lib/llm-providers.ts` | Receipt OCR fallback | None |
| M365 Graph | `server/email/graph-transport.ts`, `routes/oauth-mailbox-routes.ts`, `routes/admin/m365-rescope` | OAuth-sent email | `e2e/email-oauth-happy-path.spec.ts` (redirect only) |
| Gmail | `server/email/gmail-transport.ts` | OAuth-sent email | None |
| Frankfurter FX | `server/exchange-rates.ts` | Multi-currency conversion | None |
| Clearbit logos | `routes/middleware.ts:fetchClientLogo` | Auto-pull client logos | None |
| Resend (inbound webhook) | `routes/resend-inbound-routes.ts`, `routes/email-alert-webhook-routes.ts` | Inbound bounce/complaint events | unit + integration |

### 3.7 Entitlements system
- API: `GET /api/me/entitlements` (boolean map);
  `GET /api/me/entitlements/details` (admin-only — grace +
  tier-derived).
- Service: `EntitlementService` in
  `server/services/entitlements.ts`. Combines `org_entitlements` rows +
  tier-derived rules. 7-day grace on `past_due`.
- Frontend: `useEntitlement(feature)` + `<EntitlementGate>` in
  `client/src/lib/entitlements.tsx`.
- **Coverage.** `entitlements-grace.test.ts` (unit),
  `marketing-os-tier-derived-migration.test.ts` (integration),
  `entitlement-on-smoke` / `entitlement-off-smoke` (E2E for
  `marketing_os`). Other entitlements not E2E-gated today (none used
  in app).

---

## 4. Existing Test Suite Map

### 4.1 `e2e/` (32 specs — picked up by `playwright.config.ts`)
| Spec | Pages exercised |
| --- | --- |
| `brands-smoke.spec.ts` | `/settings/brands`, `/invoices` regression |
| `dashboard-kpi.spec.ts` | `/dashboard` Outstanding/Collected after invoice + payment |
| `email-alert-webhook-panel.spec.ts` | `/settings#accounting-email` webhook config + recent test history; non-admin block |
| `email-failure-alerts-card.spec.ts` | `/dashboard` failure alerts card |
| `email-oauth-happy-path.spec.ts` | `/api/org/email-provider`; SMTP transport + M365 OAuth redirect |
| `email-recipient-suppression-non-admin.spec.ts` | `/api/admin/email/masked-suppressions` 403 for non-admin |
| `email-recipient-suppression.spec.ts` | `/settings#accounting-email` suppress / unsuppress |
| `email-transport-health-panel.spec.ts` | `/settings#accounting-email` transport health + breach drill-down |
| `entitlement-off-smoke.spec.ts` | `/marketing/*` 404 stealth contract |
| `entitlement-on-smoke.spec.ts` | `/marketing/*` access + sidebar |
| `full-lifecycle.spec.ts` | App-wide (marketing → auth → dashboard → core CRUD) |
| `login-auto-pick-workspace.spec.ts` | `/login` last-used workspace |
| `marketing-add-brand-lock.spec.ts` | `/marketing/contacts` & `companies` Add dialogs lock to active brand |
| `marketing-campaign-audience-picker.spec.ts` | `/marketing/campaigns` audience picker persistence |
| `marketing-campaign-audience-preview.spec.ts` | `/marketing/campaigns` recipient count preview |
| `marketing-campaign-large-audience-warning.spec.ts` | `/marketing/campaigns` soft warning |
| `marketing-campaign-sequence-editors.spec.ts` | `/marketing/campaigns` and `/marketing/sequences` editor flows |
| `marketing-companies-smoke.spec.ts` | `/marketing/companies` CRUD + auto-link |
| `marketing-contacts-smoke.spec.ts` | `/marketing/contacts` CRUD + activity + filters |
| `marketing-os-activity.spec.ts` | `/marketing/activity` filters + per-contact isolation |
| `marketing-os-brand-switch.spec.ts` | App-wide BrandSwitcher behavior |
| `marketing-os-gate-bypass.spec.ts` | `/marketing/*` brand or entitlement bypasses firm-profile gate |
| `marketing-os-telemetry-cleanup-history.spec.ts` | Dashboard telemetry "View history" |
| `marketing-os-telemetry-cleanup-overdue.spec.ts` | Dashboard telemetry overdue/missing banners |
| `marketing-os-telemetry-widget.spec.ts` | Dashboard funnel widget |
| `marketing-segments-smoke.spec.ts` | `/marketing/segments` CRUD + AND-intersect |
| `marketing-sequence-enrollment-cadence.spec.ts` | `/api/marketing/sequences` step dispatch |
| `marketing-sequence-enrollment-failure-cadence.spec.ts` | `/api/marketing/sequences` failure cadence |
| `marketing-sequence-failures-dialog.spec.ts` | `/marketing/sequences` failures dialog from list + editor |
| `marketing-tags-smoke.spec.ts` | `/marketing/tags` CRUD + bulk assign + cross-brand |
| `reports-filter-chips.spec.ts` | `/reports` filter chips + YTD reset |
| `settings-marketing-retry-policy.spec.ts` | `/settings#accounting-email` retry policy controls |

### 4.2 `tests/e2e/` (21 specs — NOT picked up by default)
admin-data-console, approvals-crud, client-crud, client-portal,
email-resend, estimates, getting-started-theme, import-wizard,
invoice-crud, mobile, payment-crud, profitability-wip-1099,
project-crud, public-invoice, smoke, stripe-webhook, team-member-flow,
time-crud, timesheet, womb-to-tomb (+ shared `global-setup.ts`).

### 4.3 `tests/integration/` (26 specs)
Server-side route + service tests — see the module list. Particularly
relevant for the next task: `marketing-campaigns-audience-routes`,
`marketing-segments-routes`, `marketing-tags-routes`,
`marketing-os-telemetry-*`, `email-failure-alerts-route`,
`email-recipient-suppressions-auto-expiry`,
`brand-stats-cache-*`, `cleanup-e2e-brand-pollution-org-scope`,
`project-routes-cost-visibility`, `project-list-team-member-strip`.

### 4.4 `tests/unit/` (122 tests)
Component + pure-logic tests (theme flip, brands, email panels,
approvals bulk, entitlements grace, addon webhook, addon checkout,
banking auto-match, etc.).

---

## 5. Test Infrastructure Findings

### 5.1 Current Playwright configuration (`playwright.config.ts`)
- `testDir: ./e2e`, `globalSetup: ./e2e/global-setup.ts`.
- `workers: 1`, `fullyParallel: false` — strict serial execution to
  avoid races on the shared DB.
- `retries: 0`. Reporters: `line` + `json` to
  `test-results/results.json`.
- Timeouts: test 30s, expect 8s, action 8s, navigation 15s.
- `baseURL: http://localhost:${PORT||5000}`.
- **No `projects` array** — single default project, no per-browser
  matrix.
- **`tests/e2e/` specs are not picked up** by default — they only run
  via the `test:e2e` script chain. Discoverability hazard (see §6).

### 5.2 `e2e/global-setup.ts`
- Resets the seeded admin password
  (`dean@cherrystconsulting.com` → `admin123`).
- Runs `sweepE2ETestPollution` to purge stale BrandB / Phase7 Activity
  Brands data.
- Hits `POST /api/test/reset-db` (header `X-Test-Secret`) to seed.
- Short-circuits if `DATABASE_URL` is unset.

### 5.3 Vitest setup (`vitest.config.ts`, `tests/setup/global-setup.ts`)
- Spawns a dedicated test server on port `5100`
  (`NODE_ENV=test`, `E2E_SEED_ENABLED=true`), killing any prior
  listener on that port.
- `environmentMatchGlobs` switches between `node` (default) and
  `jsdom` for React component tests.
- Aliases: `@`, `@shared`, `@assets`.
- `tests/helpers/base.ts` exports `TEST_BASE` (default
  `127.0.0.1:5100`).

### 5.4 Existing helpers / fixtures
- `tests/fixtures/freshbooks/clients_sample.csv` — import fixture.
- `tests/helpers/base.ts` — single-source TEST_BASE.
- `tests/setup/jest-dom.ts` — `@testing-library/jest-dom`.
- `tests/cleanup/*.sql` — purge scripts respecting FK order.
- `tests/proof/*.md` — fix-bundle proofs (RCA + computation receipts).
- `tests/unit/premium-theme-flip.helper.ts` — parses real CSS files for
  dark/light theme tests.

### 5.5 Auth in E2E specs today
- Each spec fills the login form, and many _also_ POST
  `/api/auth/login` to capture the session cookie for direct API
  calls.
- **No `storageState` reuse**, no auth fixture, no per-role pre-auth.
- With `workers: 1`, login costs serialize.

### 5.6 DB-state assumptions
- Seed via `E2E_SEED_ENABLED=true`. Specs frequently mint unique data
  (`"E2E Client " + Date.now()`). Some clean up explicitly; many rely
  on the global pollution sweep at the next run.
- **Reset cadence:** once per run (`globalSetup`), not per-spec. Risk
  of bleed-through grows linearly with spec count.

### 5.7 Infrastructure changes needed for a 250+ spec suite
1. **Promote to `fullyParallel: true` with `workers: 4` minimum**,
   after moving each spec onto an isolated org. Today's serial
   execution will make a 250-spec suite intolerably slow.
2. **Per-spec org isolation.** Add a fixture that creates a fresh org
   + admin (or assigns from a pool) per spec/worker. Unlocks parallel
   execution and removes pollution coupling.
3. **Auth fixtures with `storageState`.** Pre-authenticated cookies
   for ADMIN, MANAGER, TEAM_MEMBER, plus a marketing-OS-enabled and
   marketing-OS-disabled variant. Cuts ~2s × 250 specs of login
   overhead.
4. **Sharding.** Add Playwright `--shard` flag plumbing in
   `package.json` so CI can run e.g. 4 shards in parallel.
5. **Single `testDir` (or `projects`) covering both `e2e/` and
   `tests/e2e/`** — currently the latter is invisible to default
   `playwright test` runs.
6. **DB reset endpoint hardening.** `POST /api/test/reset-db` is the
   seam for any per-spec/per-worker reset. Verify it's snapshot-based
   (or fast) before invoking it 250+ times.
7. **Fixture organization.** Centralize page-object helpers (login,
   create-client, create-invoice, etc.) under `tests/helpers/po/` so
   specs author against stable selectors.
8. **Standardize `data-testid` audit** — most pages already follow the
   pattern, but new specs should rely on `data-testid` exclusively
   (no role/text selectors).
9. **CI flake budget.** With `retries: 0`, a 250-spec suite cannot
   tolerate even mild flakiness. Bump to `retries: 1` in CI.

---

## 6. Bugs / Fragile UI / Dead Code Found During the Audit

### 6.1 Findings from live browser walks

1. **`AdminSetupGate` is a swallowing gate, not a redirect.** When an
   ADMIN user logs in and `firmProfileComplete=false`, _every_ route
   in the inner `Router()` except `/getting-started` and `/profile`
   (and `/marketing/*` when `marketing_os` is active or any brand
   exists) renders the `<AdminSetupGate>`'s Getting Started shell —
   the URL stays at e.g. `/clients` while the page body shows
   "Mission Control / Setup 0/5 / Clients 0 / Invoiced $0 / Hours 0.0".
   This was confirmed in the live admin walk: visiting `/clients`,
   `/projects`, `/time`, `/invoices`, `/payments`, `/reports`,
   `/expenses`, `/estimates`, `/team`, `/settings`,
   `/settings/brands`, `/settings/billing`, `/gl/accounts`,
   `/gl/trial-balance`, `/banking`, `/payouts`, `/admin/data`,
   `/api-integrations`, `/403`, `/500`, _and_ `/unknown-route-xyz` all
   rendered the same Mission Control body. Only `/profile` rendered
   distinct content.
   - **Implication for tests.** Every spec touching an admin-side page
     must first complete the firm profile (or seed
     `firmProfileComplete=true`) — otherwise it asserts against the
     gate, not the page. The current spec suite mostly works because
     it operates against the seeded admin org which already has the
     profile completed in fixture data; the moment a per-spec org
     fixture is introduced (recommended in §5.7), this gate must be
     pre-completed.
   - **Implication for users.** Errors are also gated: navigating to
     `/403`, `/500`, or an unknown route while gated does **not**
     show the error page — it shows the gate. There is no way for an
     incomplete-setup admin to see the actual 404/500 surface.
2. **Help / knowledge-base panel persists across navigation.** During
   both the authed walk and the Marketing OS walk, the Help panel
   stayed open after first activation and across every subsequent
   page navigation, partially overlapping page content. Non-blocking
   but visually cluttering — likely missing a route-change auto-close
   in `client/src/components/help-panel.tsx`.
3. **Multi-org login picker is real and unspec'd at the UI level.**
   The seed admin email exists in 2 orgs (verified via DB:
   `f0b17b7e…` and `13d5c79b…`). Login showed the picker; spec the
   pick step. `e2e/login-auto-pick-workspace.spec.ts` covers the
   "remembered" path but not the cold pick.
4. **Transient 401s on `/api/csrf-token`, `/api/auth/me`, and
   `/api/marketing/brand-info` during navigation** — observed in
   browser console during the Marketing OS walk. Non-blocking
   (subsequent retries succeed) but indicates a race between session
   restore and the first authed fetches; worth a hardening spec.
5. **Login form `<input type="password">` lacks `autocomplete`
   attribute** — DevTools console emits `[DOM] Input elements should
   have autocomplete attributes (suggested: "current-password")` on
   every visit to `/login`. Verified via in-tool screenshot of
   `/login`. Cosmetic a11y warning.
6. **Intermittent dev-server `502` on `/pricing` and `/compare`.** In
   the public walk both routes hit `chrome-error://chromewebdata/`
   with `HTTP ERROR 502` once, then succeeded on subsequent visits.
   Almost certainly Vite HMR / on-demand compile racing the
   navigation. Not user-visible in production builds, but flake risk
   for the future expanded suite — specs hitting these routes should
   include a single retry on 502.
7. **Marketing OS pages render fine for the seed admin** — every
   `/marketing/*` route produced a working empty-state UI and no
   error boundary, indicating the seed org has either the
   `marketing_os` entitlement or at least one brand (which satisfies
   `AdminSetupGate`'s marketing-OS bypass). Tests asserting the
   `<MarketingOsLockedCard>` path must therefore use a separate org
   fixture.

### 6.2 Findings from code/config review

8. **`tests/e2e/` specs are invisible to the default Playwright run.**
   `playwright.config.ts`'s `testDir: ./e2e` only sees `e2e/`; specs
   under `tests/e2e/` (admin-data-console, client-crud, payment-crud,
   etc.) only run via explicit invocations. They can silently rot.
9. **`CSRF_EXEMPT_PREFIXES` lists `/api/public/` twice** in
   `server/routes.ts` (cosmetic).
10. **Doc drift** — task brief says "33 Playwright specs"; actual
    count is 53 across both directories.
11. **`/blog` and `/careers` redirect to `/`.** Dead routes; harmless
    today but can mislead crawlers/users until removed.
12. **No 404 spec** — when an authenticated user hits an unknown URL,
    nothing asserts they land on the not-found page (and per finding
    #1, an incomplete-setup admin would never see it anyway).
13. **Auto-dismissed query params** in `MarketingOsCheckoutToast`
    depend on `history.replaceState`. No spec verifies the toast
    appears or that the URL is cleaned.
14. **`/onboarding` route** is _both_ wired in inner `Router()` _and_
    force-mounted in `AppContent` for any non-admin with
    `!onboardingComplete`. Either branch is reachable; no spec
    asserts the auto-mount path.
15. **Two ADMIN users with the same email exist in the dev DB** (one
    per org) — fine for the multi-org login feature, but worth
    documenting because `e2e/global-setup.ts`'s
    `resetTestAdminPassword` uses `email = $1` and updates _both_
    rows. Any spec that relies on a single, predictable
    `userId/orgId` for the admin must select by `(email, orgId)`,
    not just email.

(More bugs/fragility will be logged during the next task as specs
are written.)

---

## 7. Prioritized Gap List — Top-20 Highest-Risk Untested Flows

Risk = (financial / data-correctness impact) × (regression
likelihood). Authored in the order they should be covered.

| # | Flow | Why it's high-risk |
| --- | --- | --- |
| 1 | Multi-tenant isolation: user in org A cannot read/write any entity in org B (clients, invoices, payments, time entries, contacts) | Cross-tenant leak is catastrophic; covered only at storage-level today |
| 2 | Stripe Checkout → entitlement activation → grace → revoke (full lifecycle for both subscription and add-on) | Direct revenue + access correctness; only unit tests today |
| 3 | Signup → 14-day TRIAL provisioning (Stripe customer + org + admin user) at `/signup` | First-touch onboarding; **no E2E** |
| 4 | Password reset (`/forgot-password` → email token → `/reset-password/:token` → relogin) | Account recovery; **no E2E** |
| 5 | MFA enrollment + login challenge + recovery codes | Security-critical; **no E2E** |
| 6 | Idle-session timeout (30 min → 401 → redirect to `/login`) | Auth correctness; **no E2E** |
| 7 | Invoice send via SMTP and via M365/Gmail OAuth (full happy path including bounce/suppress webhook) | Money flow + deliverability; only redirect smoke today |
| 8 | Payments: refund, partial allocation across multiple invoices, multi-currency rollup | AR correctness; only manual-payment covered |
| 9 | Recurring invoice templates (`/invoices/recurring`): schedule, generate, edit, pause | AR continuity; **no E2E** |
| 10 | Estimates: create → send → public accept/decline at `/e/:token` → convert to invoice | Top-of-funnel + AR; only happy-path partial |
| 11 | Expense workflow: receipt upload → OCR (Groq + Tesseract fallback) → submit → approve → reimbursement | OCR fragile + money flow; **no E2E** |
| 12 | Approvals tier gate (PROFESSIONAL+ wall) + bulk approve/reject for both legit and over-quota users | Tier monetization correctness |
| 13 | GL postings: invoice paid → JE auto-post (when `autoPostJournalEntries=true`); close-period blocks edits | Accounting correctness; **no E2E** |
| 14 | Trial balance + ledger correctness after a sequence of mixed transactions | Reporting accuracy; **no E2E** |
| 15 | Marketing OS: env flag `MARKETING_OS_ENABLED` off ⇒ all `/marketing/*` 404 even if entitlement is present | Covered by `e2e/feature-flag-marketing-os.spec.ts` — kill switch now wired into the `requireFeature("marketing_os")` chokepoint middleware (server/services/entitlements.ts), so brands, chat, embed, contacts, companies, tags, segments, campaigns, activities, and prospects all stealth-404 with flag OFF + entitlement granted (Task #437). |
| 16 | CSV import wizard (FreshBooks / QuickBooks / Xero) including conflict resolution and preview rollback | Customer migration; only one path covered |
| 17 | Public token pages (`/i/:token`, `/e/:token`, `/portal/:token`) including expired/invalid token handling | Customer-facing surface; only happy path |
| 18 | Stripe Connect payouts (`/payouts`) reconciliation: sync, void, missing payout | Money flow; **no E2E** |
| 19 | Bank connection (`/banking`) Plaid/Stripe sync + auto-match suggestions | AP correctness; only unit test |
| 20 | 1099 generation + vendor export at year-end close | Compliance deadline; **no E2E** |

The next task ("Exhaustive E2E test suite expansion") should pick up
at item 1, build the multi-tenant isolation harness as a fixture
(since most remaining items reuse it), and proceed in order.

---

## 8. Audit Self-Review Checklist

- [x] Every page directory under `client/src/pages/` visited.
- [x] Every page in `admin/`, `marketing/`, `marketing-os/`,
      `settings/` catalogued.
- [x] Routes reconciled directly against `client/src/App.tsx` (outer
      Switch + AppContent + inner Router) — public marketing, public
      token, password reset, and authenticated routes all corrected
      to their actual paths.
- [x] Every spec in `e2e/` and `tests/e2e/` mapped, plus the
      discoverability hazard noted.
- [x] Cross-cutting concerns documented: auth, tier gating, role
      gating, multi-tenant isolation, feature flags, error pages,
      integrations, entitlements.
- [x] Test infrastructure documented: Playwright + Vitest configs,
      global setup, helpers/fixtures, auth, DB-state assumptions.
- [x] Infrastructure changes for 250+ specs enumerated.
- [x] Hands-on browser walks completed (public site, authenticated
      app as admin, Marketing OS) and findings folded into §6.1.
- [x] Bug pass logged (section 6, split into live-walk findings 6.1
      and code-review findings 6.2).
- [x] Top-20 prioritized gap list produced (section 7).
- [x] Document is self-contained — the next task can be executed
      without re-reading the codebase.
