/**
 * Attachments on Support Cases.
 *
 * Bytes go to the org's object storage under the private prefix when the
 * Azure driver is configured (production). With no object storage configured
 * (local dev, vitest) they go to a directory on disk instead, so the feature
 * and its tests work everywhere. Rows live in support_case_attachments.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID, createHash } from "crypto";
import type { Response } from "express";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { supportCaseAttachments, supportCases, type SupportCaseAttachment } from "@shared/schema";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const BLOCKED_EXT = new Set([".exe", ".bat", ".cmd", ".com", ".scr", ".ps1", ".sh", ".js", ".jar", ".msi", ".dll", ".vbs", ".html", ".htm", ".svg"]);

export function isAllowedAttachment(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return !BLOCKED_EXT.has(ext) && !filename.includes("..") && !filename.includes("/") && !filename.includes("\\");
}

export function safeFilename(name: string): string {
  const base = path.basename(name || "file").replace(/[^\w.\- ()]+/g, "_").slice(0, 150);
  return base || "file";
}

const useObjectStorage = (process.env.OBJECT_STORAGE_DRIVER || "").toLowerCase() === "azure" && !!process.env.PRIVATE_OBJECT_DIR;

function localDir(): string {
  const dir = process.env.ATTACHMENTS_DIR || path.join(os.tmpdir(), "cwp-attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function azure() {
  const mod = await import("./lib/object-storage-driver");
  const service = new mod.ObjectStorageService();
  const privateDir: string = service.getPrivateObjectDir();
  const full = (key: string) => `${privateDir.replace(/\/$/, "")}/${key}`;
  const split = (fullPath: string) => {
    const cleaned = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
    const [bucketName, ...rest] = cleaned.split("/");
    return { bucketName, objectName: rest.join("/") };
  };
  const file = (key: string) => {
    const { bucketName, objectName } = split(full(key));
    return mod.objectStorageClient.bucket(bucketName).file(objectName);
  };
  return { service, file };
}

export function newStorageKey(orgId: string, caseId: string, filename: string): string {
  return `support-cases/${orgId}/${caseId}/${randomUUID()}-${safeFilename(filename)}`;
}
/** Deterministic key for the durable upload protocol: a retry of the same file id lands on the same blob. */
export function stableStorageKey(orgId: string, caseId: string, clientFileId: string, filename: string): string {
  return `support-cases/${orgId}/${caseId}/${clientFileId}/${safeFilename(filename)}`;
}

export async function putBytes(key: string, bytes: Buffer, contentType: string): Promise<void> {
  if (useObjectStorage) {
    const { file } = await azure();
    await file(key).save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=3600" } });
    return;
  }
  const p = path.join(localDir(), key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, bytes);
}

export async function streamBytes(key: string, contentType: string, filename: string, res: Response, inline: boolean): Promise<void> {
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (useObjectStorage) {
    const { service, file } = await azure();
    await service.downloadObject(file(key), res, 3600);
    return;
  }
  const p = path.join(localDir(), key);
  if (!fs.existsSync(p)) { res.status(404).json({ message: "File not found" }); return; }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(p).pipe(res);
}

export async function deleteBytes(key: string): Promise<void> {
  if (useObjectStorage) {
    const { file } = await azure();
    await file(key).delete({ ignoreNotFound: true });
    return;
  }
  await fs.promises.rm(path.join(localDir(), key), { force: true });
}

export interface CreateAttachmentInput {
  orgId: string; caseId: string; messageId?: string | null;
  filename: string; mimeType: string; bytes: Buffer;
  uploadedByUserId?: string | null; uploadedByContactId?: string | null;
  source?: "AGENT" | "PORTAL" | "IMPORT" | "EMAIL"; externalRef?: string | null;
  /** Stable id for idempotent retries (the uploader's, or a server uuid when absent). */
  clientFileId?: string | null;
  /**
   * Re-evaluated INSIDE the transaction, under the case row lock, before any byte is written:
   * a customer whose access was revoked while their upload was in flight must not store a file.
   * Return false to refuse. Runs on the transaction connection.
   */
  authorize?: (tx: Tx) => Promise<boolean>;
}

export class AttachmentConflictError extends Error {}
export class AttachmentForbiddenError extends Error {}

/**
 * Durable upload protocol. The row is RESERVED first (deterministic storage key, completed_at
 * NULL), then the bytes go to that key, then the row is completed — all under the case row lock,
 * so a crash leaves a pending row whose retry lands on the same key (one row, one blob), a
 * concurrent retry waits and then sees the completed row, and a different payload under the
 * same id is refused. Pending rows are invisible everywhere except cleanup.
 */
export async function createAttachment(input: CreateAttachmentInput): Promise<SupportCaseAttachment> {
  if (!isAllowedAttachment(input.filename)) throw new Error("That file type is not allowed");
  if (input.bytes.length === 0) throw new Error("The file is empty");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("Files must be 15 MB or smaller");
  const filename = safeFilename(input.filename);
  const clientFileId = input.clientFileId && /^[A-Za-z0-9_-]{8,64}$/.test(input.clientFileId) ? input.clientFileId : randomUUID();
  const key = stableStorageKey(input.orgId, input.caseId, clientFileId, filename);
  const mime = input.mimeType && input.mimeType !== "application/octet-stream" ? input.mimeType : guessMime(filename);
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  return db.transaction(async (tx) => {
    // Global lock order: case row → (contact rows, checked by `authorize`) → attachment row.
    const [c] = await tx.select({ id: supportCases.id }).from(supportCases)
      .where(and(eq(supportCases.id, input.caseId), eq(supportCases.orgId, input.orgId))).for("update");
    if (!c) throw new Error("Support case not found");
    if (input.authorize && !(await input.authorize(tx))) throw new AttachmentForbiddenError("You no longer have access to this case");
    const [reserved] = await tx.insert(supportCaseAttachments).values({
      orgId: input.orgId, caseId: input.caseId, messageId: input.messageId ?? null,
      filename, mimeType: mime, size: input.bytes.length, storageKey: key,
      uploadedByUserId: input.uploadedByUserId ?? null, uploadedByContactId: input.uploadedByContactId ?? null,
      source: input.source ?? "AGENT", externalRef: input.externalRef ?? null,
      clientFileId, contentSha256: digest, completedAt: null,
    }).onConflictDoNothing({ target: [supportCaseAttachments.caseId, supportCaseAttachments.clientFileId], where: sql`client_file_id IS NOT NULL` }).returning();
    const row = reserved ?? (await tx.select().from(supportCaseAttachments)
      .where(and(eq(supportCaseAttachments.caseId, input.caseId), eq(supportCaseAttachments.clientFileId, clientFileId))).for("update"))[0];
    if (!row) throw new Error("Could not reserve the attachment");
    // Digest first — before any completed-row shortcut — so a different payload under the same id
    // is refused whether the earlier attempt finished or not.
    if (row.contentSha256 && row.contentSha256 !== digest) throw new AttachmentConflictError("A different file was already uploaded under this id");
    if (row.completedAt) return row;
    await putBytes(row.storageKey, input.bytes, mime);
    const [done] = await tx.update(supportCaseAttachments).set({ completedAt: new Date(), contentSha256: digest, size: input.bytes.length, mimeType: mime })
      .where(eq(supportCaseAttachments.id, row.id)).returning();
    return done;
  });
}

export function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".zip": "application/zip",
  };
  return map[ext] || "application/octet-stream";
}

/** Completed attachments only — a reservation whose bytes never arrived is not a file. */
export async function listAttachments(orgId: string, caseId: string): Promise<SupportCaseAttachment[]> {
  return db.select().from(supportCaseAttachments)
    .where(and(eq(supportCaseAttachments.orgId, orgId), eq(supportCaseAttachments.caseId, caseId), isNotNull(supportCaseAttachments.completedAt)))
    .orderBy(supportCaseAttachments.createdAt);
}
/** Every row, pending ones included: the case-deletion cleanup must remove blobs a crashed upload left behind. */
export async function listAttachmentsForCleanup(orgId: string, caseId: string, conn: DbOrTx = db): Promise<SupportCaseAttachment[]> {
  return conn.select().from(supportCaseAttachments).where(and(eq(supportCaseAttachments.orgId, orgId), eq(supportCaseAttachments.caseId, caseId)));
}

export async function getAttachment(orgId: string, id: string): Promise<SupportCaseAttachment | undefined> {
  const [row] = await db.select().from(supportCaseAttachments)
    .where(and(eq(supportCaseAttachments.orgId, orgId), eq(supportCaseAttachments.id, id), isNotNull(supportCaseAttachments.completedAt)));
  return row;
}

export async function deleteAttachment(orgId: string, id: string): Promise<boolean> {
  const row = await getAttachment(orgId, id);
  if (!row) return false;
  await deleteBytes(row.storageKey);
  await db.delete(supportCaseAttachments).where(eq(supportCaseAttachments.id, id));
  return true;
}

export async function existingExternalRefs(orgId: string, caseIds: string[]): Promise<Set<string>> {
  if (caseIds.length === 0) return new Set();
  // Completed only: a reservation whose download failed is retried by the next import.
  const rows = await db.select({ ref: supportCaseAttachments.externalRef }).from(supportCaseAttachments)
    .where(and(eq(supportCaseAttachments.orgId, orgId), inArray(supportCaseAttachments.caseId, caseIds), isNotNull(supportCaseAttachments.completedAt)));
  return new Set(rows.map(r => r.ref).filter((x): x is string => !!x));
}

/** Public view: never expose the storage key. */
export function attachmentView(a: SupportCaseAttachment, urlBase: string) {
  return {
    id: a.id, caseId: a.caseId, messageId: a.messageId, filename: a.filename, mimeType: a.mimeType, size: a.size,
    isImage: a.mimeType.startsWith("image/"), source: a.source, createdAt: a.createdAt,
    clientFileId: a.clientFileId ?? null,
    url: `${urlBase}/${a.id}`,
  };
}
