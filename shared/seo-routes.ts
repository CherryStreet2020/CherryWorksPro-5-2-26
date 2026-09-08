/**
 * The single source of truth for the public site's routes and their SEO copy.
 * Read by BOTH the server (head injection, sitemap, robots, real 404s/301s —
 * server/seo-meta.ts) and the client (<SEO> — client/src/components/seo.tsx),
 * so a title can only ever be one string. Keep titles ≤ 60 chars and
 * descriptions ≤ 155 chars; tests/unit/seo-routes.test.ts enforces both.
 */
export interface PublicRouteSeo {
  title: string;
  description: string;
  /** Rendered with <meta name="robots" content="noindex,nofollow"> and kept out of the sitemap. */
  noindex?: boolean;
}

export const SITE_NAME = "CherryWorks Pro";
export const BASE_URL = "https://cherryworkspro.com";
export const REPORT_COUNT = 19; // client/src/pages/reports.tsx REPORT_REGISTRY — update both together

export const PUBLIC_ROUTES: Record<string, PublicRouteSeo> = {
  "/": {
    title: "CherryWorks Pro — The Professional Services Operating System",
    description: `Time tracking, invoicing, books, team payouts and client support in one platform with unlimited users. ${REPORT_COUNT} built-in reports. From $39/mo, no per-user fees.`,
  },
  "/features": {
    title: "Features — Time, Billing, Books & Payouts | CherryWorks Pro",
    description: "Time tracking, invoicing, expenses, payouts, general ledger, client support and multi-currency — core features on every plan, unlimited users included.",
  },
  "/pricing": {
    title: "Pricing — Flat-Rate Plans from $39/mo | CherryWorks Pro",
    description: "Simple flat-rate pricing with unlimited users: Starter $39, Professional $89, Business $159 (Marketing Hub included), Enterprise custom. 14-day free trial.",
  },
  "/compare": {
    title: "Compare CherryWorks Pro vs FreshBooks, QuickBooks & More",
    description: "Side-by-side comparison of CherryWorks Pro with FreshBooks, QuickBooks, Xero, Wave, Harvest, BigTime, Scoro and Paymo: users, GL, payouts and price.",
  },
  "/demo": {
    title: "Request a Demo | CherryWorks Pro",
    description: "A twenty-minute screen share on your own scenario: from a client email to the invoice, the ledger and the payout. A person replies within one business day.",
  },
  "/tour": {
    title: "Product Tour — See Every Feature | CherryWorks Pro",
    description: "Explore CherryWorks Pro in one scroll: time tracking, invoicing, approvals, payouts, general ledger, reports and client support. No signup required.",
  },
  "/client-support": {
    title: "Client Support — A Support Desk That Bills | CherryWorks Pro",
    description: "Cases, SLAs per client, a passwordless client portal and email-to-case, built into the platform that tracks the time, sends the invoice and pays your team.",
  },
  "/switch-from-jira-service-management": {
    title: "Switch from Jira Service Management | CherryWorks Pro",
    description: "Jira runs a service desk; your firm bills for service. Import the project, keep the email address, and put support hours on the invoice. Unlimited users.",
  },
  "/about": {
    title: "About CherryWorks Pro — Built Inside a Consulting Firm",
    description: "CherryWorks Pro was built inside a real consulting firm because we needed it — then every firm like ours did too. Learn about the team and the mission.",
  },
  "/contact": {
    title: "Support & Contact | CherryWorks Pro",
    description: "Get help from CherryAssist AI around the clock or reach the CherryWorks Pro team directly with pricing, feature, integration and onboarding questions.",
  },
  "/signup": {
    title: "Start Your 14-Day Free Trial | CherryWorks Pro",
    description: "Start a 14-day free trial of CherryWorks Pro: full general ledger, unlimited users, no per-seat fees. Import from FreshBooks, QuickBooks, Harvest and Xero.",
  },
  "/integrations": {
    title: "Integrations — Zapier, Slack, Stripe | CherryWorks Pro",
    description: "Connect CherryWorks Pro to Stripe, Slack, QuickBooks, Google Sheets, HubSpot and 6,000+ apps through Zapier. REST API and webhooks included on every plan.",
  },
  "/marketing": {
    title: "Marketing Hub — CRM, Campaigns & Sequences | CherryWorks Pro",
    description: "Marketing Hub adds a prospect-to-client CRM to CherryWorks Pro: contacts, companies, segments, campaigns and sequences — included with the Business plan.",
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
    description: "How CherryWorks Pro protects your data: tenant isolation, AES-256 encryption, MFA, CSRF protection, rate limiting and audit logging.",
  },
  "/switch-from-quickbooks": {
    title: "Switch from QuickBooks to CherryWorks Pro",
    description: "QuickBooks is built for accountants. CherryWorks Pro is built for services firms: time tracking, invoicing, payouts and project profitability in one place.",
  },
  "/switch-from-freshbooks": {
    title: "Switch from FreshBooks to CherryWorks Pro",
    description: "FreshBooks charges per user. CherryWorks Pro gives you unlimited users, a full general ledger, 1099 exports and project profitability from $39/mo flat.",
  },
  "/switch-from-xero": {
    title: "Switch from Xero to CherryWorks Pro",
    description: `Xero gives you a ledger. CherryWorks Pro gives you the whole operating system: time tracking, invoicing, payouts and ${REPORT_COUNT} reports for services firms.`,
  },
  "/switch-from-wave": {
    title: "Switch from Wave to CherryWorks Pro",
    description: `Wave has no time tracking. CherryWorks Pro has time tracking, project profitability, team payouts, expense approvals and ${REPORT_COUNT} built-in reports.`,
  },
  "/switch-from-harvest": {
    title: "Switch from Harvest to CherryWorks Pro",
    description: "Harvest tracks time. CherryWorks Pro replaces Harvest and the three other tools you run beside it: invoicing, general ledger, payouts and reporting in one.",
  },
  "/switch-from-bigtime": {
    title: "Switch from BigTime to CherryWorks Pro",
    description: "BigTime charges per user per month. CherryWorks Pro: unlimited users, a full general ledger and 1099 exports — everything BigTime does plus accounting.",
  },
  "/switch-from-scoro": {
    title: "Switch from Scoro to CherryWorks Pro",
    description: "Scoro bundles features you will never use. CherryWorks Pro covers what runs your firm: time, invoicing, payouts and books. Unlimited users from $39/mo.",
  },
  "/switch-from-paymo": {
    title: "Switch from Paymo to CherryWorks Pro",
    description: "Paymo charges per user, with no general ledger or team payouts. CherryWorks Pro: unlimited users, full accounting and 1099 exports from $39/mo flat.",
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
export const TOKEN_ROUTE_PREFIXES = ["/i", "/e", "/portal", "/reset-password"];

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
