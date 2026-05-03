/**
 * Marketing OS — Sprint 1: Brands CRUD endpoints.
 *
 * Every handler short-circuits to 404 when MARKETING_OS_ENABLED is unset.
 * Reads use requireAuth, writes use requireAdmin (brand config carries
 * firm identity — admin only).
 *
 * Tenant isolation: every query/mutation is scoped by req.session.orgId!.
 * Mirrors the pattern from server/routes/client-routes.ts.
 *
 * Task #156 (Apr 2026): adds POST /api/brands/:id/logo for hosted
 * logo uploads. Files are stored in Replit App Storage under the
 * public bucket path (`${PUBLIC_OBJECT_SEARCH_PATHS[0]}/brand-logos/`)
 * so they survive container rebuilds and render in outbound email
 * without auth. The endpoint persists the file via the GCS-compatible
 * client and writes a fully-qualified HTTPS URL back into
 * `brand.logoUrl`. Existing data-URL logoUrl values continue to render
 * unchanged.
 */
import type { Express, Request, Response } from "express";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { storage } from "../storage";
import { requireAuth, requireAdmin, sanitizeErrorMessage } from "./middleware";
import { isMarketingOsEnabled } from "../lib/featureFlags";
import { paramId } from "../lib/req-params";
import { insertBrandSchema } from "@shared/schema";
import {
  ObjectStorageService,
  objectStorageClient,
} from "../replit_integrations/object_storage";
import {
  isExemptLogoUrl,
  validateExternalLogoUrl,
} from "../lib/validate-logo-url";

const ALLOWED_LOGO_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const ALLOWED_LOGO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
]);
const DANGEROUS_LOGO_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".pif",
  ".js",
  ".vbs",
  ".svg",
  ".html",
  ".htm",
  ".php",
]);

const MIME_FROM_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// In-memory multer: we stream the buffer straight to object storage,
// no disk hop required.
const brandLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (DANGEROUS_LOGO_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type "${ext}" is not allowed for security reasons`));
    }
    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
      return cb(new Error(`File extension "${ext}" is not allowed. Accepted: ${[...ALLOWED_LOGO_EXTENSIONS].join(", ")}`));
    }
    if (
      !ALLOWED_LOGO_MIMETYPES.has(file.mimetype) &&
      file.mimetype !== "application/octet-stream"
    ) {
      return cb(new Error(`MIME type "${file.mimetype}" is not allowed for logo uploads`));
    }
    if (
      file.originalname.includes("..") ||
      file.originalname.includes("/") ||
      file.originalname.includes("\\")
    ) {
      return cb(new Error("Filename contains path traversal characters"));
    }
    cb(null, true);
  },
});

const BRAND_LOGOS_PREFIX = "brand-logos";

// Build an absolute https URL to a brand-logo file served by this app.
// Mirrors the auth-routes / entitlement-checkout pattern: prefer
// APP_BASE_URL/BASE_URL, then REPLIT_DOMAINS, then derive from the
// incoming request. The trailing slash is stripped to avoid `//api/...`.
function appBaseUrl(req: Request): string {
  const fromEnv = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;
  return `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
}

// Parse a `/<bucket>/<object>` path into its two components.
function splitBucketAndObject(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const cleaned = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const parts = cleaned.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid bucket path: ${fullPath}`);
  }
  return {
    bucketName: parts[0],
    objectName: parts.slice(1).join("/"),
  };
}

export function registerBrandRoutes(app: Express) {
  // ──────────────────────────────────────────────────────────────────
  // GET /api/brands — list brands for the current org
  // ──────────────────────────────────────────────────────────────────
  app.get("/api/brands", requireAuth, async (req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
    try {
      const rows = await storage.listBrandsByOrg(req.session.orgId!);
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /api/brands/:id — fetch one brand (tenant-scoped)
  // ──────────────────────────────────────────────────────────────────
  app.get("/api/brands/:id", requireAuth, async (req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
    try {
      const brand = await storage.getBrand(paramId(req), req.session.orgId!);
      if (!brand) return res.status(404).json({ message: "Brand not found" });
      return res.json(brand);
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /api/brands — create a brand (admin only)
  // ──────────────────────────────────────────────────────────────────
  app.post("/api/brands", requireAdmin, async (req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
    try {
      const parsed = insertBrandSchema.parse({
        ...req.body,
        orgId: req.session.orgId!,
      });
      // Task #160: any pasted external logo URL must point at a real image
      // on the public internet — reject javascript:/data: schemes, private
      // IPs (SSRF), and non-image responses. Hosted/data URLs are exempt.
      if (parsed.logoUrl && !isExemptLogoUrl(parsed.logoUrl)) {
        const v = await validateExternalLogoUrl(parsed.logoUrl);
        if (!v.ok) return res.status(400).json({ message: v.message });
      }
      const brand = await storage.createBrand(parsed);
      return res.status(201).json(brand);
    } catch (err: any) {
      return res.status(400).json({ message: sanitizeErrorMessage(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // PATCH /api/brands/:id — update a brand (admin only, tenant-scoped)
  // ──────────────────────────────────────────────────────────────────
  app.patch("/api/brands/:id", requireAdmin, async (req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
    try {
      // Disallow orgId/id rewrites; everything else is optional via .partial()
      const parsed = insertBrandSchema.partial().omit({ orgId: true }).parse(req.body);
      // Task #160: same external-URL guard as POST. Only validate when the
      // caller actually sent a logoUrl (PATCH bodies are partial); leaving
      // it untouched preserves the existing value.
      if (
        Object.prototype.hasOwnProperty.call(parsed, "logoUrl") &&
        parsed.logoUrl &&
        !isExemptLogoUrl(parsed.logoUrl)
      ) {
        const v = await validateExternalLogoUrl(parsed.logoUrl);
        if (!v.ok) return res.status(400).json({ message: v.message });
      }
      const brand = await storage.updateBrand(
        paramId(req),
        req.session.orgId!,
        parsed,
      );
      if (!brand) return res.status(404).json({ message: "Brand not found" });
      return res.json(brand);
    } catch (err: any) {
      return res.status(400).json({ message: sanitizeErrorMessage(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // DELETE /api/brands/:id — soft-delete (active=false, admin only)
  // ──────────────────────────────────────────────────────────────────
  app.delete("/api/brands/:id", requireAdmin, async (req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
    try {
      const brand = await storage.softDeleteBrand(paramId(req), req.session.orgId!);
      if (!brand) return res.status(404).json({ message: "Brand not found" });
      return res.json({ ok: true, brand });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /api/brands/draft-logo — upload a hosted logo before the
  // brand row exists (admin only). Used by the "Add brand" flow so the
  // dropzone can return a real https URL instead of a base64 data URL.
  // The returned logoUrl is then submitted as part of the create call.
  // Files land under brand-logos/draft-<uuid><ext>; if the admin
  // abandons the dialog the object is orphaned and gets reaped by
  // server/lib/brand-logo-cleanup.ts (24h cutoff, runs every 6h).
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/api/brands/draft-logo",
    requireAdmin,
    (req, res, next) => {
      if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
      brandLogoUpload.single("logo")(req, res, (err: unknown) => {
        if (err) {
          const message =
            err instanceof Error ? err.message : "File upload failed";
          return res.status(400).json({ message });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({
            message:
              "No file uploaded. Accepted: JPG, PNG, GIF, WebP (max 5MB). SVG files are not accepted for security reasons.",
          });
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
          return res.status(400).json({ message: `File extension "${ext}" is not allowed` });
        }

        const objectStorageService = new ObjectStorageService();
        const publicPaths = objectStorageService.getPublicObjectSearchPaths();
        const publicRoot = publicPaths[0];
        const filename = `draft-${randomUUID()}${ext}`;
        const fullObjectPath = `${publicRoot.replace(/\/$/, "")}/${BRAND_LOGOS_PREFIX}/${filename}`;
        const { bucketName, objectName } = splitBucketAndObject(fullObjectPath);
        const bucket = objectStorageClient.bucket(bucketName);
        const objectFile = bucket.file(objectName);
        const contentType =
          MIME_FROM_EXT[ext] ||
          (file.mimetype !== "application/octet-stream"
            ? file.mimetype
            : "application/octet-stream");

        await objectFile.save(file.buffer, {
          contentType,
          resumable: false,
          metadata: {
            cacheControl: "public, max-age=31536000, immutable",
          },
        });

        const logoUrl = `${appBaseUrl(req)}/api/public-objects/${BRAND_LOGOS_PREFIX}/${filename}`;
        return res.json({ logoUrl });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // POST /api/brands/:id/logo — upload a hosted logo (admin only)
  // multipart/form-data with field "logo". On success the file lands
  // in the public App Storage path under brand-logos/, brand.logoUrl
  // is updated to the absolute https URL, and { logoUrl } is returned.
  // ──────────────────────────────────────────────────────────────────
  app.post(
    "/api/brands/:id/logo",
    requireAdmin,
    (req, res, next) => {
      if (!isMarketingOsEnabled()) return res.status(404).json({ message: "Not found" });
      brandLogoUpload.single("logo")(req, res, (err: unknown) => {
        if (err) {
          const message =
            err instanceof Error ? err.message : "File upload failed";
          return res.status(400).json({ message });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const brandId = paramId(req);
        const orgId = req.session.orgId!;
        const file = req.file;

        // Tenant guard: confirm brand exists in this org before
        // accepting the upload.
        const existing = await storage.getBrand(brandId, orgId);
        if (!existing) {
          return res.status(404).json({ message: "Brand not found" });
        }

        if (!file) {
          return res.status(400).json({
            message:
              "No file uploaded. Accepted: JPG, PNG, GIF, WebP (max 5MB). SVG files are not accepted for security reasons.",
          });
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
          return res.status(400).json({ message: `File extension "${ext}" is not allowed` });
        }

        // Resolve the public bucket path (e.g.
        // `/replit-objstore-…/public`) and stream the buffer into
        // `brand-logos/<brandId>-<ts><ext>`. The timestamp suffix
        // defeats stale browser/CDN caches when the logo is replaced.
        const objectStorageService = new ObjectStorageService();
        const publicPaths = objectStorageService.getPublicObjectSearchPaths();
        const publicRoot = publicPaths[0];
        const filename = `${brandId}-${Date.now()}${ext}`;
        const fullObjectPath = `${publicRoot.replace(/\/$/, "")}/${BRAND_LOGOS_PREFIX}/${filename}`;
        const { bucketName, objectName } = splitBucketAndObject(fullObjectPath);
        const bucket = objectStorageClient.bucket(bucketName);
        const objectFile = bucket.file(objectName);
        const contentType =
          MIME_FROM_EXT[ext] ||
          (file.mimetype !== "application/octet-stream"
            ? file.mimetype
            : "application/octet-stream");

        await objectFile.save(file.buffer, {
          contentType,
          resumable: false,
          metadata: {
            cacheControl: "public, max-age=31536000, immutable",
          },
        });

        const logoUrl = `${appBaseUrl(req)}/api/public-objects/${BRAND_LOGOS_PREFIX}/${filename}`;
        // Best-effort: if updateBrand fails, the orphaned object stays
        // in storage but the DB failure is surfaced to the caller.
        await storage.updateBrand(brandId, orgId, { logoUrl });

        // Best-effort cleanup of the previously-hosted file (skip
        // data URLs and external URLs).
        const prev = existing.logoUrl;
        if (prev) {
          const marker = `/api/public-objects/${BRAND_LOGOS_PREFIX}/`;
          const idx = prev.indexOf(marker);
          if (idx !== -1) {
            const prevName = prev.slice(idx + marker.length);
            if (prevName && prevName !== filename) {
              const prevPath = `${publicRoot.replace(/\/$/, "")}/${BRAND_LOGOS_PREFIX}/${prevName}`;
              const { bucketName: pBucket, objectName: pObject } =
                splitBucketAndObject(prevPath);
              try {
                await objectStorageClient
                  .bucket(pBucket)
                  .file(pObject)
                  .delete({ ignoreNotFound: true });
              } catch {
                // swallow — eviction failures shouldn't break the upload response
              }
            }
          }
        }

        return res.json({ logoUrl });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/public-objects/brand-logos/:filename — serve a hosted
  // brand logo from the public App Storage bucket. Public on purpose
  // (no auth) so emails and unauthenticated previews can render it.
  // ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/public-objects/brand-logos/:filename",
    async (req: Request, res: Response) => {
      try {
        const rawFilename = req.params.filename;
        const filename = path.basename(
          Array.isArray(rawFilename) ? rawFilename[0] : String(rawFilename),
        );
        // Reject anything that escapes the brand-logos prefix.
        if (!filename || filename.includes("/") || filename.includes("..")) {
          return res.status(400).json({ message: "Invalid filename" });
        }
        const ext = path.extname(filename).toLowerCase();
        if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
          return res.status(400).json({ message: "Invalid filename" });
        }
        const objectStorageService = new ObjectStorageService();
        const file = await objectStorageService.searchPublicObject(
          `${BRAND_LOGOS_PREFIX}/${filename}`,
        );
        if (!file) return res.status(404).json({ message: "Not found" });
        await objectStorageService.downloadObject(file, res, 31536000);
        return;
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );
}
