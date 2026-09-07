import { describe, it, expect } from "vitest";
import { htmlToText, isRelevant, hasReadScope } from "../../server/support-inbound-graph";

describe("Microsoft 365 inbox reader helpers", () => {
  it("knows which scopes allow reading", () => {
    expect(hasReadScope("offline_access Mail.Send Mail.ReadWrite openid")).toBe(true);
    expect(hasReadScope("offline_access Mail.Send openid email profile")).toBe(false);
    expect(hasReadScope(null)).toBe(false);
  });
  it("flattens Outlook HTML to readable text", () => {
    const html = "<html><head><style>p{color:red}</style></head><body><p>Hi Dean,</p><p>The PO column is blank.<br>See attached.</p><div>Thanks &amp; regards</div></body></html>";
    expect(htmlToText(html)).toBe("Hi Dean,\n\nThe PO column is blank.\nSee attached.\n\nThanks & regards");
  });
  it("picks up mail to the support address or carrying an org case key, ignores the rest", () => {
    const prefixes = new Set(["ABS-157"]);
    const to = (addr: string) => ({ toRecipients: [{ emailAddress: { address: addr } }] });
    expect(isRelevant({ id: "1", subject: "Printer offline", ...to("Support@CherryStConsulting.com") }, "support@cherrystconsulting.com", prefixes)).toBe(true);
    expect(isRelevant({ id: "2", subject: "Re: [ABS-157] PO column", ...to("dean@cherrystconsulting.com") }, "support@cherrystconsulting.com", prefixes)).toBe(true);
    expect(isRelevant({ id: "3", subject: "Lunch?", ...to("dean@cherrystconsulting.com") }, "support@cherrystconsulting.com", prefixes)).toBe(false);
    expect(isRelevant({ id: "4", subject: "XYZ-9 unrelated", ...to("dean@cherrystconsulting.com") }, "support@cherrystconsulting.com", prefixes)).toBe(false);
    // Same prefix, but not an existing case: ordinary mailbox traffic must not open a case.
    expect(isRelevant({ id: "5", subject: "[ABS-999] not a case", ...to("dean@cherrystconsulting.com") }, "support@cherrystconsulting.com", prefixes)).toBe(false);
  });
});
