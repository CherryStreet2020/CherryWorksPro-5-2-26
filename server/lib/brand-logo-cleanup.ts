/**
 * Periodic cleanup of orphaned draft brand logos.
 *
 * The "Add brand" flow uploads a logo to public object storage *before*
 * the brand row is persisted (POST /api/brands/draft-logo writes
 * `brand-logos/draft-<uuid>.<ext>`). If the admin then closes the
 * dialog without saving, the file is left behind in the bucket.
 *
 * This module sweeps the bucket for `draft-*` files older than a
 * cutoff (default 24h) and deletes any that no `brands.logoUrl` row
 * still references. Files referenced by an actual brand row — even if
 * the brand was created from a draft URL — are preserved.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { brands } from "@shared/schema";
import {
  ObjectStorageService,
  objectStorageClient,
} from "../replit_integrations/object_storage";

const BRAND_LOGOS_PREFIX = "brand-logos";
const DRAFT_FILENAME_PREFIX = "draft-";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DraftLogoCleanupResult {
  scanned: number;
  deleted: number;
  keptReferenced: number;
  keptTooNew: number;
  errors: number;
}

export async function cleanupAbandonedDraftLogos(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<DraftLogoCleanupResult> {
  const result: DraftLogoCleanupResult = {
    scanned: 0,
    deleted: 0,
    keptReferenced: 0,
    keptTooNew: 0,
    errors: 0,
  };

  let publicRoot: string;
  try {
    const svc = new ObjectStorageService();
    publicRoot = svc.getPublicObjectSearchPaths()[0];
  } catch (err) {
    // No public bucket configured — nothing to clean.
    return result;
  }

  const cleaned = publicRoot.startsWith("/") ? publicRoot.slice(1) : publicRoot;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 1) return result;
  const bucketName = parts[0];
  const rootPrefix = parts.slice(1).join("/");
  const objectPrefix = `${rootPrefix ? `${rootPrefix}/` : ""}${BRAND_LOGOS_PREFIX}/${DRAFT_FILENAME_PREFIX}`;

  const bucket = objectStorageClient.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: objectPrefix });
  result.scanned = files.length;
  if (files.length === 0) return result;

  // Snapshot all draft-style logoUrls currently referenced by brand rows
  // so we never delete an in-use file even if it's older than the cutoff.
  const rows = await db
    .select({ logoUrl: brands.logoUrl })
    .from(brands)
    .where(sql`${brands.logoUrl} LIKE ${`%/${BRAND_LOGOS_PREFIX}/${DRAFT_FILENAME_PREFIX}%`}`);

  const referenced = new Set<string>();
  const refRegex = new RegExp(`/${BRAND_LOGOS_PREFIX}/(${DRAFT_FILENAME_PREFIX}[^/?#]+)`);
  for (const r of rows) {
    if (!r.logoUrl) continue;
    const m = r.logoUrl.match(refRegex);
    if (m) referenced.add(m[1]);
  }

  const cutoff = Date.now() - maxAgeMs;

  for (const file of files) {
    const basename = file.name.split("/").pop() || "";
    if (!basename.startsWith(DRAFT_FILENAME_PREFIX)) continue;

    if (referenced.has(basename)) {
      result.keptReferenced++;
      continue;
    }

    const meta: { timeCreated?: string | null; updated?: string | null } =
      file.metadata ?? {};
    const createdRaw = meta.timeCreated || meta.updated || null;
    const createdMs = createdRaw ? new Date(createdRaw).getTime() : NaN;
    if (!Number.isFinite(createdMs) || createdMs > cutoff) {
      result.keptTooNew++;
      continue;
    }

    try {
      await file.delete({ ignoreNotFound: true });
      result.deleted++;
    } catch (err) {
      result.errors++;
      console.error(
        `[brand-logo-cleanup] Failed to delete ${file.name}:`,
        (err as Error)?.message || err,
      );
    }
  }

  return result;
}
