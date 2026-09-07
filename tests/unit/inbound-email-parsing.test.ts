import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { extractCaseKey, parseAddress, allAddresses, stripQuotedReply, verifySvixSignature } from "../../server/routes/resend-inbound-routes";

describe("inbound email parsing", () => {
  it("finds the case key in a subject", () => {
    expect(extractCaseKey("Re: [ABS-158] PO column")).toBe("ABS-158");
    expect(extractCaseKey("ABS-158: PO column")).toBe("ABS-158");
    expect(extractCaseKey("no key here")).toBeNull();
    expect(extractCaseKey("lowercase abs-158 ignored")).toBeNull();
  });
  it("parses addresses in every shape Resend sends", () => {
    expect(parseAddress("Shadi Mohaisen <Shadi@ABS.com>")).toEqual({ email: "shadi@abs.com", name: "Shadi Mohaisen" });
    expect(parseAddress("\"Ndanga, Ronald\" <r@abs.com>")).toEqual({ email: "r@abs.com", name: "Ndanga, Ronald" });
    expect(parseAddress("plain@abs.com")).toEqual({ email: "plain@abs.com", name: null });
    expect(parseAddress({ email: "obj@abs.com", name: "Obj" })).toEqual({ email: "obj@abs.com", name: "Obj" });
    expect(allAddresses(["a@x.com", "B <b@x.com>"])).toEqual(["a@x.com", "b@x.com"]);
  });
  it("strips quoted replies and > lines", () => {
    const text = "It's the one in bay 3.\n\nOn Mon, Sep 7, 2026 at 9:00 AM Dean <dean@cs.com> wrote:\n> Which tablet?\n> Thanks";
    expect(stripQuotedReply(text)).toBe("It's the one in bay 3.");
  });
  it("verifies a Svix signature and rejects a bad one", () => {
    const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64");
    const id = "msg_1"; const ts = String(Math.floor(Date.now() / 1000)); const body = '{"type":"email.received"}';
    const good = createHmac("sha256", Buffer.from("supersecretkey")).update(`${id}.${ts}.${body}`).digest("base64");
    expect(verifySvixSignature(secret, { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${good}` }, body)).toBe(true);
    expect(verifySvixSignature(secret, { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1,nope" }, body)).toBe(false);
    expect(verifySvixSignature(secret, { "svix-id": id, "svix-timestamp": "1000", "svix-signature": `v1,${good}` }, body)).toBe(false);
  });
});
