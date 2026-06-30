/**
 * Unit coverage for SendEmailModal's recipient-option builder.
 *
 * The Send Invoice/Estimate dialog now surfaces the client company's
 * contacts as selectable To recipients. buildRecipientOptions() is the
 * pure core: it merges the primary client email with every contact that
 * has an email, deduping case-insensitively and keeping the client email
 * first (it stays the default To). These cases lock the dedup + label
 * behavior that the UI depends on.
 */
import { describe, it, expect } from "vitest";
import {
  buildRecipientOptions,
  CLIENT_EMAIL_LABEL,
  type ContactLite,
} from "../../client/src/components/shared/send-email-modal";

function contact(partial: Partial<ContactLite> & { id: string }): ContactLite {
  return {
    firstName: null,
    lastName: null,
    email: null,
    role: null,
    isPrimary: false,
    ...partial,
  };
}

describe("buildRecipientOptions", () => {
  it("lists the client email first, then named contacts with emails", () => {
    const opts = buildRecipientOptions("ap@acme.com", [
      contact({ id: "1", firstName: "Jane", lastName: "Smith", email: "jane@acme.com", role: "project" }),
      contact({ id: "2", firstName: "Bob", lastName: "Lee", email: "bob@acme.com", role: "accounts payable" }),
    ]);
    expect(opts.map((o) => o.email)).toEqual(["ap@acme.com", "jane@acme.com", "bob@acme.com"]);
    expect(opts[0].label).toBe(CLIENT_EMAIL_LABEL);
    expect(opts[1].label).toBe("Jane Smith · project");
    expect(opts[2].label).toBe("Bob Lee · accounts payable");
  });

  it("dedupes case-insensitively and upgrades the generic label to the matching contact's name", () => {
    // client email coincides with a contact (different case) → single entry,
    // labelled with the contact rather than the generic "Client email".
    const opts = buildRecipientOptions("John.Doe@acme.com", [
      contact({ id: "1", firstName: "John", lastName: "Doe", email: "john.doe@acme.com", role: "billing", isPrimary: true }),
      contact({ id: "2", firstName: "Jane", lastName: "Smith", email: "jane@acme.com", role: "project" }),
    ]);
    expect(opts).toHaveLength(2);
    expect(opts[0].email).toBe("John.Doe@acme.com"); // first-seen casing preserved
    expect(opts[0].label).toBe("John Doe · billing");
    expect(opts[1].label).toBe("Jane Smith · project");
  });

  it("excludes contacts without an email and trims/skips blanks", () => {
    const opts = buildRecipientOptions("", [
      contact({ id: "1", firstName: "No", lastName: "Email", email: null, role: "observer" }),
      contact({ id: "2", firstName: "Blank", lastName: "Space", email: "   ", role: "x" }),
      contact({ id: "3", firstName: "Real", lastName: "Person", email: "  real@acme.com  ", role: null }),
    ]);
    expect(opts).toEqual([{ email: "real@acme.com", label: "Real Person" }]);
  });

  it("falls back to the email as the label when a contact has no name", () => {
    const opts = buildRecipientOptions("", [
      contact({ id: "1", email: "nameless@acme.com", role: "billing" }),
    ]);
    expect(opts).toEqual([{ email: "nameless@acme.com", label: "nameless@acme.com · billing" }]);
  });

  it("returns nothing when there is no client email and no contacts", () => {
    expect(buildRecipientOptions("", undefined)).toEqual([]);
    expect(buildRecipientOptions("", [])).toEqual([]);
  });

  it("dedupes two contacts that share an email (keeps the first)", () => {
    const opts = buildRecipientOptions("", [
      contact({ id: "1", firstName: "First", lastName: "Seen", email: "dup@acme.com", role: "billing" }),
      contact({ id: "2", firstName: "Second", lastName: "Seen", email: "DUP@acme.com", role: "project" }),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toEqual({ email: "dup@acme.com", label: "First Seen · billing" });
  });
});
