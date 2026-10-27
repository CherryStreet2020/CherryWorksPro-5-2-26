import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import {
  isUnsubscribeToken,
  listUnsubscribeHeaders,
  orgPostalAddress,
  unsubscribeFooterHtml,
  unsubscribeFooterText,
  unsubscribePageUrl,
  withUnsubscribeFooter,
} from "../../server/marketing/unsubscribe";

const TOKEN = "3f2b8c1e-9a4d-4c7e-8b21-0d5e6f7a8b9c";

describe("marketing unsubscribe helpers", () => {
  const prevBase = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://app.example.test/";
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevBase;
  });

  it("accepts only UUID tokens", () => {
    expect(isUnsubscribeToken(TOKEN)).toBe(true);
    expect(isUnsubscribeToken("not-a-token")).toBe(false);
    expect(isUnsubscribeToken(`${TOKEN}/../x`)).toBe(false);
    expect(isUnsubscribeToken(undefined)).toBe(false);
  });

  it("builds links from APP_BASE_URL without a double slash", () => {
    expect(unsubscribePageUrl(TOKEN)).toBe(`https://app.example.test/unsubscribe/${TOKEN}`);
  });

  it("falls back to the public site when no base URL is set", () => {
    delete process.env.APP_BASE_URL;
    const prev = process.env.BASE_URL;
    delete process.env.BASE_URL;
    try {
      expect(unsubscribePageUrl(TOKEN)).toBe(`https://cherryworkspro.com/unsubscribe/${TOKEN}`);
    } finally {
      if (prev !== undefined) process.env.BASE_URL = prev;
    }
  });

  it("emits RFC 8058 one-click headers pointing at the POST endpoint", () => {
    expect(listUnsubscribeHeaders(TOKEN)).toEqual({
      "List-Unsubscribe": `<https://app.example.test/api/public/unsubscribe/${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("prefers the structured postal address, else the legacy one", () => {
    expect(
      orgPostalAddress({
        addressStreet: "1 Main St",
        addressSuite: "Suite 2",
        addressCity: "Springfield",
        addressState: "IL",
        addressZip: "62701",
        addressCountry: "USA",
        address: "ignored",
      }),
    ).toBe("1 Main St, Suite 2, Springfield, IL 62701, USA");
    expect(orgPostalAddress({ address: "PO Box 9\nTown, ST 00000" })).toBe("PO Box 9, Town, ST 00000");
    expect(orgPostalAddress({})).toBeNull();
    expect(orgPostalAddress(null)).toBeNull();
  });

  it("escapes the org name and address in the HTML footer", () => {
    const html = unsubscribeFooterHtml({
      token: TOKEN,
      org: { name: "A&B <Co>", address: "<script>x</script>" },
    });
    expect(html).toContain("A&amp;B &lt;Co&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain(`href="https://app.example.test/unsubscribe/${TOKEN}"`);
  });

  it("writes a plain-text footer with the link and address", () => {
    const text = unsubscribeFooterText({ token: TOKEN, org: { name: "Acme", address: "1 Main St" } });
    expect(text).toContain("from Acme");
    expect(text).toContain(`Unsubscribe: https://app.example.test/unsubscribe/${TOKEN}`);
    expect(text).toContain("1 Main St");
  });

  it("puts the footer before </body> in a full document, else at the end", () => {
    const input = { token: TOKEN, org: { name: "Acme" } };
    const doc = withUnsubscribeFooter("<html><body><p>Hi</p></BODY></html>", input);
    expect(doc.indexOf("Unsubscribe")).toBeLessThan(doc.indexOf("</BODY>"));
    expect(doc.endsWith("</BODY></html>")).toBe(true);
    const frag = withUnsubscribeFooter("<p>Hi</p>", input);
    expect(frag.startsWith("<p>Hi</p><div")).toBe(true);
    expect(withUnsubscribeFooter("", input)).toContain("Unsubscribe");
  });
});
