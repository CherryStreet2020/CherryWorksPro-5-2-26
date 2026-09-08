import { Helmet } from "react-helmet-async";
import { BASE_URL, SITE_NAME, PUBLIC_ROUTES } from "@shared/seo-routes";

interface SEOProps {
  /** A key of PUBLIC_ROUTES (shared/seo-routes.ts) — the one place titles and descriptions live. */
  path: keyof typeof PUBLIC_ROUTES | (string & {});
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

  return (
    <Helmet>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      {noindex ? (
        <meta name="robots" content="noindex,nofollow" />
      ) : (
        <>
          <link rel="canonical" href={url} />
          <meta property="og:type" content={type} />
          <meta property="og:title" content={title} />
          <meta property="og:description" content={description} />
          <meta property="og:url" content={url} />
          <meta property="og:site_name" content={SITE_NAME} />
          <meta property="og:image" content={OG_IMAGE} />
          <meta property="og:image:alt" content={`${SITE_NAME} logo`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={title} />
          <meta name="twitter:description" content={description} />
          <meta name="twitter:image" content={OG_IMAGE} />
        </>
      )}
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

