import { describe, it, expect } from "vitest";
import { emailDetailCard, emailKeyValue } from "../../server/email";
import {
  buildAccountDeletionScheduledEmailHtml,
  buildAccountDeactivationEmailHtml,
} from "../../server/routes/settings-routes";

const DELETION_TITLE = "Account Deletion Scheduled";
const DEACTIVATION_TITLE = "Account Deactivated";

describe("emailDetailCard heading rendering", () => {
  it("renders an <h2> heading when a title is supplied", () => {
    const html = emailDetailCard(emailKeyValue("Foo", "Bar"), "My Title");
    expect(html).toContain("<h2");
    expect(html).toContain(">My Title</h2>");
  });

  it("escapes HTML in the title", () => {
    const html = emailDetailCard("", "<script>x</script>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("matches the existing untitled call site in sendInviteEmail (byte-equivalent)", () => {
    // Mirrors server/email.ts:394 inside sendInviteEmail, which passes no title.
    const html = emailDetailCard(
      emailKeyValue("Email", "user@example.com") +
        emailKeyValue("Password", `<code>secret123</code>`),
    );
    expect(html).not.toContain("<h2");
    expect(html).toMatchSnapshot();
  });

  it("omits the heading entirely when no title is supplied (byte-equivalent default)", () => {
    const rows = emailKeyValue("Email", "user@example.com");
    const html = emailDetailCard(rows);
    expect(html).not.toContain("<h2");
    expect(html).toMatchInlineSnapshot(`
      "<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;margin:24px 0;">
          <tr><td style="padding:20px 24px;">
            
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
          <td style="padding:6px 0;color:#8b8da3;font-size:13px;font-family:Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;white-space:nowrap;vertical-align:top;width:120px;">Email</td>
          <td style="padding:6px 0 6px 12px;color:#1a1a2e;font-size:14px;font-weight:600;font-family:Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">user@example.com</td>
        </tr>
            </table>
          </td></tr>
        </table>"
    `);
  });
});

describe("Account deletion-scheduled email (production renderer)", () => {
  const orgName = "Acme Inc";
  const formattedDate = "January 1, 2030";
  const html = buildAccountDeletionScheduledEmailHtml({ orgName, formattedDate });

  it("includes the in-card heading 'Account Deletion Scheduled'", () => {
    expect(html).toContain(`>${DELETION_TITLE}</h2>`);
  });

  it("renders the heading above the body content", () => {
    const headingIdx = html.indexOf(DELETION_TITLE);
    const bodyIdx = html.indexOf("Your account and all organization data");
    const dateIdx = html.lastIndexOf(formattedDate);
    expect(headingIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(headingIdx);
    expect(dateIdx).toBeGreaterThan(headingIdx);
  });

  it("includes the formatted scheduled deletion date and the org name in the layout", () => {
    expect(html).toContain(formattedDate);
    expect(html).toContain(orgName);
  });

  it("matches a stable snapshot (catches silent layout regressions)", () => {
    expect(html).toMatchSnapshot();
  });
});

describe("Account deactivation email (production renderer)", () => {
  const orgName = "Acme Inc";
  const html = buildAccountDeactivationEmailHtml({ orgName });

  it("includes the in-card heading 'Account Deactivated'", () => {
    expect(html).toContain(`>${DEACTIVATION_TITLE}</h2>`);
  });

  it("renders the heading above the body content", () => {
    const headingIdx = html.indexOf(DEACTIVATION_TITLE);
    const bodyIdx = html.indexOf(
      "Your account has been deactivated and your personal data removed.",
    );
    const adminIdx = html.indexOf("contact your organization administrator");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(headingIdx);
    expect(adminIdx).toBeGreaterThan(headingIdx);
  });

  it("includes the org name in the wrapping layout", () => {
    expect(html).toContain(orgName);
  });

  it("matches a stable snapshot (catches silent layout regressions)", () => {
    expect(html).toMatchSnapshot();
  });
});
