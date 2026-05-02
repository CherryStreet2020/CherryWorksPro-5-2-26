import { describe, it, expect } from "vitest";
import { buildWebhookFailureAlertEmail } from "./webhook-health-failure";

describe("buildWebhookFailureAlertEmail", () => {
  it("includes the org name, host, count, and last error", () => {
    const out = buildWebhookFailureAlertEmail({
      orgName: "Acme & Co",
      webhookHost: "hooks.example.test",
      consecutiveFailureCount: 4,
      lastError: "HTTP 500 <body>",
    });
    expect(out.subject).toContain("Acme & Co");
    expect(out.subject).toContain("4");
    expect(out.html).toContain("Acme &amp; Co");
    expect(out.html).toContain("hooks.example.test");
    expect(out.html).toContain("HTTP 500 &lt;body&gt;");
    expect(out.text).toContain("Acme & Co");
    expect(out.text).toContain("hooks.example.test");
    expect(out.text).toContain("HTTP 500");
  });

  it("renders gracefully when there is no last error", () => {
    const out = buildWebhookFailureAlertEmail({
      orgName: "Beta",
      webhookHost: "h.example",
      consecutiveFailureCount: 3,
      lastError: null,
    });
    expect(out.html).not.toContain("Last error:");
    expect(out.text).not.toContain("Last error:");
  });
});
