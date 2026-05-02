const BASE_URL = "https://cherryworkspro.com";
const OG_IMAGE = `${BASE_URL}/og-preview.png`;
const SITE_NAME = "CherryWorks Pro";

interface SeoData {
  title: string;
  description: string;
}

const SEO_MAP: Record<string, SeoData> = {
  "/": {
    title: "CherryWorks Pro — The Professional Services Operating System",
    description: "Professional services operating system with unlimited users. Time tracking, invoicing, GL, expenses, team payouts, and 25+ reports — starting at $39/mo. No per-user fees.",
  },
  "/features": {
    title: "Features — Every Tool Purpose-Built for Professional Services | CherryWorks Pro",
    description: "Time tracking, invoicing, expenses, payouts, GL, AI support, and multi-currency — core features on every plan. Advanced ops tools on Professional and above.",
  },
  "/pricing": {
    title: "Pricing — CherryWorks Pro | Unlimited Users, Flat-Rate Plans from $39/mo",
    description: "Simple flat-rate pricing with unlimited users. Starter $39, Professional $89, Business $159, Enterprise custom. No per-user fees, no hidden costs.",
  },
  "/compare": {
    title: "Compare CherryWorks Pro vs FreshBooks, QuickBooks & More",
    description: "Side-by-side comparison of CherryWorks Pro against FreshBooks, QuickBooks, Xero, Wave, Harvest, BigTime, Scoro, and Paymo.",
  },
  "/demo": {
    title: "Request a Demo | CherryWorks Pro",
    description: "See CherryWorks Pro in action. Schedule a personalized demo to learn how our platform can streamline your firm's operations.",
  },
  "/about": {
    title: "About CherryWorks Pro — Built for Professional Services Firms",
    description: "CherryWorks Pro is the operating system purpose-built for professional services firms. Learn about our mission and team.",
  },
  "/contact": {
    title: "Contact Us | CherryWorks Pro",
    description: "Get in touch with the CherryWorks Pro team. We're here to help with questions about pricing, features, integrations, and onboarding.",
  },
  "/signup": {
    title: "Start Your Free Trial | CherryWorks Pro",
    description: "Sign up for a 14-day free trial of CherryWorks Pro. No credit card required to start. Full access to all features.",
  },
  "/integrations": {
    title: "Integrations — Connect CherryWorks Pro to Your Favorite Tools",
    description: "Integrate CherryWorks Pro with Stripe, QuickBooks, Xero, Zapier, Slack, and more. Automate payouts, sync invoices, and streamline workflows.",
  },
  "/terms": {
    title: "Terms of Service | CherryWorks Pro",
    description: "Read the CherryWorks Pro terms of service. Understand your rights and responsibilities when using our platform.",
  },
  "/privacy": {
    title: "Privacy Policy | CherryWorks Pro",
    description: "CherryWorks Pro privacy policy. Learn how we collect, use, and protect your data.",
  },
  "/security": {
    title: "Security — How CherryWorks Pro Protects Your Data",
    description: "Enterprise-grade security for professional services firms. AES-256 encryption, MFA, audit logging, SOC 2 practices, and more.",
  },
  "/switch-from-quickbooks": {
    title: "Switch from QuickBooks to CherryWorks Pro",
    description: "Migrate from QuickBooks to CherryWorks Pro in minutes. Import your clients, invoices, chart of accounts, and historical data automatically.",
  },
  "/switch-from-freshbooks": {
    title: "Switch from FreshBooks to CherryWorks Pro",
    description: "Migrate from FreshBooks to CherryWorks Pro. Import invoices, clients, projects, and time entries with our guided wizard.",
  },
  "/switch-from-xero": {
    title: "Switch from Xero to CherryWorks Pro",
    description: "Migrate from Xero to CherryWorks Pro. Import your GL, invoices, and client data. Purpose-built for professional services.",
  },
  "/switch-from-wave": {
    title: "Switch from Wave to CherryWorks Pro",
    description: "Outgrown Wave? Migrate to CherryWorks Pro for unlimited users, team payouts, GL, and advanced reporting.",
  },
  "/switch-from-harvest": {
    title: "Switch from Harvest to CherryWorks Pro",
    description: "Migrate from Harvest to CherryWorks Pro. Get invoicing, GL, team payouts, and 25+ reports alongside time tracking.",
  },
  "/switch-from-bigtime": {
    title: "Switch from BigTime to CherryWorks Pro",
    description: "Migrate from BigTime to CherryWorks Pro. Flat-rate pricing with unlimited users, no per-seat fees, and a modern interface.",
  },
  "/switch-from-scoro": {
    title: "Switch from Scoro to CherryWorks Pro",
    description: "Migrate from Scoro to CherryWorks Pro. Purpose-built for professional services firms with time tracking, invoicing, GL, and payouts.",
  },
  "/switch-from-paymo": {
    title: "Switch from Paymo to CherryWorks Pro",
    description: "Migrate from Paymo to CherryWorks Pro. Get a complete professional services platform with invoicing, GL, payouts, and more.",
  },
  "/login": {
    title: "Log In | CherryWorks Pro",
    description: "Log in to your CherryWorks Pro account to manage time tracking, invoicing, expenses, and more.",
  },
};

const DEFAULT_SEO: SeoData = {
  title: "CherryWorks Pro",
  description: "The professional services operating system. Time tracking, invoicing, GL, expenses, team payouts, and 25+ reports — starting at $39/mo.",
};

const MARKETING_PATHS = new Set(Object.keys(SEO_MAP));

const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "CherryWorks Pro",
  "url": BASE_URL,
  "logo": OG_IMAGE,
  "description": "Professional services automation software for agencies, consultancies, and service firms",
  "foundingDate": "2024",
  "numberOfEmployees": { "@type": "QuantitativeValue", "value": "10-50" },
  "address": { "@type": "PostalAddress", "addressLocality": "New York", "addressRegion": "NY", "addressCountry": "US" },
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer support",
    "url": `${BASE_URL}/contact`,
  },
};

const SOFTWARE_APPLICATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "CherryWorks Pro",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web-based",
  "description": "Professional services operating system with time tracking, invoicing, GL, expenses, and team payouts",
  "offers": [
    { "@type": "Offer", "name": "Starter", "price": "39", "priceCurrency": "USD", "billingDuration": "P1M" },
    { "@type": "Offer", "name": "Professional", "price": "89", "priceCurrency": "USD", "billingDuration": "P1M" },
    { "@type": "Offer", "name": "Business", "price": "159", "priceCurrency": "USD", "billingDuration": "P1M" },
    { "@type": "Offer", "name": "Enterprise", "price": "0", "priceCurrency": "USD", "billingDuration": "P1M", "description": "Custom pricing" },
  ],
  "publisher": {
    "@type": "Organization",
    "name": "CherryWorks Pro",
    "url": BASE_URL,
  },
  "featureList": [
    "Time Tracking",
    "Timesheet Approval Workflow",
    "Invoicing with Multi-Currency",
    "Expense Management with Approvals",
    "Team Payout Tracking",
    "25+ Built-in Reports",
    "Client Portal",
    "Import Wizard for 8 Platforms",
    "1099 Export",
    "Project Profitability Analysis",
    "Enterprise Audit Logging",
    "AI Receipt OCR",
    "GL Journal Entries",
    "Recurring Invoices",
    "Stripe Financial Connections",
  ],
};

const PATHS_WITH_SOFTWARE_SCHEMA = new Set(["/", "/pricing"]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getMetaTagsForPath(path: string): string {
  const cleanPath = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const seo = SEO_MAP[cleanPath] || DEFAULT_SEO;
  const t = escapeHtml(seo.title);
  const d = escapeHtml(seo.description);
  const url = `${BASE_URL}${cleanPath === "/" ? "" : cleanPath}`;

  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ];

  if (MARKETING_PATHS.has(cleanPath)) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(ORGANIZATION_SCHEMA)}</script>`);
  }

  if (PATHS_WITH_SOFTWARE_SCHEMA.has(cleanPath)) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(SOFTWARE_APPLICATION_SCHEMA)}</script>`);
  }

  return tags.join("\n    ");
}
