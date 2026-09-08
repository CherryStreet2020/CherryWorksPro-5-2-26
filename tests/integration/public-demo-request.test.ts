/**
 * The public demo-request form posts here; the request is recorded in the operator
 * workspace's Marketing Hub (prospect + company + activity) and the team notified. Validation and the success contract are pinned; the email leg is best-effort
 * (the route answers ok with a warning when no transport is configured).
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

const post = (body: unknown) => fetch(`${BASE}/api/public/demo-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/public/demo-request", () => {
  it("rejects a request without name, email and firm", async () => {
    expect((await post({ email: "a@b.co" })).status).toBe(400);
    expect((await post({ name: "A", email: "not-an-email", company: "Firm" })).status).toBe(400);
  });
  it("accepts a complete request", async () => {
    const r = await post({ name: "Ada", email: "ada@example.com", company: "Example Consulting", teamSize: "6-15", message: "We use Harvest + Jira." });
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    // a second request from the same address updates the prospect instead of failing on the unique email
    const again = await post({ name: "Ada Lovelace", email: "ada@example.com", company: "Example Consulting", teamSize: "6-15", message: "Following up." });
    expect(again.status).toBe(200);
    expect((await again.json()).updated).toBe(true);
  });
});
