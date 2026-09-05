import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { canonicalHostRedirect, resolveCanonicalOrigin } from "./canonical-host";

const APEX = "cherryworkspro.com";

let server: http.Server;
let port: number;

type Reply = { status: number; location: string | undefined; body: string };

function requestOn(
  p: number,
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: p, path, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const request = (path: string, headers: Record<string, string>, method = "GET") =>
  requestOn(port, path, headers, method);

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise<http.Server>((resolve) => {
    const inst = app.listen(0, "127.0.0.1", () => resolve(inst));
  });
}

function appWith(baseUrl: string | undefined): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(canonicalHostRedirect(resolveCanonicalOrigin(baseUrl)));
  app.all("/{*path}", (_req, res) => res.status(200).send("served"));
  return app;
}

beforeAll(async () => {
  server = await listen(appWith(`https://${APEX}`));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("resolveCanonicalOrigin", () => {
  it("returns the origin and hostname of the base URL", () => {
    expect(resolveCanonicalOrigin("https://cherryworkspro.com")).toEqual({
      origin: "https://cherryworkspro.com",
      hostname: "cherryworkspro.com",
    });
    expect(resolveCanonicalOrigin("https://CherryWorksPro.com/")).toEqual({
      origin: "https://cherryworkspro.com",
      hostname: "cherryworkspro.com",
    });
  });

  it("keeps the configured scheme and port so a dev redirect target stays reachable", () => {
    expect(resolveCanonicalOrigin("http://localhost:5000")).toEqual({
      origin: "http://localhost:5000",
      hostname: "localhost",
    });
  });

  it("returns null when the base URL is unset, malformed, not http(s), or itself a www host", () => {
    expect(resolveCanonicalOrigin(undefined)).toBeNull();
    expect(resolveCanonicalOrigin("")).toBeNull();
    expect(resolveCanonicalOrigin("not a url")).toBeNull();
    expect(resolveCanonicalOrigin("https://www.example.com")).toBeNull();
    // new URL("custom://host").origin is the string "null"; never redirect to "null/...".
    expect(resolveCanonicalOrigin("custom://cherryworkspro.com")).toBeNull();
    expect(resolveCanonicalOrigin("ftp://cherryworkspro.com")).toBeNull();
  });
});

describe("canonicalHostRedirect", () => {
  it("301s a GET on www to the apex, preserving path and query", async () => {
    const r = await request("/invoices/abc?tab=paid&x=1", { host: `www.${APEX}` });
    expect(r.status).toBe(301);
    expect(r.location).toBe(`https://${APEX}/invoices/abc?tab=paid&x=1`);
  });

  it("301s HEAD and 308s non-safe methods so the method survives", async () => {
    const head = await request("/", { host: `www.${APEX}` }, "HEAD");
    expect(head.status).toBe(301);
    const post = await request("/api/login", { host: `www.${APEX}` }, "POST");
    expect(post.status).toBe(308);
    expect(post.location).toBe(`https://${APEX}/api/login`);
  });

  it("matches the www host case-insensitively and ignores a port", async () => {
    const r = await request("/", { host: `WWW.${APEX}:443` });
    expect(r.status).toBe(301);
  });

  it("honours X-Forwarded-Host behind the ingress proxy", async () => {
    const r = await request("/dashboard", {
      host: "10.0.0.7:3000",
      "x-forwarded-host": `www.${APEX}`,
    });
    expect(r.status).toBe(301);
    expect(r.location).toBe(`https://${APEX}/dashboard`);
  });

  it("passes the apex, the Azure FQDN, localhost and probe hosts straight through", async () => {
    for (const host of [
      APEX,
      "cwp-app.yellowsand-42126fad.eastus2.azurecontainerapps.io",
      "localhost:5000",
      "10.0.0.7:3000",
      "www.someoneelse.com",
    ]) {
      const r = await request("/api/health", { host });
      expect(r.status, host).toBe(200);
      expect(r.body, host).toBe("served");
    }
  });

  it("redirects to the configured scheme and port, not a hardcoded https", async () => {
    const s = await listen(appWith("http://localhost:5000"));
    const p = (s.address() as AddressInfo).port;
    try {
      const r = await requestOn(p, "/x?y=1", { host: "www.localhost:5000" });
      expect(r.status).toBe(301);
      expect(r.location).toBe("http://localhost:5000/x?y=1");
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it("is a no-op when there is no canonical origin", async () => {
    const s = await listen(appWith(undefined));
    const p = (s.address() as AddressInfo).port;
    try {
      const r = await requestOn(p, "/", { host: `www.${APEX}` });
      expect(r.status).toBe(200);
      expect(r.body).toBe("served");
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});
