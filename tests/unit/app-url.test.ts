import { describe, it, expect, afterEach } from "vitest";
import { appBaseUrl, trustedBaseUrl } from "../../server/lib/app-url";

const KEYS = ["APP_BASE_URL", "BASE_URL", "REPLIT_DOMAINS", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const req = (headers: Record<string, string>, host = "evil.example") => ({ headers, protocol: "http", get: (h: string) => (h.toLowerCase() === "host" ? host : undefined) }) as any;

describe("appBaseUrl", () => {
  it("prefers the configured origin over anything in the request", () => {
    process.env.APP_BASE_URL = "https://cherryworkspro.com/";
    expect(appBaseUrl(req({ host: "evil.example" }))).toBe("https://cherryworkspro.com");
    delete process.env.APP_BASE_URL; process.env.BASE_URL = "https://www.cherryworkspro.com";
    expect(appBaseUrl(req({ host: "evil.example" }))).toBe("https://www.cherryworkspro.com");
  });
  it("without configuration uses the forwarded origin, then the host header", () => {
    delete process.env.APP_BASE_URL; delete process.env.BASE_URL;
    expect(appBaseUrl(req({ "x-forwarded-proto": "https, http", "x-forwarded-host": "app.example, other" }))).toBe("https://app.example");
    expect(appBaseUrl(req({}, "localhost:5000"))).toBe("http://localhost:5000");
    expect(appBaseUrl()).toBe("http://localhost:5000");
  });
  it("trustedBaseUrl never reads the request: config, then the Replit domain, then fails closed in production", () => {
    delete process.env.APP_BASE_URL; delete process.env.BASE_URL; delete process.env.REPLIT_DOMAINS;
    process.env.NODE_ENV = "production";
    expect(() => trustedBaseUrl()).toThrow(/not configured/);
    process.env.REPLIT_DOMAINS = "cwp.replit.app,other";
    expect(trustedBaseUrl()).toBe("https://cwp.replit.app");
    process.env.BASE_URL = "https://cherryworkspro.com";
    expect(trustedBaseUrl()).toBe("https://cherryworkspro.com");
    process.env.NODE_ENV = "test"; delete process.env.BASE_URL; delete process.env.REPLIT_DOMAINS;
    expect(trustedBaseUrl()).toBe("http://localhost:5000");
  });
});
