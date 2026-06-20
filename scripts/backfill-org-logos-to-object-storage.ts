/**
 * Task #469 — One-time backfill: copy any surviving local-disk org logos
 * into Replit Object Storage, then point `orgs.logo_url` at the new
 * durable URL.
 *
 * Background: Migration 0028 (Task #467) NULLed every `orgs.logo_url`
 * value still pointing at the legacy `/api/uploads/logos/` prefix
 * because that local-disk directory does not survive a redeploy. On
 * dev and on production replicas that haven't redeployed yet, the
 * actual files may still be sitting on disk. This script rescues
 * those files instead of forcing every admin to re-upload by hand.
 *
 * Strategy (audit-driven, NOT directory-driven):
 *   1. Build the candidate set from `audit_logs` — every distinct
 *      `org_id` with an `ORG_LOGO_UPDATED` row is a candidate. That
 *      anchors every potential rescue to a real upload event so a
 *      stray file can never be attached to an unrelated org.
 *   2. For each candidate org, look in `uploads/logos/` for any file
 *      whose basename equals the org id (matching the legacy upload
 *      pattern `uploads/logos/<orgId>.<ext>`).
 *      - Found + `orgs.logo_url IS NULL` → rescue: stream bytes to
 *        `org-logos/<orgId>-<uuid><ext>` (mirroring the live POST
 *        /api/org/logo route in server/routes/settings-routes.ts),
 *        set `orgs.logo_url`, and write a tagged `ORG_LOGO_UPDATED`
 *        audit entry.
 *      - Found + `orgs.logo_url` already set → `skipped-existing-logo`
 *        (idempotent — never clobber a freshly re-uploaded logo).
 *      - Not found → `missing-on-disk` (the typical prod case after
 *        a redeploy; logged so the operator can see which orgs need
 *        a manual re-upload).
 *      - Org row is gone → `org-deleted` (audit row outlived the org).
 *   3. After the audit-driven sweep, walk `uploads/logos/` once more
 *      and report any file that wasn't attributed to a candidate org
 *      as `unattributed-disk-file`. This surfaces leftover junk
 *      (e.g. brand logos, manual test files) without ever writing
 *      such a file to a real org row.
 *
 * Flags:
 *   --dry-run   Report what *would* happen without writing anything.
 *   --cleanup   Delete the local file after a successful migration.
 *
 * Usage:
 *   tsx scripts/backfill-org-logos-to-object-storage.ts [--dry-run] [--cleanup]
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { orgs, auditLogs } from "../shared/schema";
import {
  objectStorageClient,
  ObjectStorageService,
} from "../server/replit_integrations/object_storage/objectStorage";

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ALLOWED_EXTENSIONS_SET = new Set(ALLOWED_EXTENSIONS);
const MIME_FROM_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const ORG_LOGOS_PREFIX = "org-logos";

const DRY_RUN = process.argv.includes("--dry-run");
const CLEANUP = process.argv.includes("--cleanup");

function appBaseUrl(): string {
  const fromEnv = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;
  throw new Error(
    "Cannot determine app base URL. Set APP_BASE_URL or BASE_URL " +
      "(or run inside a Replit container so REPLIT_DOMAINS is set)."
  );
}

function splitBucketAndObject(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const cleaned = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const parts = cleaned.split("/");
  if (parts.length < 2) throw new Error(`Invalid bucket path: ${fullPath}`);
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

type Status =
  | "rescued"
  | "would-rescue"
  | "skipped-existing-logo"
  | "missing-on-disk"
  | "org-deleted"
  | "unattributed-disk-file"
  | "failed";

interface Outcome {
  orgId: string | null;
  file: string | null;
  status: Status;
  detail?: string;
}

async function main() {
  console.log(
    `=== backfill-org-logos-to-object-storage ${
      DRY_RUN ? "(DRY RUN)" : "(LIVE)"
    }${CLEANUP ? " (cleanup)" : ""} ===\n`
  );

  const logoDir = path.join(process.cwd(), "uploads", "logos");
  const dirExists = fs.existsSync(logoDir);
  if (!dirExists) {
    console.log(
      `Note: legacy logo directory ${logoDir} does not exist. We will ` +
        `still walk the audit log to surface orgs whose logo has been ` +
        `lost (no on-disk file to rescue).`
    );
  }

  // Index every file currently sitting in uploads/logos/ by its
  // basename (sans extension). Legacy filenames were `<orgId>.<ext>`
  // so that basename is the only key we can join the org row on.
  // basename → { filename: actual on-disk name, ext: lowercased extension }
  const filesByBasename = new Map<
    string,
    { filename: string; ext: string }
  >();
  if (dirExists) {
    for (const entry of fs.readdirSync(logoDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      // Case-insensitive extension parsing so legacy files with
      // uppercase extensions (e.g. `<orgId>.PNG`) still match.
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) continue;
      const ext = entry.name.slice(dot).toLowerCase();
      if (!ALLOWED_EXTENSIONS_SET.has(ext)) continue;
      const base = entry.name.slice(0, dot);
      // First-write wins on collisions (e.g. both .png and .jpg for
      // the same org); we'd only ever expect one anyway.
      if (!filesByBasename.has(base)) {
        filesByBasename.set(base, { filename: entry.name, ext });
      }
    }
  }

  // Audit-driven candidate set: every org that ever recorded an
  // ORG_LOGO_UPDATED event. Distinct so we only consider each org
  // once even if they re-uploaded multiple times.
  const candidateRows = await db
    .selectDistinct({ orgId: auditLogs.orgId })
    .from(auditLogs)
    .where(eq(auditLogs.action, "ORG_LOGO_UPDATED"));

  const candidateOrgIds = candidateRows
    .map((r) => r.orgId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  console.log(
    `Audit log lists ${candidateOrgIds.length} distinct org(s) with an ` +
      `ORG_LOGO_UPDATED event.`
  );
  console.log(
    `Local-disk dir contains ${filesByBasename.size} candidate file(s).\n`
  );

  // Resolve the public bucket up-front so we fail fast if Object
  // Storage isn't configured (instead of partway through the loop).
  const objectStorageService = new ObjectStorageService();
  const publicRoot = objectStorageService.getPublicObjectSearchPaths()[0];
  const baseUrl = appBaseUrl();

  const outcomes: Outcome[] = [];
  const attributedFiles = new Set<string>();

  for (const orgId of candidateOrgIds) {
    const orgRow = await db
      .select({ id: orgs.id, logoUrl: orgs.logoUrl })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    if (orgRow.length === 0) {
      // Audit row outlived the org row — nothing to do.
      outcomes.push({
        orgId,
        file: null,
        status: "org-deleted",
        detail: "ORG_LOGO_UPDATED audit row exists but the org is gone",
      });
      continue;
    }

    const fileEntry = filesByBasename.get(orgId);
    if (!fileEntry) {
      outcomes.push({
        orgId,
        file: null,
        status: "missing-on-disk",
        detail:
          "no `uploads/logos/<orgId>.<ext>` file present — admin must re-upload",
      });
      continue;
    }
    const { filename, ext } = fileEntry;
    attributedFiles.add(filename);

    if (orgRow[0].logoUrl) {
      outcomes.push({
        orgId,
        file: filename,
        status: "skipped-existing-logo",
        detail: `org already has logo_url=${orgRow[0].logoUrl}`,
      });
      continue;
    }

    const filePath = path.join(logoDir, filename);
    const newFilename = `${orgId}-${randomUUID()}${ext}`;
    const newLogoUrl = `${baseUrl}/api/public-objects/${ORG_LOGOS_PREFIX}/${newFilename}`;

    if (DRY_RUN) {
      outcomes.push({
        orgId,
        file: filename,
        status: "would-rescue",
        detail: `would upload to ${ORG_LOGOS_PREFIX}/${newFilename} and set logo_url=${newLogoUrl}`,
      });
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(filePath);
    } catch (err: any) {
      outcomes.push({
        orgId,
        file: filename,
        status: "failed",
        detail: `failed to read local file: ${err?.message ?? err}`,
      });
      continue;
    }

    const fullObjectPath = `${publicRoot.replace(/\/$/, "")}/${ORG_LOGOS_PREFIX}/${newFilename}`;
    const { bucketName, objectName } = splitBucketAndObject(fullObjectPath);
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    const contentType = MIME_FROM_EXT[ext] ?? "application/octet-stream";

    try {
      await objectFile.save(bytes, {
        contentType,
        resumable: false,
        metadata: { cacheControl: "public, max-age=31536000, immutable" },
      });
    } catch (err: any) {
      outcomes.push({
        orgId,
        file: filename,
        status: "failed",
        detail: `object storage upload failed: ${err?.message ?? err}`,
      });
      continue;
    }

    // Persist the new URL. The `WHERE logo_url IS NULL` guard means
    // a concurrent admin upload can land between our earlier read
    // and this write — so we explicitly verify a row was updated
    // before recording a rescue / writing the audit row. If the
    // DB write fails OR no row matched, evict the just-uploaded
    // object so we don't leak orphans into the bucket.
    let updated: { id: string }[] = [];
    try {
      await db.transaction(async (tx) => {
        updated = await tx
          .update(orgs)
          .set({ logoUrl: newLogoUrl })
          .where(and(eq(orgs.id, orgId), sql`${orgs.logoUrl} IS NULL`))
          .returning({ id: orgs.id });

        if (updated.length === 0) {
          // Concurrent upload won — abort the transaction so the
          // audit row isn't written.
          throw new Error(
            "logo_url was set by a concurrent writer between our read and write"
          );
        }

        await tx.insert(auditLogs).values({
          orgId,
          userId: null,
          action: "ORG_LOGO_UPDATED",
          entityType: "org",
          entityId: orgId,
          details: sql`${JSON.stringify({
            source: "backfill-org-logos-to-object-storage",
            previousFilename: filename,
            newFilename,
          })}::jsonb`,
        });
      });
    } catch (err: any) {
      try {
        await objectFile.delete({ ignoreNotFound: true });
      } catch {
        // best-effort
      }
      outcomes.push({
        orgId,
        file: filename,
        status: "failed",
        detail: `db update failed (uploaded object evicted): ${err?.message ?? err}`,
      });
      continue;
    }

    if (CLEANUP) {
      try {
        fs.unlinkSync(filePath);
      } catch (err: any) {
        // The migration succeeded; only warn that local cleanup
        // failed so an operator can sweep the dir manually.
        console.warn(
          `[warn] migrated ${filename} but failed to delete local file: ${
            err?.message ?? err
          }`
        );
      }
    }

    outcomes.push({
      orgId,
      file: filename,
      status: "rescued",
      detail: `set logo_url=${newLogoUrl}`,
    });
  }

  // Surface any disk file that wasn't claimed by a candidate org so
  // the operator can see what's lingering (brand logos, test junk,
  // manual drops, etc.) without ever writing it to a real row.
  for (const { filename } of filesByBasename.values()) {
    if (attributedFiles.has(filename)) continue;
    outcomes.push({
      orgId: null,
      file: filename,
      status: "unattributed-disk-file",
      detail:
        "no ORG_LOGO_UPDATED audit row matches this filename's basename",
    });
  }

  // ── Per-file/per-org results ──
  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log("Per-candidate results:");
  for (const o of outcomes) {
    const orgPart = o.orgId ? ` org=${o.orgId}` : "";
    const filePart = o.file ? ` file=${o.file}` : "";
    const detailPart = o.detail ? ` — ${o.detail}` : "";
    console.log(`  [${o.status}]${orgPart}${filePart}${detailPart}`);
  }

  console.log("\nSummary:");
  for (const status of [
    "rescued",
    "would-rescue",
    "skipped-existing-logo",
    "missing-on-disk",
    "org-deleted",
    "unattributed-disk-file",
    "failed",
  ] as const) {
    if (counts[status]) console.log(`  ${status}: ${counts[status]}`);
  }
  console.log(`  total: ${outcomes.length}`);

  await pool.end();
  process.exit(outcomes.some((o) => o.status === "failed") ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[fatal]", err);
  try {
    await pool.end();
  } catch {
    // noop
  }
  process.exit(1);
});
