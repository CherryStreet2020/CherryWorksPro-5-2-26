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
  it("rejects a message over 4,000 characters instead of cutting it", async () => {
    const email = `long-contact-${Date.now()}@example.com`;
    const r = await post({ name: "Al", email, message: "x".repeat(4001) });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/4,000 characters/);
    // nothing recorded: the visitor is told, so no half of the inquiry is stored
    const rows = await db.execute(sql`SELECT 1 FROM marketing_prospects WHERE email = ${email}`);
    expect(rows.rows).toHaveLength(0);
    expect((await post({ name: "Al", email, message: "x".repeat(4000) })).status).toBe(200);
  });
  it("files the activity under the prospect's own brand", async () => {
    const email = `brand-contact-${Date.now()}@example.com`;
    expect((await post({ name: "Cy", email, message: "First." })).status).toBe(200);
    // Move the prospect to another brand, then write again. The brand sits in a throwaway
    // workspace: one added to the operator's could be picked as its default brand by the
    // demo-request test running alongside.
    const slug = `brand-test-${Date.now()}`;
    const org = await db.execute(sql`INSERT INTO orgs (name, slug) VALUES ('Brand test', ${slug}) RETURNING id`);
    const orgId = (org.rows[0] as { id: string }).id;
    const made = await db.execute(sql`INSERT INTO brands (org_id, name, slug) VALUES (${orgId}, 'Second brand', ${slug}) RETURNING id`);
    const brandId = (made.rows[0] as { id: string }).id;
    const before = await db.execute(sql`SELECT brand_id FROM marketing_prospects WHERE email = ${email}`);
    const original = (before.rows[0] as { brand_id: string | null }).brand_id;
    await db.execute(sql`UPDATE marketing_prospects SET brand_id = ${brandId} WHERE email = ${email}`);
    try {
      expect((await post({ name: "Cy", email, message: "Second." })).status).toBe(200);
      const acts = await db.execute(sql`
        SELECT a.brand_id FROM contact_activities a JOIN marketing_prospects p ON p.id = a.prospect_id
         WHERE p.email = ${email} AND a.type = 'form_submitted' AND a.payload->>'message' = 'Second.'`);
      expect(acts.rows).toEqual([{ brand_id: brandId }]);
    } finally {
      await db.execute(sql`DELETE FROM contact_activities WHERE brand_id = ${brandId}`);
      await db.execute(sql`UPDATE marketing_prospects SET brand_id = ${original} WHERE email = ${email}`);
      await db.execute(sql`DELETE FROM brands WHERE id = ${brandId}`);
      await db.execute(sql`DELETE FROM orgs WHERE id = ${orgId}`);
    }
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
