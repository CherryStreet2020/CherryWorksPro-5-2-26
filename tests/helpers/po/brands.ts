/**
 * Brand helpers for E2E specs (Task #441).
 *
 * The Marketing OS audit §6.1.7 requires cross-brand isolation
 * coverage. The dev workflow exposes `POST /api/brands` which an
 * isolated-org admin can call freely (the org sits at BUSINESS-active
 * via the `isolatedOrg` fixture). This helper centralises the boring
 * shape so every spec doesn't re-roll the request, and offers a
 * convenience that mints two distinct brands per org for the
 * cross-brand isolation suite.
 */
import type { APIRequestContext } from "@playwright/test";
import { BASE } from "./isolation";

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  fromEmail: string | null;
  fromName: string | null;
  replyTo: string | null;
  [k: string]: unknown;
}

export interface BrandIsoCtx {
  request: APIRequestContext;
  csrf: string;
}

/**
 * Create a brand for the supplied isolated-org context. Adds a small
 * randomised suffix to `slug` so two calls in the same spec can never
 * collide on the unique-slug constraint.
 */
export async function createBrand(
  iso: BrandIsoCtx,
  opts: {
    name: string;
    slug: string;
    domain?: string;
    fromEmail?: string;
    fromName?: string;
    replyTo?: string;
  },
): Promise<BrandRow> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const data: Record<string, string> = {
    name: opts.name,
    slug: `${opts.slug}-${suffix}`,
  };
  if (opts.domain) data.domain = opts.domain;
  if (opts.fromEmail) data.fromEmail = opts.fromEmail;
  if (opts.fromName) data.fromName = opts.fromName;
  if (opts.replyTo) data.replyTo = opts.replyTo;
  const res = await iso.request.post(`${BASE}/api/brands`, {
    headers: { "x-csrf-token": iso.csrf },
    data,
  });
  if (res.status() !== 201) {
    throw new Error(
      `[e2e brands] createBrand failed: ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as BrandRow;
}

/**
 * Mint two distinct brands ("A" and "B") for the supplied isolated org.
 * Used by the brand-aware cross-brand isolation spec (audit §6.1.7).
 */
export async function withTwoBrands(
  iso: BrandIsoCtx,
): Promise<{ brandA: BrandRow; brandB: BrandRow }> {
  const brandA = await createBrand(iso, {
    name: "Cross-Iso Brand A",
    slug: "cross-iso-a",
    domain: "brand-a.test",
    fromEmail: "noreply@brand-a.test",
    fromName: "Brand A",
  });
  const brandB = await createBrand(iso, {
    name: "Cross-Iso Brand B",
    slug: "cross-iso-b",
    domain: "brand-b.test",
    fromEmail: "noreply@brand-b.test",
    fromName: "Brand B",
  });
  return { brandA, brandB };
}
