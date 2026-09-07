import { describe, it, expect } from "vitest";
import { extractCaseKey, parseAddress, allAddresses, stripQuotedReply } from "../../server/inbound-email";

describe("inbound email parsing", () => {
  it("finds the case key in a subject", () => {
    expect(extractCaseKey("Re: [ABS-158] PO column")).toBe("ABS-158");
    expect(extractCaseKey("ABS-158: PO column")).toBe("ABS-158");
    expect(extractCaseKey("no key here")).toBeNull();
    expect(extractCaseKey("lowercase abs-158 ignored")).toBeNull();
  });
  it("parses addresses in every shape a mail provider sends", () => {
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
});
