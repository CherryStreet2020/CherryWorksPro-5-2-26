/**
 * Azure Blob Storage backend, shaped like the Google Cloud Storage client the
 * Replit integration exposes, so the three call sites do not have to change.
 *
 * WHY IT IS SHAPED LIKE GCS: server/routes/settings-routes.ts,
 * server/routes/brands.ts and server/lib/brand-logo-cleanup.ts all use
 * `objectStorageClient.bucket(b).file(o)` and a small set of GCS `File`
 * methods. Matching that surface keeps the migration to one selector import
 * per call site rather than a rewrite of three route files.
 *
 * AUTHENTICATION IS MANAGED IDENTITY, DELIBERATELY NOT A CONNECTION STRING.
 * A base64 account key corrupts on its way through the Container Apps
 * secretRef -> env-var pipeline and fails at request-signing time with an
 * opaque FormatException. That is the EAM #950 failure, and it was fixed there
 * by moving to managed identity, not by quoting the key more carefully.
 *
 * THE CLIENT IS BUILT LAZILY. Merely importing this module must not construct
 * DefaultAzureCredential — the module is reachable from the driver selector
 * even when OBJECT_STORAGE_DRIVER=replit, and on Replit there is no IMDS, no
 * environment credential and no CLI, so eager construction would throw on a
 * host where this driver is not even selected.
 */
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { Response } from "express";
import { Readable } from "stream";

/** Mirrors the GCS-side error so callers can keep catching one type. */
export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Azure blob metadata keys must be valid C# identifiers — no colons — so the
 * GCS key `custom:aclPolicy` becomes `aclpolicy`. Azure lower-cases keys on
 * read, so always compare lower-case.
 */
const ACL_METADATA_KEY = "aclpolicy";

let _service: BlobServiceClient | null = null;

function blobService(): BlobServiceClient {
  if (_service) return _service;
  const endpoint = process.env.AZURE_STORAGE_BLOB_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "AZURE_STORAGE_BLOB_ENDPOINT is not set (expected e.g. " +
        "https://<account>.blob.core.windows.net). Required when " +
        "OBJECT_STORAGE_DRIVER=azure.",
    );
  }
  _service = new BlobServiceClient(endpoint, new DefaultAzureCredential());
  return _service;
}

/** Metadata in the shape the GCS callers read. */
export interface GcsShapedMetadata {
  contentType?: string;
  size?: number;
  timeCreated?: string | null;
  updated?: string | null;
  cacheControl?: string;
}

export interface SaveOptions {
  contentType?: string;
  /** Accepted and ignored — a GCS-ism with no Azure equivalent. */
  resumable?: boolean;
  metadata?: { cacheControl?: string; [k: string]: unknown };
}

export class AzureFile {
  constructor(
    private readonly container: ContainerClient,
    public readonly name: string,
    /**
     * Populated by getFiles(), which lists properties in bulk.
     * brand-logo-cleanup.ts reads `file.metadata` SYNCHRONOUSLY, so listings
     * must arrive with this already filled in.
     */
    public metadata: GcsShapedMetadata = {},
  ) {}

  private get blob() {
    return this.container.getBlockBlobClient(this.name);
  }

  /** GCS returns a one-element tuple; keep that so callers are unchanged. */
  async exists(): Promise<[boolean]> {
    return [await this.blob.exists()];
  }

  async getMetadata(): Promise<[GcsShapedMetadata]> {
    const p = await this.blob.getProperties();
    const meta: GcsShapedMetadata = {
      contentType: p.contentType,
      size: p.contentLength,
      timeCreated: p.createdOn ? p.createdOn.toISOString() : null,
      updated: p.lastModified ? p.lastModified.toISOString() : null,
      cacheControl: p.cacheControl,
    };
    this.metadata = meta;
    return [meta];
  }

  createReadStream(): Readable {
    const pass = new Readable({ read() {} });
    this.blob
      .download()
      .then((resp) => {
        const body = resp.readableStreamBody;
        if (!body) {
          pass.emit("error", new ObjectNotFoundError());
          return;
        }
        body.on("data", (c: Buffer) => pass.push(c));
        body.on("end", () => pass.push(null));
        body.on("error", (e: Error) => pass.emit("error", e));
      })
      .catch((e: any) => {
        pass.emit(
          "error",
          e?.statusCode === 404 ? new ObjectNotFoundError() : e,
        );
      });
    return pass;
  }

  async save(body: Buffer, opts: SaveOptions = {}): Promise<void> {
    await this.blob.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: opts.contentType,
        blobCacheControl: opts.metadata?.cacheControl,
      },
    });
  }

  async delete(opts: { ignoreNotFound?: boolean } = {}): Promise<void> {
    if (opts.ignoreNotFound) {
      await this.blob.deleteIfExists();
      return;
    }
    await this.blob.delete();
  }

  /** ACL policy lives in blob metadata, the direct analogue of GCS custom metadata. */
  async getAclPolicy(): Promise<any | null> {
    try {
      const p = await this.blob.getProperties();
      const raw = p.metadata?.[ACL_METADATA_KEY];
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async setAclPolicy(policy: unknown): Promise<void> {
    const p = await this.blob.getProperties();
    await this.blob.setMetadata({
      ...(p.metadata ?? {}),
      [ACL_METADATA_KEY]: JSON.stringify(policy),
    });
  }
}

export class AzureBucket {
  private readonly container: ContainerClient;

  constructor(public readonly name: string) {
    this.container = blobService().getContainerClient(name);
  }

  file(objectName: string): AzureFile {
    return new AzureFile(this.container, objectName);
  }

  /** GCS returns [files]; metadata is populated so callers can read it synchronously. */
  async getFiles(opts: { prefix?: string } = {}): Promise<[AzureFile[]]> {
    const out: AzureFile[] = [];
    for await (const b of this.container.listBlobsFlat({
      prefix: opts.prefix,
    })) {
      out.push(
        new AzureFile(this.container, b.name, {
          contentType: b.properties.contentType,
          size: b.properties.contentLength,
          timeCreated: b.properties.createdOn
            ? b.properties.createdOn.toISOString()
            : null,
          updated: b.properties.lastModified
            ? b.properties.lastModified.toISOString()
            : null,
          cacheControl: b.properties.cacheControl,
        }),
      );
    }
    return [out];
  }
}

export const azureObjectStorageClient = {
  bucket(name: string): AzureBucket {
    return new AzureBucket(name);
  },
};

function parseObjectPath(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const p = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const i = p.indexOf("/");
  if (i === -1) return { bucketName: p, objectName: "" };
  return { bucketName: p.slice(0, i), objectName: p.slice(i + 1) };
}

export class AzureObjectStorageService {
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. For the azure driver set it to " +
          "/<container>/<prefix>, e.g. /public-objects/public.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. For the azure driver set it to " +
          "/<container>/<prefix>.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<AzureFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(
        `${searchPath}/${filePath}`,
      );
      const file = azureObjectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  /**
   * Streams the blob through the app. The Azure driver must NEVER hand a
   * *.blob.core.windows.net URL to the browser: the Content-Security-Policy in
   * server/routes.ts does not list that host in img-src, so a direct URL would
   * break every logo silently, in-browser only.
   */
  async downloadObject(
    file: AzureFile,
    res: Response,
    cacheTtlSec: number = 3600,
  ): Promise<void> {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await file.getAclPolicy();
      const isPublic = aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        ...(metadata.size !== undefined
          ? { "Content-Length": String(metadata.size) }
          : {}),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("[azure-object-storage] stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("[azure-object-storage] download failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }
}
