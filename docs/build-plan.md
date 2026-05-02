# CherryWorks Pro — 48-Hour MVP Build Plan + Month 1 Backlog

## 48hr Sprint

| Project | FreshBooks-like Ops Suite (Internal MVP in 48 Hours) |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kickoff (enter date/time) | 46083.375 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Target | Internal web app usable by all teamMembers; key workflows: time → invoice → reporting |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Notes | Blue text cells are inputs. Use Status to track progress. Adjust Kickoff to your real start time. Deferred items are now in the 'Month 1 Backlog' tab. |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| ID | Workstream | Task | Description / Steps | Owner | Start (hrs) | End (hrs) | Duration (hrs) | Start DateTime | End DateTime | Depends on (IDs) | Priority | Status | Acceptance Criteria | Links/Notes |
| T-001 | Product | Define internal MVP scope + acceptance tests | List must-have workflows: (1) Clients/Projects, (2) Time entry (billable/non-billable), (3) Invoices + PDF + email, (4) Manual payments record, (5) Basic reporting. NOTE: Expense tracking + receipts deferred ~30 days. Write acceptance tests per workflow. | PM/Founder | 0 | 2 | 2 | 46083.375 | 46083.458333333336 |  | P0 | Not Started | One-page scope + 10 acceptance tests agreed. |  |
| T-002 | Product | Map FreshBooks feature set → phased backlog | Create feature matrix: FreshBooks parity vs MVP/Phase1/Phase2. Identify gaps: reporting, independent/1099, utilization, profitability. | PM/Founder | 1 | 4 | 3 | 46083.416666666664 | 46083.541666666664 | T-001 | P0 | Not Started | Feature matrix sheet complete; P0 list frozen. |  |
| T-003 | DevOps/Sec | Create repos + branching + CI skeleton | Create repo(s); main/dev branches; PR checks (lint/test); secrets handling; environment conventions. | DevOps | 0 | 2 | 2 | 46083.375 | 46083.458333333336 |  | P0 | Not Started | Repo exists; CI runs on PR. |  |
| T-004 | DevOps/Sec | Choose stack + scaffolding (time-box 30 mins) | Pick fastest stack for 48h and document: Web (Next.js), DB (Postgres), Auth (managed), Storage (S3), Email provider. | Tech Lead | 0 | 0.5 | 0.5 | 46083.375 | 46083.395833333336 | T-001 | P0 | Not Started | Stack decision recorded in README. |  |
| T-005 | Backend | Provision database + migrations | Spin up Postgres (managed or docker). Set up migration tool (Prisma/Drizzle/etc.). Establish dev/test DBs. | Backend | 0.5 | 3 | 2.5 | 46083.395833333336 | 46083.5 | T-003,T-004 | P0 | Not Started | Migrations run; tables create cleanly. |  |
| T-006 | Backend | Domain model v1 (Org/User/Roles) | Tables: organizations, users, memberships, roles/permissions. Enforce org scoping + role checks in middleware. | Backend | 2 | 5 | 3 | 46083.458333333336 | 46083.583333333336 | T-005 | P0 | Not Started | RBAC enforced in API; multi-tenant guardrails. |  |
| T-007 | Backend | Clients + contacts schema + CRUD endpoints | Tables: clients, client_contacts, addresses. Endpoints: list/create/update/archive. | Backend | 4 | 8 | 4 | 46083.541666666664 | 46083.708333333336 | T-006 | P0 | Not Started | CRUD works; archived clients hidden by default. |  |
| T-008 | Backend | Projects + assignments schema + CRUD endpoints | Tables: projects, project_members, rate_cards (team member rates), project_budget_hours (optional). | Backend | 6 | 10 | 4 | 46083.625 | 46083.791666666664 | T-006,T-007 | P0 | Not Started | Projects list shows members; rates editable. |  |
| T-009 | Backend | Time entries schema + CRUD endpoints | Tables: time_entries (user, project, date, duration_minutes, notes, billable flag, rate override). Timer start/stop optional. | Backend | 8 | 14 | 6 | 46083.708333333336 | 46083.958333333336 | T-008 | P0 | Not Started | Create/edit time; totals per project correct. |  |
| T-011 | Backend | Invoice schema + numbering + line items | Tables: invoices (client, project optional, status, dates, totals, balance), invoice_lines (time/custom; expenses in Phase 1). Implement INV-0001 per org. | Backend | 12 | 20 | 8 | 46083.875 | 46084.208333333336 | T-007,T-008,T-009 | P0 | Not Started | Invoice totals accurate; numbering increments safely. |  |
| T-012 | Backend | Generate invoice from billable time (expenses Phase 1) | Endpoint: select project/date range; pulls approved billable time; converts to invoice lines; marks billed items with invoice_id. Allow adding custom lines for reimbursables. (Add billable expenses in Phase 1). | Backend | 18 | 24 | 6 | 46084.125 | 46084.375 | T-011 | P0 | Not Started | Generate produces correct lines and prevents double-billing. |  |
| T-013 | Backend | PDF rendering for invoices | Server-side PDF template with branding; includes line items, taxes, totals, payment instructions. | Backend | 20 | 26 | 6 | 46084.208333333336 | 46084.458333333336 | T-011 | P0 | Not Started | PDF renders; totals match; downloadable. |  |
| T-014 | Backend | Email sending for invoices | Send invoice email with PDF. Track sent_at and message id; allow resend. | Backend | 22 | 28 | 6 | 46084.291666666664 | 46084.541666666664 | T-013 | P0 | Not Started | Send test email; audit trail recorded. |  |
| T-015 | Backend | Manual payments recording | Record payment date/amount/method/reference; apply to invoice balance; status flips to paid when balance=0. | Backend | 24 | 30 | 6 | 46084.375 | 46084.625 | T-011 | P0 | Not Started | Invoice balance updates; partial payments supported. |  |
| T-016 | Data/Reporting | Define canonical metrics + report list | Metrics: revenue (invoiced/paid), AR aging, utilization, unbilled time, project profitability. Define formulas + dimensions. | Data Lead | 6 | 10 | 4 | 46083.625 | 46083.791666666664 | T-002 | P0 | Not Started | Metric definitions written; aligns with tables. |  |
| T-017 | Data/Reporting | Build v1 reporting SQL views | Views: revenue_by_month, revenue_by_client, hours_by_team_member, unbilled_time, ar_aging. | Data Lead | 16 | 24 | 8 | 46084.041666666664 | 46084.375 | T-009,T-011,T-016 | P0 | Not Started | Views correct on sample data. |  |
| T-018 | Frontend | Web app scaffold + navigation + auth | App shell, routes, auth guard, tables/forms/modals, error handling. | Frontend | 2 | 6 | 4 | 46083.458333333336 | 46083.625 | T-003,T-004 | P0 | Not Started | Login works; skeleton navigation ready. |  |
| T-019 | Frontend | Clients UI | List/search clients, add/edit/archive; client detail with invoices/projects tabs. | Frontend | 6 | 10 | 4 | 46083.625 | 46083.791666666664 | T-007,T-018 | P0 | Not Started | Client CRUD usable end-to-end. |  |
| T-020 | Frontend | Projects UI + members + rates | Project list/detail; add members; set billable rate per member; set budget hours. | Frontend | 8 | 14 | 6 | 46083.708333333336 | 46083.958333333336 | T-008,T-018 | P0 | Not Started | Project members + rates saved correctly. |  |
| T-021 | Frontend | Time entry UI (fast entry) | Timesheet by week; add/edit entries; mark billable; submit (optional). | Frontend | 10 | 18 | 8 | 46083.791666666664 | 46084.125 | T-009,T-018 | P0 | Not Started | Time entry is fast; totals per day/week correct. |  |
| T-023 | Frontend | Invoice UI (draft→sent→paid) | Invoice list/detail; generate from billables; edit lines; preview PDF; send; record payments. | Frontend | 18 | 32 | 14 | 46084.125 | 46084.708333333336 | T-011,T-012,T-013,T-014,T-015,T-018 | P0 | Not Started | End-to-end invoice workflow works. |  |
| T-024 | Frontend | Reporting dashboard v1 | Dashboards for AR aging, revenue by month, billable hours by teamMember, unbilled time, top clients. CSV export. | Frontend | 24 | 36 | 12 | 46084.375 | 46084.875 | T-017,T-018 | P0 | Not Started | Dashboard loads <3s; exports work. |  |
| T-025 | QA/Release | Seed data + scripted demo scenario | Create demo org with clients/projects/time/invoices to validate flows repeatedly. (Add expenses in Phase 1). | QA | 18 | 22 | 4 | 46084.125 | 46084.291666666664 | T-007,T-008,T-009,T-011 | P0 | Not Started | Seed command creates complete scenario. |  |
| T-026 | QA/Release | End-to-end test pass (P0 flows) | Run acceptance tests: create client/project, enter time, generate invoice, send, record payment, view reports. (Add expenses in Phase 1). | QA | 34 | 40 | 6 | 46084.791666666664 | 46085.041666666664 | T-019,T-020,T-021,T-023,T-024,T-025 | P0 | Not Started | All P0 acceptance tests pass. |  |
| T-027 | DevOps/Sec | Deploy staging + production (internal) | Deploy app, DB, object storage, email provider; set domains; configure env vars; enable HTTPS. | DevOps | 22 | 30 | 8 | 46084.291666666664 | 46084.625 | T-013,T-014 | P0 | Not Started | Staging+prod reachable; HTTPS; DB accessible. |  |
| T-028 | DevOps/Sec | Audit logs + basic security hardening | Audit key actions: login, invoice changes, payments. Add rate limiting, secure cookies, least-privileged secrets. | DevOps | 26 | 34 | 8 | 46084.458333333336 | 46084.791666666664 | T-006 | P0 | Not Started | Audit log captures critical events. |  |
| T-029 | Migration | FreshBooks export/import plan (minimal) | Identify minimum for cutover: clients + open invoices + active projects. Decide CSV vs API approach; document mapping. | PM/Founder | 4 | 8 | 4 | 46083.541666666664 | 46083.708333333336 | T-002 | P1 | Not Started | Import checklist + mapping documented. |  |
| T-030 | Migration | CSV import (clients + projects) | Upload CSV; validate; create records; produce error report for bad rows. | Backend | 28 | 36 | 8 | 46084.541666666664 | 46084.875 | T-007,T-008,T-029 | P1 | Not Started | Imports succeed; errors visible. |  |
| T-031 | Mobile | PWA companion basics | Make app installable (manifest), offline shell, queued sync for time when offline (best-effort). (Add expense offline queue in Phase 1). | Frontend | 20 | 28 | 8 | 46084.208333333336 | 46084.541666666664 | T-018 | P1 | Not Started | Installable; offline open; queued sync demo. |  |
| T-032 | Product | Payments roadmap (invoice pay + subscription) | Document two tracks: customer invoice payments (card/ACH) and app subscription (web+iOS+Android). Note store constraints. | PM/Founder | 8 | 12 | 4 | 46083.708333333336 | 46083.875 | T-002 | P0 | Not Started | Roadmap doc with decisions and open questions. |  |
| T-033 | Data/Reporting | 1099 independent totals report spec | Define independent data + totals by independent for 1099-NEC prep; decide cost basis; export CSV. (Non-legal: consult CPA.) | PM/Founder | 12 | 14 | 2 | 46083.875 | 46083.958333333336 |  | P1 | Not Started | Spec ready; report columns defined. |  |
| T-034 | Data/Reporting | 1099 totals report (v1) + export | Build report: totals by independent/year from approved time * cost rate (or chosen method). Provide CSV export. | Data Lead | 32 | 40 | 8 | 46084.708333333336 | 46085.041666666664 | T-033,T-009,T-008 | P1 | Not Started | Report matches sample totals; export works. |  |
| T-035 | Frontend | Org settings + invoice branding | Org name/logo, invoice prefix, default payment terms, tax settings, email template. | Frontend | 14 | 22 | 8 | 46083.958333333336 | 46084.291666666664 | T-011,T-018 | P1 | Not Started | Settings affect invoices/PDFs. |  |
| T-036 | Backend | Tax + discounts v1 | Support tax rate per invoice or line; optional discount; ensure totals correct and show on PDF. | Backend | 26 | 32 | 6 | 46084.458333333336 | 46084.708333333336 | T-011 | P1 | Not Started | Totals match manual checks. |  |
| T-037 | QA/Release | Cutover checklist + rollback plan | Define freeze window, import steps, onboarding, and fallback to FreshBooks if needed. | PM/Founder | 36 | 42 | 6 | 46084.875 | 46085.125 | T-029,T-027 | P1 | Not Started | Checklist complete; rollback steps documented. |  |
| T-038 | DevOps/Sec | Backups + monitoring | DB backups, object storage lifecycle, error tracking, uptime monitoring, alerts. | DevOps | 30 | 38 | 8 | 46084.625 | 46084.958333333336 | T-027 | P1 | Not Started | Backups verified; alerts tested. |  |
| T-039 | Data/Reporting | Profitability report (revenue vs cost) | Compute cost = hours * cost rate; revenue = invoiced lines; show margin %. Requires cost rates. | Data Lead | 30 | 38 | 8 | 46084.625 | 46084.958333333336 | T-016,T-008,T-011 | P1 | Not Started | Profitability report matches sample calcs. |  |
| T-040 | Backend | Cost rates per team member (profitability/1099) | Add cost_rate to team member membership/profile (input). | Backend | 16 | 20 | 4 | 46084.041666666664 | 46084.208333333336 | T-006 | P1 | Not Started | Cost rate stored; used in reports. |  |
| T-041 | QA/Release | Internal launch + training | 30-min walkthrough; collect issues; create triage board and hotfix protocol. | PM/Founder | 46 | 48 | 2 | 46085.291666666664 | 46085.375 | T-026,T-027 | P0 | Not Started | All teamMembers can log in and complete core workflow. |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Feature Map

| Feature Map (parity vs FreshBooks) |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| Module | Feature | Why it matters | MVP (48h) | Phase 1 (2-4 wks) | Phase 2 (2-3 mo) | Notes / parity target |
| Core | Organizations & roles (RBAC) | Multi-user internal security | Y | Enhance | SSO/SCIM |  |
| CRM | Clients + contacts | Billing entity + communications | Y | Enhance | Automations |  |
| Ops | Projects + assignments + rates | Time/expense capture & profitability | Y | Enhance | Capacity planning | FreshBooks managing projects/time tracking |
| Time | Timesheets + timer | Billables & utilization | Y | Enhance | Mobile offline timer | FreshBooks time tracking |
| Expenses | Expense capture + receipts | Reimbursables & cost accounting | N | Y | OCR + auto-categorize | Deferred ~30 days; see 'Month 1 Backlog' tab for tasks and schedule. |
| Billing | Estimates/Proposals | Pre-approval & sales funnel | N | Y | Enhance | FreshBooks estimating |
| Billing | Invoicing + PDF + email | Cash flow & AR | Y | Enhance | Templates + multi-currency | FreshBooks invoicing |
| Billing | Recurring invoices | Automation | N | Y | Enhance | FreshBooks recurring |
| Billing | Online payments for invoices | Customer pay you electronically | Design | Y | Enhance | FreshBooks online payments |
| Accounting | Bank feed + reconciliation | Accounting-grade workflows | N | N | Y | Out of scope for 48h |
| Accounting | General ledger / COA | True accounting system | N | N | Y | Likely Phase 2+ |
| Reporting | Dashboards (AR, revenue, utilization) | Fix reporting pain | Y (basic) | Enhance | Report builder/BI | Differentiator |
| Reporting | Project profitability | Know margin per project | P1 | Enhance | Enhance | FreshBooks offers profitability reports on certain plans |
| Independents | 1099 totals + exports | Tax prep for independents | P1 | Enhance | W-9 workflows + e-filing integration | You use 1099s |
| Admin | Audit log | Compliance & debugging | P0 | Enhance | SOC2 controls |  |
| Mobile | PWA companion | Field time (expenses later) | P1 | Enhance | Native apps | App Store later |
| Platform | Public API + webhooks | Integrations ecosystem | N | Y | Enhance | FreshBooks has API |
| Monetization | Subscription billing | Sell as SaaS | Design | Y | Enhance | Store rules apply |

## Architecture

| Architecture snapshot (v1) |  |
| --- | --- |
|  |  |
| Fast stack suggestion (48h) | Web: Next.js (React) • API: Next.js API routes or Node • DB: Postgres • Auth: managed (Supabase/Clerk/Auth0) • Storage: S3 compatible • Email: SendGrid/Mailgun |
| Core services | 1) Web App  2) API  3) Worker (PDF/email/webhooks)  4) DB  5) Object Storage  6) Reporting views |
|  |  |
| Core tables (minimum) |  |
| organizations | users, memberships (role, cost_rate, default_billable_rate) |
| clients | projects, project_members, rate_cards |
| time_entries | time entries (billables); expenses deferred ~30 days |
| invoices | invoice_lines, payments |
|  |  |
| Key API endpoints |  |
| /clients | GET/POST/PATCH/archive |
| /projects | GET/POST/PATCH; members & rates |
| /time | CRUD + optional submit/approve |
| /expenses | Phase 1: CRUD + receipt upload URL |
| /invoices | CRUD + generate-from-billables + pdf + send + record-payment |
| /reports/* | AR aging, revenue, utilization, unbilled, profitability, 1099 totals |
|  |  |
| Non-functional checklist (MVP) | Multi-tenant isolation, RBAC, audit logs, backups, monitoring, encryption at rest (managed), least-privileged secrets, PII minimization |

## Risks

| ID | Risk | Probability | Impact | Mitigation / Response | Owner | Trigger | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | 48h timeline too aggressive for full parity | High | High | Time-box to internal MVP; defer ledger/bank sync/estimates/recurring billing; ship P0 workflows only. | PM/Lead | Scope creep | Open |
| R-02 | Multi-tenant security bug exposes data | Med | High | Enforce org_id on every row; add row-level policies; automated tests; code review checklist. | Tech Lead | Any cross-org query | Open |
| R-03 | Email/PDF deliverability issues | Med | Med | Use proven provider; configure SPF/DKIM/DMARC; fallback to downloadable PDF link. | DevOps | High bounce/spam | Open |
| R-04 | Reporting numbers don’t reconcile | High | Med | Define canonical metrics; provide drill-down and audit; reconcile with FreshBooks export. | Data Lead | User disputes totals | Open |
| R-05 | Payments + App Store billing compliance risk | Med | High | Use Stripe hosted checkout; follow Apple/Google rules; get legal review for IAP vs external purchase flows. | PM/Legal | Rejected build | Open |
| R-06 | 1099/tax requirements misunderstood | Med | High | Partner with CPA; separate reporting from filing; integrate with 1099 filing provider later. | PM/CPA | Tax season | Open |

## App Store & Payments

| Track | Requirement/Decision | What to do | When | Owner | Notes / Links |
| --- | --- | --- | --- | --- | --- |
| App Store | Review guideline compliance | Ensure app is complete (no placeholder), stable, privacy disclosures in place, and meets Apple review guidelines. | Before submission | Mobile Lead | https://developer.apple.com/app-store/review/guidelines/ |
| Monetization | Subscription billing across web+iOS+Android | Decide: IAP for iOS subscriptions vs allowed external purchase flows (varies by region). Design for portability (web billing + store billing). | Phase 2 | PM/Legal | Start with Apple guidelines; rules change and differ by country. |
| Invoices | Customer invoice payments | Implement Stripe Checkout/Payment Links for invoices (card + ACH where available). Add webhook handling + reconciliation. | Phase 1 | Backend | Hosted checkout reduces PCI scope; keep invoices payable even if they don’t subscribe. |
| Security | Account deletion + data export | Provide account/org deletion request flow and data export. Add audit + retention controls. | Phase 2 | Backend | Common store expectation; align with privacy policy. |
| Privacy | Privacy policy + data handling | Publish privacy policy + in-app link. Declare data collection in store metadata. Minimize PII. | Phase 2 | PM/Legal | Accurate privacy labels required. |
| Android | Google Play policies | Mirror privacy/billing/permissions requirements. Plan for Play Billing if used for subscriptions. | Phase 2 | Mobile Lead | Review at submission time. |

## Month 1 Backlog

| Project | Month 1 Backlog (Deferred work after internal MVP) |  |  |  |  |  |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kickoff (from 48hr Sprint) | 46083.375 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Horizon | Planned start ~+30 days (offset ~720 hrs) from kickoff; prioritize when travel/reimbursables begin. |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Notes | These tasks were removed from the 48-hour critical path. Track here and re-estimate before starting. |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| ID | Workstream | Task | Description / Steps | Owner | Start (hrs) | End (hrs) | Duration (hrs) | Start DateTime | End DateTime | Depends on (IDs) | Priority | Status | Acceptance Criteria | Links/Notes |
| T-010 | Backend | [DEFER Month+1] Expenses schema + receipt upload | (Deferred ~30 days) Tables: expenses (user, project/client, date, amount, currency, category, billable, tax, merchant). Receipt upload to object storage. | Backend | 720 | 726 | 6 | 46113.375 | 46113.625 | T-008 | P0 | Not Started | Receipt upload/download works; expense linked to project. |  |
| T-022 | Frontend | [DEFER Month+1] Expense entry UI + receipts | (Deferred ~30 days) Expense form; upload receipt; categorize; link to project; mark billable. | Frontend | 732 | 740 | 8 | 46113.875 | 46114.208333333336 | T-010,T-018 | P0 | Not Started | Receipt upload works; expense lists accurate. |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

