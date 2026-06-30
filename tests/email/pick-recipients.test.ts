/**
 * pickRecipients — resolves the single To + CC for an invoice email.
 *
 * Powers the "never send to nobody" guard and the smart recipient defaults:
 * To falls back explicit → client email → primary contact → billing contact →
 * any contact; CC defaults to the client's billing contacts (To removed),
 * unless an explicit CC is provided. Returns to=null when nothing resolves so
 * the send/resend routes can refuse (422) instead of silently sending nowhere.
 */
import { describe, it, expect } from "vitest";
import { pickRecipients, type RecipientContact } from "../../server/email";

function c(partial: Partial<RecipientContact>): RecipientContact {
  return { email: null, role: null, isPrimary: false, ...partial };
}

describe("pickRecipients", () => {
  it("prefers an explicit override To over everything", () => {
    const r = pickRecipients({
      clientEmail: "client@acme.com",
      contacts: [c({ email: "primary@acme.com", isPrimary: true })],
      billingContacts: [],
      override: { to: "chosen@acme.com" },
    });
    expect(r.to).toBe("chosen@acme.com");
    expect(r.source).toBe("explicit");
  });

  it("uses the client email when no override is given", () => {
    const r = pickRecipients({ clientEmail: "client@acme.com", contacts: [], billingContacts: [] });
    expect(r.to).toBe("client@acme.com");
    expect(r.source).toBe("client");
  });

  it("falls back to the primary contact when there is no client email", () => {
    const r = pickRecipients({
      clientEmail: "",
      contacts: [c({ email: "other@acme.com" }), c({ email: "primary@acme.com", isPrimary: true })],
      billingContacts: [],
    });
    expect(r.to).toBe("primary@acme.com");
    expect(r.source).toBe("primary-contact");
  });

  it("falls back to a billing contact when there is no client email and no primary", () => {
    const r = pickRecipients({
      clientEmail: null,
      contacts: [c({ email: "person@acme.com", role: "ops" })],
      billingContacts: [c({ email: "billing@acme.com", role: "Billing" })],
    });
    expect(r.to).toBe("billing@acme.com");
    expect(r.source).toBe("billing-contact");
  });

  it("falls back to any contact with an email as a last resort", () => {
    const r = pickRecipients({
      clientEmail: "",
      contacts: [c({ email: null, role: "ops" }), c({ email: "anyone@acme.com", role: "ops" })],
      billingContacts: [],
    });
    expect(r.to).toBe("anyone@acme.com");
    expect(r.source).toBe("contact");
  });

  it("returns to=null / source none when nothing resolves to a valid email", () => {
    const r = pickRecipients({
      clientEmail: "",
      contacts: [c({ email: "not-an-email" }), c({ email: "  " })],
      billingContacts: [],
    });
    expect(r.to).toBeNull();
    expect(r.source).toBe("none");
  });

  it("ignores an invalid override To and falls through to the client email", () => {
    const r = pickRecipients({
      clientEmail: "client@acme.com",
      contacts: [],
      billingContacts: [],
      override: { to: "garbage" },
    });
    expect(r.to).toBe("client@acme.com");
    expect(r.source).toBe("client");
  });

  it("defaults CC to the billing contacts, excluding the resolved To", () => {
    // ABS-like: no client email, three billing contacts; To = first billing,
    // CC = the rest (deduped, To removed).
    const r = pickRecipients({
      clientEmail: "",
      contacts: [
        c({ email: "shadi@abs.com", role: "Billing", isPrimary: true }),
        c({ email: "karen@abs.com", role: "Billing" }),
        c({ email: "ap@abs.com", role: "Billing" }),
      ],
      billingContacts: [
        c({ email: "shadi@abs.com", role: "Billing", isPrimary: true }),
        c({ email: "karen@abs.com", role: "Billing" }),
        c({ email: "ap@abs.com", role: "Billing" }),
      ],
    });
    expect(r.to).toBe("shadi@abs.com");
    expect(r.source).toBe("primary-contact");
    expect(r.cc).toEqual(["karen@abs.com", "ap@abs.com"]); // shadi (To) removed
  });

  it("never throws on non-string override fields (defensive coercion)", () => {
    const r = pickRecipients({
      clientEmail: "client@acme.com",
      contacts: [],
      billingContacts: [],
      override: { to: { x: 1 } as any, cc: [123 as any, "extra@acme.com", "bad-cc"] },
    });
    expect(r.to).toBe("client@acme.com"); // invalid override.to ignored → client email
    expect(r.cc).toEqual(["extra@acme.com"]); // non-string + invalid CC dropped, valid kept
  });

  it("uses an explicit CC override (including an explicit empty array = no CC)", () => {
    const withCc = pickRecipients({
      clientEmail: "client@acme.com",
      contacts: [],
      billingContacts: [c({ email: "billing@acme.com" })],
      override: { cc: ["extra@acme.com", "client@acme.com"] },
    });
    expect(withCc.cc).toEqual(["extra@acme.com"]); // To removed from CC

    const noCc = pickRecipients({
      clientEmail: "client@acme.com",
      contacts: [],
      billingContacts: [c({ email: "billing@acme.com" })],
      override: { cc: [] },
    });
    expect(noCc.cc).toEqual([]); // explicit empty overrides the billing-contact default
  });
});
