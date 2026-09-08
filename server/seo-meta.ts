import type { Express, Request, Response } from "express";
import {
  BASE_URL, SITE_NAME, REPORT_COUNT, PUBLIC_ROUTES, classifyPath, normalizePath, sitemapPaths, type RouteClass,
} from "@shared/seo-routes";

const OG_IMAGE = `${BASE_URL}/og-preview.png`;

const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": SITE_NAME,
  "url": BASE_URL,
  "logo": OG_IMAGE,
  "description": "Professional services platform for agencies, consultancies and service firms",
  "foundingDate": "2024",
  "address": { "@type": "PostalAddress", "addressLocality": "New York", "addressRegion": "NY", "addressCountry": "US" },
  "contactPoint": { "@type": "ContactPoint", "contactType": "customer support", "url": `${BASE_URL}/contact` },
};

// Only priced offers: an Enterprise "price: 0" told Google the top tier was free.
const SOFTWARE_APPLICATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": SITE_NAME,
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web-based",
  "description": "Professional services operating system with time tracking, invoicing, general ledger, expenses, team payouts and client support",
  "offers": [
    { "@type": "Offer", "name": "Starter", "price": "39", "priceCurrency": "USD", "billingDuration": "P1M" },
    { "@type": "Offer", "name": "Professional", "price": "89", "priceCurrency": "USD", "billingDuration": "P1M" },
    { "@type": "Offer", "name": "Business", "price": "159", "priceCurrency": "USD", "billingDuration": "P1M" },
  ],
  "publisher": { "@type": "Organization", "name": SITE_NAME, "url": BASE_URL },
  "featureList": [
    "Time Tracking", "Timesheet Approval Workflow", "Invoicing with Multi-Currency", "Expense Management with Approvals",
    "Team Payout Tracking", `${REPORT_COUNT} Built-in Reports`, "Client Portal", "Client Support Cases", "Import Wizard for 8 Platforms",
    "1099 Export", "Project Profitability Analysis", "Enterprise Audit Logging", "AI Receipt OCR", "GL Journal Entries",
    "Recurring Invoices", "Stripe Financial Connections",
  ],
};

const PATHS_WITH_SOFTWARE_SCHEMA = new Set(["/", "/pricing", "/features"]);

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// `data-rh` marks a tag as owned by react-helmet-async, so the client's <SEO>
// replaces it on navigation instead of leaving e.g. the /login noindex on the
// public page a visitor navigates to next. JSON-LD scripts stay unmanaged: the
// client no longer renders schema, and crawlers only see the initial response.
const RH = ' data-rh="true"';
const NOINDEX = `<meta name="robots" content="noindex,nofollow"${RH} />`;

/**
 * Head tags for a path. Public routes get the full title/description/canonical/
 * Open Graph/JSON-LD set from the shared map; everything else (the signed-in app,
 * token pages, unknown paths) gets a bare title and noindex so the app shell can
 * never be indexed as a duplicate of the home page.
 */
export function getMetaTagsForPath(rawPath: string, route: RouteClass = classifyPath(rawPath)): string {
  if (route.kind !== "public") {
    return [`<title>${SITE_NAME}</title>`, NOINDEX].join("\n    ");
  }
  const { path, seo } = route;
  const t = escapeHtml(seo.title);
  const d = escapeHtml(seo.description);
  const url = `${BASE_URL}${path === "/" ? "" : path}`;
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}"${RH} />`,
  ];
  if (seo.noindex) {
    tags.push(NOINDEX);
    return tags.join("\n    ");
  }
  tags.push(
    `<link rel="canonical" href="${url}"${RH} />`,
    `<meta property="og:title" content="${t}"${RH} />`,
    `<meta property="og:description" content="${d}"${RH} />`,
    `<meta property="og:url" content="${url}"${RH} />`,
    `<meta property="og:image" content="${OG_IMAGE}"${RH} />`,
    `<meta property="og:type" content="website"${RH} />`,
    `<meta property="og:site_name" content="${SITE_NAME}"${RH} />`,
    `<meta name="twitter:card" content="summary_large_image"${RH} />`,
    `<meta name="twitter:title" content="${t}"${RH} />`,
    `<meta name="twitter:description" content="${d}"${RH} />`,
    `<meta name="twitter:image" content="${OG_IMAGE}"${RH} />`,
    `<script type="application/ld+json">${JSON.stringify(ORGANIZATION_SCHEMA)}</script>`,
  );
  if (PATHS_WITH_SOFTWARE_SCHEMA.has(path)) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(SOFTWARE_APPLICATION_SCHEMA)}</script>`);
  }
  return tags.join("\n    ");
}

/**
 * Decide the HTTP response for a non-API, non-asset request, shared by the
 * production static server and the Vite dev server so both behave alike:
 * a 301 for retired paths, a real 404 for paths nothing owns (the shell is
 * still sent so the client renders its not-found page), 200 otherwise.
 */
export function shellResponse(rawPath: string): { status: 200 | 404; head: string } | { redirect: string } {
  const route = classifyPath(rawPath);
  if (route.kind === "redirect") return { redirect: route.to };
  return { status: route.kind === "unknown" ? 404 : 200, head: getMetaTagsForPath(rawPath, route) };
}

const NO_STORE = "no-cache, no-store, must-revalidate";

/** Send the SPA shell (or a redirect) for a request, with the head tags for its path. */
export function sendShell(req: Request, res: Response, rawHtml: string): void {
  const decision = shellResponse(normalizePath(req.originalUrl));
  if ("redirect" in decision) {
    res.redirect(301, decision.redirect);
    return;
  }
  const html = rawHtml.replace("</head>", `    ${decision.head}\n  </head>`);
  res.status(decision.status).set({ "Content-Type": "text/html", "Cache-Control": NO_STORE }).end(html);
}

/** The one sitemap and the one robots.txt, both derived from the shared route map. */
export function registerSeoRoutes(app: Express): void {
  app.get("/sitemap.xml", (_req, res) => {
    const urls = sitemapPaths()
      .map((p) => `  <url><loc>${BASE_URL}${p === "/" ? "/" : p}</loc></url>`)
      .join("\n");
    res
      .status(200)
      .set({ "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" })
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
  app.get("/robots.txt", (_req, res) => {
    res
      .status(200)
      .set({ "Content-Type": "text/plain", "Cache-Control": "public, max-age=3600" })
      .send(
        [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "Disallow: /portal/",
          "Disallow: /i/",
          "Disallow: /e/",
          "Disallow: /verify-email",
          "Disallow: /reset-password",
          "Disallow: /dashboard",
          "Disallow: /admin/",
          `Sitemap: ${BASE_URL}/sitemap.xml`,
          "",
        ].join("\n"),
      );
  });
}

export { PUBLIC_ROUTES };
