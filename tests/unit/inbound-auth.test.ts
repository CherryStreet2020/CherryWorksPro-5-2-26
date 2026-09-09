/**
 * Sender authentication for inbound support mail (server/support-inbound-graph.ts).
 *
 * The rule: only Exchange Online's own Authentication-Results counts (recognised by
 * shape: the value starts with a method, no authserv-id), only when the message also
 * carries X-MS-Exchange-Organization-AuthSource (an organization header EXO strips
 * from outside mail), and only when the passing method is ALIGNED with the claimed
 * From: domain. Everything else fails closed.
 */
import { describe, it, expect } from "vitest";
import { senderAuthenticatedFromHeaders } from "../../server/support-inbound-graph";

const AUTHSOURCE = { name: "X-MS-Exchange-Organization-AuthSource", value: "BN0PR03MB1234.namprd03.prod.outlook.com" };
const exo = (value: string) => ({ name: "Authentication-Results", value });
const FROM = "shadi@absmachining.com";

describe("senderAuthenticatedFromHeaders", () => {
  it("accepts EXO's documented format when dkim is aligned with From", () => {
    const h = [AUTHSOURCE, exo("spf=pass (sender IP is 40.107.1.1) smtp.mailfrom=absmachining.com; dkim=pass (signature was verified) header.d=absmachining.com;dmarc=pass action=none header.from=absmachining.com;compauth=pass reason=100")];
    expect(senderAuthenticatedFromHeaders(h, FROM)).toBe(true);
  });

  it("accepts spf alignment alone, and a parent-domain dkim signer", () => {
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, exo("spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=absmachining.com; dkim=none (message not signed) header.d=none;dmarc=none")], FROM)).toBe(true);
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, exo("spf=fail smtp.mailfrom=other.example; dkim=pass header.d=absmachining.com")], "it@mail.absmachining.com")).toBe(true);
  });

  it("ignores a pass for an unrelated domain (attacker signs their own mail, claims the customer's From)", () => {
    const h = [AUTHSOURCE, exo("spf=pass (sender IP is 5.6.7.8) smtp.mailfrom=attacker.example; dkim=pass (signature was verified) header.d=attacker.example;dmarc=fail action=oreject header.from=absmachining.com;compauth=fail reason=000")];
    expect(senderAuthenticatedFromHeaders(h, FROM)).toBe(false);
  });

  it("compauth=pass alone is never enough", () => {
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, exo("spf=none; dkim=none; dmarc=none; compauth=pass reason=109")], FROM)).toBe(false);
  });

  it("fails closed without the organization AuthSource header (message did not come through this tenant's EXO)", () => {
    expect(senderAuthenticatedFromHeaders([exo("spf=pass smtp.mailfrom=absmachining.com; dkim=pass header.d=absmachining.com")], FROM)).toBe(false);
  });

  it("a foreign header (authserv-id prefix) never counts, whatever its position", () => {
    const foreign = { name: "Authentication-Results", value: "mx.google.com; dkim=pass header.i=@absmachining.com header.d=absmachining.com; spf=pass smtp.mailfrom=absmachining.com; dmarc=pass header.from=absmachining.com" };
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, foreign], FROM)).toBe(false);
    // Reordered: foreign first, EXO second — EXO's verdict (fail) still decides.
    const exoFail = exo("spf=fail (sender IP is 9.9.9.9) smtp.mailfrom=absmachining.com; dkim=none; dmarc=fail action=oreject header.from=absmachining.com;compauth=fail reason=000");
    expect(senderAuthenticatedFromHeaders([foreign, AUTHSOURCE, exoFail], FROM)).toBe(false);
    // And with an EXO pass below a foreign header, order is irrelevant too.
    expect(senderAuthenticatedFromHeaders([foreign, AUTHSOURCE, exo("spf=pass smtp.mailfrom=absmachining.com")], FROM)).toBe(true);
  });

  it("an injected EXO-shaped header makes provenance ambiguous → false, whatever the order", () => {
    const forgedPass = exo("spf=pass smtp.mailfrom=absmachining.com; dkim=pass header.d=absmachining.com; dmarc=pass header.from=absmachining.com");
    const realFail = exo("spf=fail (sender IP is 9.9.9.9) smtp.mailfrom=absmachining.com; dkim=none; dmarc=fail action=oreject header.from=absmachining.com;compauth=fail reason=000");
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, forgedPass, realFail], FROM)).toBe(false);
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, realFail, forgedPass], FROM)).toBe(false);
    expect(senderAuthenticatedFromHeaders([forgedPass, AUTHSOURCE, forgedPass], FROM)).toBe(false);
  });

  it("no headers, no From, or no Authentication-Results → false", () => {
    expect(senderAuthenticatedFromHeaders(undefined, FROM)).toBe(false);
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE], FROM)).toBe(false);
    expect(senderAuthenticatedFromHeaders([AUTHSOURCE, exo("spf=pass smtp.mailfrom=absmachining.com")], "")).toBe(false);
  });
});
