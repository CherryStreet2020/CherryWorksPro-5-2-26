import { describe, it, expect, afterEach } from "vitest";
import { appBaseUrl } from "../../server/lib/app-url";

const saved = { APP_BASE_URL: process.env.APP_BASE_URL, BASE_URL: process.env.BASE_URL };
afterEach(() => { for (const k of ["APP_BASE_URL", "BASE_URL"] as const) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

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
});
