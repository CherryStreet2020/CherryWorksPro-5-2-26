/**
 * Sprint 2f Phase 7 — Task #75
 * Perf-seeding for the per-contact activity timeline + firehose query.
 *
 * Usage:
 *   npx tsx scripts/seed-perf-marketing-events.ts --seed-perf
 *   npx tsx scripts/seed-perf-marketing-events.ts --unseed-perf
 *
 * Plants ~10,000 contact_activities rows across 3 existing brands × 50
 * synthetic contacts (~67 activities/contact average) with a realistic
 * type distribution and occurred_at spread over the last 365 days.
 *
 * Safety gates (ALL must pass before any insert/delete):
 *   1. NODE_ENV !== "production"
 *   2. Existing contact_activities row count < 100,000
 *   3. Idempotency marker: payload->>'seed_batch' = 'perf-2f-phase7'
 *      • --seed-perf is a no-op if marker already present
 *      • --unseed-perf only deletes rows carrying this marker
 *
 * NO production tables, columns, or indexes are altered — this script
 * only inserts/deletes rows scoped to its own marker.
 */
import { db } from "../server/db";
import {
  brands,
  clientContacts,
  contactActivities,
} from "../shared/schema";
import { and, eq, sql } from "drizzle-orm";

const SEED_BATCH = "perf-2f-phase7";
const TARGET_ROWS = 10_000;
const TARGET_BRANDS = 3;
const CONTACTS_PER_BRAND = 50;
const HARD_CAP = 100_000;
const ACTIVITY_TYPES = [
  { type: "email_sent", weight: 30 },
  { type: "email_opened", weight: 20 },
  { type: "note_added", weight: 15 },
  { type: "call_logged", weight: 10 },
  { type: "meeting_scheduled", weight: 8 },
  { type: "task_completed", weight: 7 },
  { type: "form_submitted", weight: 5 },
  { type: "page_viewed", weight: 5 },
];
const WEIGHT_TOTAL = ACTIVITY_TYPES.reduce((s, t) => s + t.weight, 0);

function pickType(): string {
  let r = Math.random() * WEIGHT_TOTAL;
  for (const t of ACTIVITY_TYPES) {
    r -= t.weight;
    if (r <= 0) return t.type;
  }
  return ACTIVITY_TYPES[0].type;
}

function randomOccurredAt(): Date {
  // Spread across the last 365 days, with a bias toward recent days.
  const daysAgo = Math.floor(Math.pow(Math.random(), 1.7) * 365);
  const ms = Date.now() - daysAgo * 86_400_000 - Math.floor(Math.random() * 86_400_000);
  return new Date(ms);
}

async function checkSafetyGates(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("REFUSE: NODE_ENV=production. Perf seed is dev-only.");
  }
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM contact_activities`
  );
  const count = Number((r.rows as any[])[0].count);
  if (count >= HARD_CAP) {
    throw new Error(
      `REFUSE: contact_activities row count is ${count}, hard cap is ${HARD_CAP}.`
    );
  }
  console.log(`[safety] NODE_ENV=${process.env.NODE_ENV ?? "unset"}; existing rows=${count}`);
}

async function pickBrandsForSeed() {
  // Group brands by org to find one org with at least 3 brands.
  const all = await db.select().from(brands);
  const byOrg = new Map<string, typeof all>();
  for (const b of all) {
    if (!byOrg.has(b.orgId)) byOrg.set(b.orgId, []);
    byOrg.get(b.orgId)!.push(b);
  }
  for (const [orgId, list] of Array.from(byOrg.entries())) {
    if (list.length >= TARGET_BRANDS) {
      const picked = list.slice(0, TARGET_BRANDS);
      console.log(
        `[brands] org=${orgId} picked=${picked.map((b) => b.name).join(", ")}`
      );
      return { orgId, brands: picked };
    }
  }
  throw new Error(
    `REFUSE: no org has >=${TARGET_BRANDS} brands. Cannot seed across 3 brands.`
  );
}

async function ensureSyntheticContacts(
  orgId: string,
  brandId: string,
  brandName: string
): Promise<string[]> {
  const existing = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.orgId, orgId),
        eq(clientContacts.brandId, brandId),
        sql`${clientContacts.email} LIKE ${'perf-2f-phase7-%'}`
      )
    );
  if (existing.length >= CONTACTS_PER_BRAND) {
    console.log(`[contacts] brand=${brandId} reuse ${existing.length} synthetic contacts`);
    return existing.map((c) => c.id).slice(0, CONTACTS_PER_BRAND);
  }
  const need = CONTACTS_PER_BRAND - existing.length;
  console.log(`[contacts] brand=${brandId} creating ${need} synthetic contacts`);
  const rows = Array.from({ length: need }, (_, i) => ({
    orgId,
    brandId,
    firstName: "Perf",
    lastName: `Contact${existing.length + i + 1}`,
    email: `perf-2f-phase7-${brandId.slice(0, 8)}-${existing.length + i + 1}@example.test`,
  }));
  const inserted = await db.insert(clientContacts).values(rows).returning({ id: clientContacts.id });
  return [...existing.map((c) => c.id), ...inserted.map((r) => r.id)];
}

async function seed() {
  await checkSafetyGates();

  // Idempotency: if marker rows already exist, exit success.
  const mkR = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM contact_activities WHERE payload->>'seed_batch' = ${SEED_BATCH}`
  );
  const existingMarker = Number((mkR.rows as any[])[0].count);
  if (existingMarker > 0) {
    console.log(
      `[idempotency] ${existingMarker} rows already carry seed_batch='${SEED_BATCH}'. Exiting (no-op).`
    );
    return { inserted: 0, alreadyPresent: existingMarker, brands: [], contactsTotal: 0 };
  }

  const { orgId, brands: chosen } = await pickBrandsForSeed();
  const allContactIds: { brandId: string; contactId: string }[] = [];
  for (const b of chosen) {
    const ids = await ensureSyntheticContacts(orgId, b.id, b.name);
    for (const cid of ids) allContactIds.push({ brandId: b.id, contactId: cid });
  }

  console.log(
    `[plan] target=${TARGET_ROWS} rows across ${chosen.length} brands × ${CONTACTS_PER_BRAND} contacts (${allContactIds.length} total)`
  );

  // Distribute TARGET_ROWS across all (brand, contact) pairs.
  const perContact = Math.ceil(TARGET_ROWS / allContactIds.length);
  const BATCH = 1_000;
  const buffer: Array<{
    orgId: string;
    brandId: string;
    contactId: string;
    type: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }> = [];
  let inserted = 0;

  for (const { brandId, contactId } of allContactIds) {
    for (let i = 0; i < perContact; i++) {
      if (inserted + buffer.length >= TARGET_ROWS) break;
      buffer.push({
        orgId,
        brandId,
        contactId,
        type: pickType(),
        payload: { seed_batch: SEED_BATCH, idx: inserted + buffer.length },
        occurredAt: randomOccurredAt(),
      });
      if (buffer.length >= BATCH) {
        await db.insert(contactActivities).values(buffer);
        inserted += buffer.length;
        buffer.length = 0;
        if (inserted % 2_000 === 0) console.log(`[seed] ${inserted}/${TARGET_ROWS}`);
      }
    }
  }
  if (buffer.length > 0) {
    await db.insert(contactActivities).values(buffer);
    inserted += buffer.length;
  }

  console.log(`[seed] DONE: inserted ${inserted} rows with marker='${SEED_BATCH}'`);
  return {
    inserted,
    alreadyPresent: 0,
    brands: chosen.map((b) => ({ id: b.id, name: b.name })),
    contactsTotal: allContactIds.length,
  };
}

async function unseed() {
  await checkSafetyGates();
  const result = await db.execute(
    sql`DELETE FROM contact_activities WHERE payload->>'seed_batch' = ${SEED_BATCH}`
  );
  const deletedRows = result.rowCount ?? 0;
  // Also remove the synthetic contacts (they cascade-clear remaining rows).
  const contactsDel = await db.execute(
    sql`DELETE FROM client_contacts WHERE email LIKE 'perf-2f-phase7-%'`
  );
  console.log(
    `[unseed] DONE: deleted ${deletedRows} activities + ${contactsDel.rowCount ?? 0} synthetic contacts`
  );
}

const flag = process.argv.find((a) => a === "--seed-perf" || a === "--unseed-perf");
if (!flag) {
  console.error("usage: --seed-perf | --unseed-perf");
  process.exit(2);
}

(flag === "--seed-perf" ? seed() : unseed())
  .then((r) => {
    if (r) console.log("[result]", JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("[error]", e);
    process.exit(1);
  });
