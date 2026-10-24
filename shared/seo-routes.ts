/**
 * The single source of truth for the public site's routes and their SEO copy.
 * Read by BOTH the server (head injection, sitemap, robots, real 404s/301s —
 * server/seo-meta.ts) and the client (<SEO> — client/src/components/seo.tsx),
 * so a title can only ever be one string. Keep titles ≤ 60 chars and
 * descriptions ≤ 155 chars; tests/unit/seo-routes.test.ts enforces both.
 */
import { PLAN_PRICING } from "./plan-pricing";

export interface PublicRouteSeo {
  title: string;
  description: string;
  /** Rendered with <meta name="robots" content="noindex,nofollow"> and kept out of the sitemap. */
  noindex?: boolean;
}

export const SITE_NAME = "CherryWorks Pro";
export const BASE_URL = "https://cherryworkspro.com";
export const REPORT_COUNT = 19; // client/src/pages/reports.tsx REPORT_REGISTRY — update both together

const STARTER = `$${PLAN_PRICING.STARTER.monthly}`;
const PROFESSIONAL = `$${PLAN_PRICING.PROFESSIONAL.monthly}`;
const BUSINESS = `$${PLAN_PRICING.BUSINESS.monthly}`;

export const PUBLIC_ROUTES: Record<string, PublicRouteSeo> = {
  "/": {
    title: "CherryWorks Pro — Time, Billing, Payouts and Client Support",
    description: `Time tracking, invoicing, contractor payouts, a general ledger and client support for services firms. Unlimited users, ${REPORT_COUNT} reports, from ${STARTER}/mo.`,
  },
  "/features": {
    title: "Features — Time, Billing, Books & Payouts | CherryWorks Pro",
    description: "Time tracking, approvals, invoicing, expenses, contractor payouts, a general ledger, reports and client support, with unlimited users on every plan.",
  },
  "/pricing": {
    title: `Pricing — Flat-Rate Plans from ${STARTER}/mo | CherryWorks Pro`,
    description: `Flat pricing per firm with unlimited users: Starter ${STARTER}, Professional ${PROFESSIONAL}, Business ${BUSINESS} with Marketing Hub, or Enterprise. 14-day trial.`,
  },
  "/compare": {
    title: "Compare CherryWorks Pro vs FreshBooks, QuickBooks & More",
    description: "Side-by-side comparison of CherryWorks Pro with FreshBooks, QuickBooks, Xero, Wave, Harvest, BigTime, Scoro and Paymo: users, GL, payouts and price.",
  },
  "/demo": {
    title: "Request a Demo | CherryWorks Pro",
    description: "A twenty-minute screen share on your own scenario, from a client email to the invoice, the ledger and the payout. We reply by email to set a time.",
  },
  "/tour": {
    title: "Product Tour — From Support Case to Payout | CherryWorks Pro",
    description: "Follow one client request through CherryWorks Pro in real screenshots: the support case, the hours, the invoice and the payout. No signup needed.",
  },
  "/client-support": {
    title: "Client Support — A Support Desk That Bills | CherryWorks Pro",
    description: "Support cases, SLAs per client, a Help Center with one-time sign-in links and email-to-case, in the system that bills the time and pays your team.",
  },
  "/switch-from-jira-service-management": {
    title: "Switch from Jira Service Management | CherryWorks Pro",
    description: "Import Jira Cloud issues with comments, attachments and keys, then bill support hours to the client and pay your team for them. Unlimited users.",
  },
  "/about": {
    title: "About CherryWorks Pro — Built Inside a Consulting Firm",
    description: "CherryWorks Pro was built inside a working consulting firm to log time, invoice clients, collect payments and pay the team, and that firm still runs on it.",
  },
  "/contact": {
    title: "Contact the Team | CherryWorks Pro",
    description: "Questions about pricing, features, moving from another tool or getting set up? Send the CherryWorks Pro team a message and we reply by email.",
  },
  "/signup": {
    title: "Start Your 14-Day Free Trial | CherryWorks Pro",
    description: "Start a 14-day free trial of CherryWorks Pro: full general ledger, unlimited users, no per-seat fees. Import from FreshBooks, QuickBooks, Harvest and Xero.",
  },
  "/integrations": {
    title: "Integrations — Email, Stripe, Bank Feeds | CherryWorks Pro",
    description: "Mail from Microsoft 365, Google or SMTP, Stripe payments and payouts, bank feeds, imports from 8 tools and Jira, plus an API and webhooks on Professional.",
  },
  "/marketing": {
    title: "Marketing Hub — CRM, Campaigns & Sequences | CherryWorks Pro",
    description: "Marketing Hub adds contacts, companies, segments, CSV import, campaigns and email sequences, kept apart from your billing clients. On the Business plan.",
  },
  "/terms": {
    title: "Terms of Service | CherryWorks Pro",
    description: "The terms governing your use of the CherryWorks Pro platform and services.",
  },
  "/privacy": {
    title: "Privacy Policy | CherryWorks Pro",
    description: "How CherryWorks Pro collects, uses and protects your data, with organisation-scoped isolation for every workspace.",
  },
  "/security": {
    title: "Security — How CherryWorks Pro Protects Your Data",
    description: "How CherryWorks Pro protects your data: each firm kept separate, two-factor sign-in, CSRF tokens, rate limits, an audit log and encrypted credentials.",
  },
  "/switch-from-quickbooks": {
    title: "Switch from QuickBooks to CherryWorks Pro",
    description: "QuickBooks caps users by plan and sells contractor payments as an add-on. CherryWorks Pro has a ledger built around billable hours, with unlimited users.",
  },
  "/switch-from-freshbooks": {
    title: "Switch from FreshBooks to CherryWorks Pro",
    description: `FreshBooks charges for each team member. CherryWorks Pro has unlimited users, a full general ledger, contractor payouts and client support, from ${STARTER}/mo.`,
  },
  "/switch-from-xero": {
    title: "Switch from Xero to CherryWorks Pro",
    description: "Xero is a solid ledger. CherryWorks Pro keeps one too, plus timesheets, invoices from billable hours, contractor payouts and client support.",
  },
  "/switch-from-wave": {
    title: "Switch from Wave to CherryWorks Pro",
    description: `Wave covers the books but not the hours. CherryWorks Pro adds time tracking, invoices from billable hours, contractor payouts and ${REPORT_COUNT} reports.`,
  },
  "/switch-from-harvest": {
    title: "Switch from Harvest to CherryWorks Pro",
    description: "Harvest now bills by seat and by usage. CherryWorks Pro keeps your timesheets and adds the general ledger, contractor payouts and client support, per firm.",
  },
  "/switch-from-bigtime": {
    title: "Switch from BigTime to CherryWorks Pro",
    description: "BigTime is priced per user and leaves the books to QuickBooks. CherryWorks Pro adds a general ledger and contractor payouts, with unlimited users.",
  },
  "/switch-from-scoro": {
    title: "Switch from Scoro to CherryWorks Pro",
    description: "Scoro is priced per user with a 5-user minimum, and the books stay elsewhere. CherryWorks Pro keeps time, invoicing, the ledger and payouts in one.",
  },
  "/switch-from-paymo": {
    title: "Switch from Paymo to CherryWorks Pro",
    description: "Paymo is priced per user and syncs to another ledger. CherryWorks Pro keeps time, invoicing, the ledger, payouts and client support together.",
  },
  "/login": { title: "Log In | CherryWorks Pro", description: "Sign in to your CherryWorks Pro workspace.", noindex: true },
  "/forgot-password": { title: "Forgot Password | CherryWorks Pro", description: "Request a password reset link for your CherryWorks Pro account.", noindex: true },
  "/reset-password": { title: "Reset Password | CherryWorks Pro", description: "Choose a new password for your CherryWorks Pro account.", noindex: true },
};

/** Old public paths that still get traffic: served as permanent redirects by the server. */
export const PUBLIC_REDIRECTS: Record<string, string> = {
  "/blog": "/",
  "/careers": "/",
  "/marketing-os": "/marketing",
};

/**
 * Top-level paths the signed-in app owns (client/src/App.tsx). The server serves
 * the shell for these with a noindex meta and a 200; anything not listed here,
 * in PUBLIC_ROUTES, PUBLIC_REDIRECTS or the token prefixes is a real 404.
 * A route missing from this list still renders in the browser (the SPA routes
 * client-side regardless of status) — only the status code for crawlers is off.
 */
export const APP_ROUTE_PREFIXES = [
  "/dashboard", "/home", "/clients", "/profile", "/change-password", "/onboarding", "/projects",
  "/time", "/support", "/invoices", "/payments", "/payouts", "/choose-plan", "/reports", "/expenses",
  "/expense-reports", "/estimates", "/notifications", "/activity", "/approvals", "/team", "/import",
  "/admin", "/settings", "/marketing", "/api-integrations", "/services", "/accounting", "/billing",
  "/management", "/system", "/gl", "/banking", "/close-periods", "/timesheets", "/getting-started",
  "/verify-email", "/403", "/500", "/__premium-showcase", "/__e2e_crash", "/__gate_crash",
];

/** Public-but-private pages reached by a token or a portal slug: 200, noindex. */
export const TOKEN_ROUTE_PREFIXES = ["/i", "/e", "/portal", "/help", "/reset-password"];

export type RouteClass =
  | { kind: "public"; path: string; seo: PublicRouteSeo }
  | { kind: "redirect"; to: string }
  | { kind: "app" }
  | { kind: "token" }
  | { kind: "unknown" };

export function normalizePath(raw: string): string {
  const path = raw.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return path || "/";
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function classifyPath(raw: string): RouteClass {
  const path = normalizePath(raw);
  const seo = PUBLIC_ROUTES[path];
  if (seo) return { kind: "public", path, seo };
  const to = PUBLIC_REDIRECTS[path];
  if (to) return { kind: "redirect", to };
  if (TOKEN_ROUTE_PREFIXES.some((p) => path.startsWith(p + "/"))) return { kind: "token" };
  if (APP_ROUTE_PREFIXES.some((p) => underPrefix(path, p))) return { kind: "app" };
  return { kind: "unknown" };
}

/** Paths that belong in the sitemap: public, indexable. */
export function sitemapPaths(): string[] {
  return Object.entries(PUBLIC_ROUTES).filter(([, s]) => !s.noindex).map(([p]) => p);
}
