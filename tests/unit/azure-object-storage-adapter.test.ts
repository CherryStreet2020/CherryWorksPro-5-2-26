import { describe, it, expect, vi } from "vitest";
import { AzureFile } from "../../server/lib/azure-object-storage";

/**
 * The Azure driver has to be shaped like the Google Cloud Storage client the
 * three call sites already use. These tests pin that shape, because a mismatch
 * would not surface until a logo upload failed in production — and the failure
 * mode is a silently missing logo on an invoice PDF, not an error.
 */
function fakeContainer(blob: any) {
  return { getBlockBlobClient: () => blob } as any;
}

describe("AzureFile — GCS-shaped surface", () => {
  it("exists() returns a one-element tuple like GCS", async () => {
    const f = new AzureFile(fakeContainer({ exists: async () => true }), "a/b.png");
    expect(await f.exists()).toEqual([true]);
  });

  it("getMetadata() maps Azure properties onto the GCS field names", async () => {
    const created = new Date("2026-01-02T03:04:05.000Z");
    const modified = new Date("2026-02-03T04:05:06.000Z");
    const f = new AzureFile(
      fakeContainer({
        getProperties: async () => ({
          contentType: "image/png",
          contentLength: 1234,
          createdOn: created,
          lastModified: modified,
          cacheControl: "public, max-age=31536000, immutable",
        }),
      }),
      "org-logos/x.png",
    );
    const [meta] = await f.getMetadata();
    expect(meta.contentType).toBe("image/png");
    expect(meta.size).toBe(1234);
    // brand-logo-cleanup.ts reads timeCreated/updated as ISO strings.
    expect(meta.timeCreated).toBe(created.toISOString());
    expect(meta.updated).toBe(modified.toISOString());
  });

  it("save() maps contentType and cacheControl onto blob HTTP headers", async () => {
    const uploadData = vi.fn(async () => ({}));
    const f = new AzureFile(fakeContainer({ uploadData }), "brand-logos/y.png");
    const body = Buffer.from("png-bytes");
    await f.save(body, {
      contentType: "image/png",
      resumable: false, // GCS-ism, must be accepted and ignored
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
    expect(uploadData).toHaveBeenCalledTimes(1);
    const [sentBody, opts] = uploadData.mock.calls[0] as any[];
    expect(sentBody).toBe(body);
    expect(opts.blobHTTPHeaders.blobContentType).toBe("image/png");
    expect(opts.blobHTTPHeaders.blobCacheControl).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("delete({ignoreNotFound:true}) uses deleteIfExists, not delete", async () => {
    const del = vi.fn(async () => {});
    const delIfExists = vi.fn(async () => ({ succeeded: true }));
    const f = new AzureFile(
      fakeContainer({ delete: del, deleteIfExists: delIfExists }),
      "z.png",
    );
    await f.delete({ ignoreNotFound: true });
    expect(delIfExists).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("delete() without the flag uses the throwing form", async () => {
    const del = vi.fn(async () => {});
    const delIfExists = vi.fn(async () => ({ succeeded: true }));
    const f = new AzureFile(
      fakeContainer({ delete: del, deleteIfExists: delIfExists }),
      "z.png",
    );
    await f.delete();
    expect(del).toHaveBeenCalledTimes(1);
    expect(delIfExists).not.toHaveBeenCalled();
  });

  it("ACL policy round-trips through blob metadata under a colon-free key", async () => {
    // Azure metadata keys must be valid C# identifiers, so GCS's
    // `custom:aclPolicy` cannot be used verbatim.
    let stored: Record<string, string> = {};
    const f = new AzureFile(
      fakeContainer({
        getProperties: async () => ({ metadata: stored }),
        setMetadata: async (m: Record<string, string>) => {
          stored = m;
        },
      }),
      "p.png",
    );
    await f.setAclPolicy({ visibility: "public" });
    expect(Object.keys(stored)).toEqual(["aclpolicy"]);
    expect(Object.keys(stored)[0]).not.toContain(":");
    expect(await f.getAclPolicy()).toEqual({ visibility: "public" });
  });

  it("getAclPolicy() returns null rather than throwing when absent", async () => {
    const f = new AzureFile(
      fakeContainer({ getProperties: async () => ({ metadata: {} }) }),
      "p.png",
    );
    expect(await f.getAclPolicy()).toBeNull();
  });
});

describe("driver selector", () => {
  it("defaults to the replit driver when the variable is unset", async () => {
    vi.resetModules();
    delete process.env.OBJECT_STORAGE_DRIVER;
    const mod = await import("../../server/lib/object-storage-driver");
    expect(mod.objectStorageDriver).toBe("replit");
  });

  it("selects azure only on an exact match, and falls back otherwise", async () => {
    vi.resetModules();
    process.env.OBJECT_STORAGE_DRIVER = "azure";
    expect((await import("../../server/lib/object-storage-driver")).objectStorageDriver).toBe("azure");

    vi.resetModules();
    process.env.OBJECT_STORAGE_DRIVER = "gcs";
    expect((await import("../../server/lib/object-storage-driver")).objectStorageDriver).toBe("replit");

    delete process.env.OBJECT_STORAGE_DRIVER;
  });
});
