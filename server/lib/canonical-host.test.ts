import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { canonicalHostRedirect, resolveCanonicalHost } from "./canonical-host";

const APEX = "cherryworkspro.com";

let server: http.Server;
let port: number;

type Reply = { status: number; location: string | undefined; body: string };

function request(
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers },
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

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(canonicalHostRedirect(resolveCanonicalHost(`https://${APEX}`)));
  app.all("/{*path}", (_req, res) => res.status(200).send("served"));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("resolveCanonicalHost", () => {
  it("returns the host of BASE_URL", () => {
    expect(resolveCanonicalHost("https://cherryworkspro.com")).toBe("cherryworkspro.com");
    expect(resolveCanonicalHost("https://CherryWorksPro.com/")).toBe("cherryworkspro.com");
  });

  it("keeps a port so a dev redirect target stays reachable", () => {
    expect(resolveCanonicalHost("http://localhost:5000")).toBe("localhost:5000");
  });

  it("returns null when BASE_URL is unset, malformed, or itself a www host", () => {
    expect(resolveCanonicalHost(undefined)).toBeNull();
    expect(resolveCanonicalHost("")).toBeNull();
    expect(resolveCanonicalHost("not a url")).toBeNull();
    expect(resolveCanonicalHost("https://www.example.com")).toBeNull();
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

  it("is a no-op when there is no canonical host", async () => {
    const app = express();
    app.use(canonicalHostRedirect(resolveCanonicalHost(undefined)));
    app.all("/{*path}", (_req, res) => res.status(200).send("served"));
    const s = await new Promise<http.Server>((resolve) => {
      const inst = app.listen(0, "127.0.0.1", () => resolve(inst));
    });
    const p = (s.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: p, path: "/", headers: { host: `www.${APEX}` } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on("error", reject);
    });
    await new Promise<void>((resolve) => s.close(() => resolve()));
    expect(status).toBe(200);
  });
});
