/**
 * The public /contact form posts here; the message is recorded in the operator
 * workspace's Marketing Hub (prospect + `form_submitted` activity) before the team is
 * notified, so a mail outage can't lose it. Validation and the success contract are
 * pinned; the email leg is best-effort.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { TEST_BASE as BASE } from "../helpers/base";
import { db } from "../../server/db";

const post = (body: unknown) => fetch(`${BASE}/api/public/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/public/contact", () => {
  it("rejects a message without name, email and message", async () => {
    expect((await post({ email: "a@b.co" })).status).toBe(400);
    expect((await post({ name: "A", email: "a@b.co", message: "   " })).status).toBe(400);
    expect((await post({ name: "A", email: "not-an-email", message: "Hello" })).status).toBe(400);
    expect((await post({ name: ["A"], email: "a@b.co", message: "Hello" })).status).toBe(400);
  });
  it("accepts a complete message", async () => {
    const email = `ada-contact-${Date.now()}@example.com`;
    const r = await post({ name: "Ada", email, message: "Do you import from Harvest?" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    // a second message from the same address updates the prospect instead of failing on the unique email
    const again = await post({ name: "Ada Lovelace", email: email.toUpperCase(), message: "Following up." });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
    // both messages are on one prospect in the operator's Marketing Hub, whether or not any mail went out
    const rows = await db.execute(sql`
      SELECT p.lead_source, p.notes, count(a.id)::int AS activities
        FROM marketing_prospects p
        JOIN orgs o ON o.id = p.org_id AND o.slug = 'cherry-street-consulting'
        LEFT JOIN contact_activities a ON a.prospect_id = p.id AND a.type = 'form_submitted'
       WHERE p.email = ${email}
       GROUP BY p.id`);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as { lead_source: string; notes: string; activities: number };
    expect(row.lead_source).toBe("website-contact");
    expect(row.activities).toBe(2);
    expect(row.notes).toContain("Do you import from Harvest?");
    expect(row.notes).toContain("Following up.");
    const gmail = await post({ name: "Bo", email: `bo-contact-${Date.now()}@gmail.com`, message: "Hi" });
    expect(gmail.status).toBe(200);
  });
});
