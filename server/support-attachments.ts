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
import { randomUUID } from "crypto";
import type { Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { supportCaseAttachments, type SupportCaseAttachment } from "@shared/schema";

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
}

export async function createAttachment(input: CreateAttachmentInput): Promise<SupportCaseAttachment> {
  if (!isAllowedAttachment(input.filename)) throw new Error("That file type is not allowed");
  if (input.bytes.length === 0) throw new Error("The file is empty");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("Files must be 15 MB or smaller");
  const filename = safeFilename(input.filename);
  const key = newStorageKey(input.orgId, input.caseId, filename);
  const mime = input.mimeType && input.mimeType !== "application/octet-stream" ? input.mimeType : guessMime(filename);
  await putBytes(key, input.bytes, mime);
  const [row] = await db.insert(supportCaseAttachments).values({
    orgId: input.orgId, caseId: input.caseId, messageId: input.messageId ?? null,
    filename, mimeType: mime, size: input.bytes.length, storageKey: key,
    uploadedByUserId: input.uploadedByUserId ?? null, uploadedByContactId: input.uploadedByContactId ?? null,
    source: input.source ?? "AGENT", externalRef: input.externalRef ?? null,
  }).returning();
  return row;
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

export async function listAttachments(orgId: string, caseId: string): Promise<SupportCaseAttachment[]> {
  return db.select().from(supportCaseAttachments).where(and(eq(supportCaseAttachments.orgId, orgId), eq(supportCaseAttachments.caseId, caseId))).orderBy(supportCaseAttachments.createdAt);
}

export async function getAttachment(orgId: string, id: string): Promise<SupportCaseAttachment | undefined> {
  const [row] = await db.select().from(supportCaseAttachments).where(and(eq(supportCaseAttachments.orgId, orgId), eq(supportCaseAttachments.id, id)));
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
  const rows = await db.select({ ref: supportCaseAttachments.externalRef }).from(supportCaseAttachments)
    .where(and(eq(supportCaseAttachments.orgId, orgId), inArray(supportCaseAttachments.caseId, caseIds)));
  return new Set(rows.map(r => r.ref).filter((x): x is string => !!x));
}

/** Public view: never expose the storage key. */
export function attachmentView(a: SupportCaseAttachment, urlBase: string) {
  return {
    id: a.id, caseId: a.caseId, messageId: a.messageId, filename: a.filename, mimeType: a.mimeType, size: a.size,
    isImage: a.mimeType.startsWith("image/"), source: a.source, createdAt: a.createdAt,
    url: `${urlBase}/${a.id}`,
  };
}
