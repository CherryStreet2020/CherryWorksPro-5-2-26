import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noindex?: boolean;
  fullTitle?: string;
}

const SITE_NAME = "CherryWorks Pro";
const BASE_URL = "https://cherryworkspro.com";
const OG_IMAGE_PATH = "/og-preview.png";
const OG_IMAGE = `${BASE_URL}${OG_IMAGE_PATH}`;
const PRICING_LOW = "39";
const PRICING_HIGH = "159";

export function SEO({ title, description, path, type = "website", noindex = false, fullTitle: fullTitleOverride }: SEOProps) {
  const fullTitle = fullTitleOverride
    ? fullTitleOverride
    : path === "/"
      ? `${SITE_NAME} — The Professional Services Operating System`
      : `${title} | ${SITE_NAME}`;
  const url = `${BASE_URL}${path}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:alt" content={`${SITE_NAME} logo`} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE} />
    </Helmet>
  );
}

export function OrganizationStructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "CherryWorks Pro",
    "url": "https://cherryworkspro.com",
    "logo": OG_IMAGE,
    "description": "Professional services automation software for agencies, consultancies, and service firms",
    "foundingDate": "2024",
    "numberOfEmployees": { "@type": "QuantitativeValue", "value": "10-50" },
    "address": { "@type": "PostalAddress", "addressLocality": "New York", "addressRegion": "NY", "addressCountry": "US" },
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "customer support",
      "url": "https://cherryworkspro.com/contact"
    }
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

export function SoftwareApplicationStructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "CherryWorks Pro",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web-based",
    "description": "Professional services operating system with time tracking, invoicing, GL, expenses, and team payouts",
    "offers": [
      { "@type": "Offer", "name": "Starter", "price": PRICING_LOW, "priceCurrency": "USD", "billingDuration": "P1M" },
      { "@type": "Offer", "name": "Professional", "price": "89", "priceCurrency": "USD", "billingDuration": "P1M" },
      { "@type": "Offer", "name": "Business", "price": PRICING_HIGH, "priceCurrency": "USD", "billingDuration": "P1M" }
    ],
    "publisher": {
      "@type": "Organization",
      "name": "CherryWorks Pro",
      "url": "https://cherryworkspro.com"
    },
    "featureList": [
      "Time Tracking",
      "Timesheet Approval Workflow",
      "Invoicing with Multi-Currency",
      "Expense Management with Approvals",
      "Payout Tracking",
      "25+ Built-in Reports",
      "Client Portal",
      "Import Wizard for 8 Platforms",
      "1099 Export",
      "Project Profitability Analysis",
      "Enterprise Audit Logging",
      "AI Receipt OCR",
      "GL Journal Entries",
      "Recurring Invoices",
      "Stripe Financial Connections"
    ]
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

export function FAQStructuredData({ faqs }: { faqs: { q: string; a: string }[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.a
      }
    }))
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

export function BusinessStructuredData() {
  return <SoftwareApplicationStructuredData />;
}
