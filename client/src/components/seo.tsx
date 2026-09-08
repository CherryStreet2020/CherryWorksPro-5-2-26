import { Helmet } from "react-helmet-async";
import { BASE_URL, SITE_NAME, PUBLIC_ROUTES } from "@shared/seo-routes";

interface SEOProps {
  /**
   * The page's path, looked up in PUBLIC_ROUTES (shared/seo-routes.ts) — the
   * one place titles and descriptions live. A path that is not in the map
   * renders the site name with noindex rather than failing, so the type is a
   * plain string; the unit tests, not the type, keep the map complete.
   */
  path: string;
  type?: "website" | "article";
}

const OG_IMAGE = `${BASE_URL}/og-preview.png`;

/**
 * Head tags for a public page. The server injects the same tags (and the
 * JSON-LD) into the shell from the same map; this keeps them correct after
 * client-side navigation. A path missing from the map renders noindex so a
 * typo can never publish the site-wide default as a duplicate page.
 */
export function SEO({ path, type = "website" }: SEOProps) {
  const entry = PUBLIC_ROUTES[path];
  const title = entry?.title ?? SITE_NAME;
  const description = entry?.description ?? "";
  const noindex = !entry || entry.noindex === true;
  const url = `${BASE_URL}${path === "/" ? "" : path}`;

  // react-helmet-async only collects DIRECT children of <Helmet>: a fragment
  // here silently drops every tag inside it, so each tag is guarded on its own.
  const pub = !noindex;
  return (
    <Helmet>
      <title>{title}</title>
      {description ? <meta name="description" content={description} /> : null}
      {noindex ? <meta name="robots" content="noindex,nofollow" /> : null}
      {pub ? <link rel="canonical" href={url} /> : null}
      {pub ? <meta property="og:type" content={type} /> : null}
      {pub ? <meta property="og:title" content={title} /> : null}
      {pub ? <meta property="og:description" content={description} /> : null}
      {pub ? <meta property="og:url" content={url} /> : null}
      {pub ? <meta property="og:site_name" content={SITE_NAME} /> : null}
      {pub ? <meta property="og:image" content={OG_IMAGE} /> : null}
      {pub ? <meta property="og:image:alt" content={`${SITE_NAME} logo`} /> : null}
      {pub ? <meta name="twitter:card" content="summary_large_image" /> : null}
      {pub ? <meta name="twitter:title" content={title} /> : null}
      {pub ? <meta name="twitter:description" content={description} /> : null}
      {pub ? <meta name="twitter:image" content={OG_IMAGE} /> : null}
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

