import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WS,
  WS_SQL_PATTERN,
  effectiveMarketingSender,
  readAcsRoutingConfig,
  resetMarketingRouteWarningsForTests,
  resolveMarketingRoute,
  stripWs,
} from "./marketing-route";

const CONFIG = {
  endpoint: "https://cwp-comms.unitedstates.communication.azure.com",
  orgSlugs: ["cherry-street-consulting"],
  senders: ["hello@news.cherryworkspro.com"],
};
const OPERATOR = { slug: "cherry-street-consulting" };

afterEach(() => {
  resetMarketingRouteWarningsForTests();
  vi.restoreAllMocks();
});

describe("effectiveMarketingSender", () => {
  it("prefers the item's address, lower-cased and stripped", () => {
    expect(effectiveMarketingSender("  Hello@News.CherryWorksPro.com ", "brand@x.com"))
      .toBe("hello@news.cherryworkspro.com");
  });

  it("falls back to the brand when the item is blank after stripping", () => {
    expect(effectiveMarketingSender("　 \t", " Brand@X.com ")).toBe("brand@x.com");
    expect(effectiveMarketingSender(null, "brand@x.com")).toBe("brand@x.com");
  });

  it("is null when neither has an address", () => {
    expect(effectiveMarketingSender(null, null)).toBeNull();
    expect(effectiveMarketingSender("", undefined)).toBeNull();
  });
});

describe("stripWs / WS_SQL_PATTERN", () => {
  it("strips exactly the code points JavaScript's \\s matches", () => {
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCodePoint(cp);
      expect(WS.includes(cp), `U+${cp.toString(16)}`).toBe(/\s/.test(ch));
    }
  });

  it("leaves inner whitespace alone", () => {
    expect(stripWs("﻿ a b  ")).toBe("a b");
  });

  it("the SQL pattern names the same characters", () => {
    for (const cp of WS) expect(WS_SQL_PATTERN).toContain(String.fromCodePoint(cp));
  });
});

describe("resolveMarketingRoute", () => {
  it("routes the operator's allow-listed sender to ACS", () => {
    expect(resolveMarketingRoute(OPERATOR, "hello@news.cherryworkspro.com", CONFIG)).toBe("acs");
    expect(resolveMarketingRoute({ slug: "Cherry-Street-Consulting" }, " HELLO@news.cherryworkspro.com ", CONFIG))
      .toBe("acs");
  });

  it("keeps everything else on the connected mailbox", () => {
    // No endpoint: ACS is off.
    expect(resolveMarketingRoute(OPERATOR, "hello@news.cherryworkspro.com", { ...CONFIG, endpoint: null }))
      .toBe("connected");
    // A customer org typing the operator address: the org allowlist is the tenant guard.
    expect(resolveMarketingRoute({ slug: "acme" }, "hello@news.cherryworkspro.com", CONFIG)).toBe("connected");
    // The operator org with a sender that isn't allow-listed (exact address, not domain).
    expect(resolveMarketingRoute(OPERATOR, "dean@news.cherryworkspro.com", CONFIG)).toBe("connected");
    expect(resolveMarketingRoute(OPERATOR, "hello@cherryworkspro.com", CONFIG)).toBe("connected");
    // Missing pieces.
    expect(resolveMarketingRoute(null, "hello@news.cherryworkspro.com", CONFIG)).toBe("connected");
    expect(resolveMarketingRoute({ slug: null }, "hello@news.cherryworkspro.com", CONFIG)).toBe("connected");
    expect(resolveMarketingRoute(OPERATOR, null, CONFIG)).toBe("connected");
  });

  it("an emptied ACS_EMAIL_ORG_SLUGS turns ACS off (the documented off switch)", () => {
    expect(resolveMarketingRoute(OPERATOR, "hello@news.cherryworkspro.com", { ...CONFIG, orgSlugs: [] }))
      .toBe("connected");
  });
});

describe("readAcsRoutingConfig", () => {
  it("parses comma lists, lower-casing and dropping blanks", () => {
    const cfg = readAcsRoutingConfig({
      ACS_EMAIL_ENDPOINT: " https://x.communication.azure.com ",
      ACS_EMAIL_ORG_SLUGS: "Cherry-Street-Consulting, ,other",
      ACS_EMAIL_SENDERS: "Hello@News.A.com,hello@news.b.com,",
    });
    expect(cfg).toEqual({
      endpoint: "https://x.communication.azure.com",
      orgSlugs: ["cherry-street-consulting", "other"],
      senders: ["hello@news.a.com", "hello@news.b.com"],
    });
  });

  it("a malformed list turns that list off and logs once", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ACS_EMAIL_ENDPOINT: "https://x", ACS_EMAIL_ORG_SLUGS: "ok", ACS_EMAIL_SENDERS: "news.a.com" };
    expect(readAcsRoutingConfig(env).senders).toEqual([]);
    expect(readAcsRoutingConfig(env).senders).toEqual([]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(readAcsRoutingConfig({ ACS_EMAIL_ORG_SLUGS: "bad slug!" }).orgSlugs).toEqual([]);
  });

  it("no endpoint ⇒ null", () => {
    expect(readAcsRoutingConfig({}).endpoint).toBeNull();
    expect(readAcsRoutingConfig({ ACS_EMAIL_ENDPOINT: "  " }).endpoint).toBeNull();
  });
});
