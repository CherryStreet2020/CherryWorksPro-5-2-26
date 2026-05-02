/**
 * Sprint M-Chat-1 — boot-time data migration that ensures the CherryWorks
 * Pro brand row has the marketing-chat persona configured.
 *
 * Runs at boot in `server/index.ts` after Phase-0 SQL (so the new
 * `chat_*` columns exist) but before route registration.
 *
 * The migration fires in two narrow cases only:
 *   1. First-time enablement: brand row has `chat_enabled !== true` →
 *      flip it on and seed canonical persona name + welcome message.
 *   2. Legacy "Cherry" → "CherryAssist" rename: brand row has the
 *      original "Cherry" persona name → re-align persona/welcome to
 *      the canonical values. This is the no-SQL-access path for
 *      propagating the rename to existing prod rows on next deploy.
 *
 * Once a row is enabled and has a non-legacy persona name, this
 * function will NEVER touch it again. That preserves any future admin
 * or product customization (different persona name, different welcome
 * copy, manual chat_enabled toggles).
 *
 * Lookup order:
 *   1. brand by slug `cherryworks-pro` (the canonical seed slug).
 *   2. fallback: any brand whose org slug is `cwpro-prod` or whose org
 *      name matches /cherryworks pro/i (handles dev seeds + legacy
 *      orgs whose brand was created with a different slug).
 *
 * Errors are caught and logged. A migration failure here MUST NOT crash
 * the server — the chatbot is a marketing surface, not a critical path.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, orgs } from "@shared/schema";

const CHERRY_PERSONA_NAME = "CherryAssist";
const LEGACY_PERSONA_NAME = "Cherry";
const CHERRY_WELCOME =
  "Hi! I'm CherryAssist, the CherryWorks Pro assistant. Ask me anything about features, pricing, or migrating from another tool — and if you'd like a personal walkthrough, share your email and our team will reach out.";

const PRIMARY_BRAND_SLUG = "cherryworks-pro";

export async function enableCherryPersonaOnCherryWorksProBrand(): Promise<void> {
  try {
    // First try the canonical brand slug.
    const [byBrandSlug] = await db
      .select({
        id: brands.id,
        chatEnabled: brands.chatEnabled,
        chatPersonaName: brands.chatPersonaName,
        chatWelcomeMessage: brands.chatWelcomeMessage,
      })
      .from(brands)
      .where(eq(brands.slug, PRIMARY_BRAND_SLUG))
      .limit(1);

    let target = byBrandSlug;

    // Fallback: locate via org slug or name (covers dev seeds where the
    // brand may have been created with a different slug than `cherryworks-pro`).
    if (!target) {
      const [byOrg] = await db
        .select({
          id: brands.id,
          chatEnabled: brands.chatEnabled,
          chatPersonaName: brands.chatPersonaName,
          chatWelcomeMessage: brands.chatWelcomeMessage,
        })
        .from(brands)
        .innerJoin(orgs, eq(orgs.id, brands.orgId))
        .where(
          and(
            eq(brands.active, true),
            sql`(${orgs.slug} = 'cwpro-prod' OR lower(${orgs.name}) LIKE '%cherryworks pro%')`,
          ),
        )
        .limit(1);
      target = byOrg;
    }

    if (!target) {
      console.log(
        "[mchat1] No CherryWorks Pro brand found yet — skipping CherryAssist persona enablement (will retry on next boot).",
      );
      return;
    }

    // Narrow trigger conditions — fire ONLY for first-time enablement
    // or for the legacy "Cherry" → "CherryAssist" rename. Any other
    // existing customization is preserved on subsequent boots.
    const needsFirstTimeEnable = target.chatEnabled !== true;
    const needsLegacyRename =
      target.chatEnabled === true &&
      target.chatPersonaName === LEGACY_PERSONA_NAME;

    if (!needsFirstTimeEnable && !needsLegacyRename) {
      console.log(
        `[mchat1] CherryAssist persona already configured (persona='${target.chatPersonaName ?? "<null>"}'), skipping`,
      );
      return;
    }

    await db
      .update(brands)
      .set({
        chatEnabled: true,
        chatPersonaName: CHERRY_PERSONA_NAME,
        chatWelcomeMessage: CHERRY_WELCOME,
        // Leave chat_system_prompt NULL → falls back to the curated
        // server/marketing/chat-knowledge/cherryworkspro.md file.
        updatedAt: new Date(),
      })
      .where(eq(brands.id, target.id));

    const action = needsFirstTimeEnable
      ? "enabled"
      : "renamed from legacy 'Cherry'";
    console.log(
      `[mchat1] CherryAssist persona ${action} on brand ${target.id} (slug=${PRIMARY_BRAND_SLUG} or fallback) — persona='${CHERRY_PERSONA_NAME}'`,
    );
  } catch (err) {
    // Never crash the server on a marketing data migration failure.
    console.error(
      `[mchat1] CherryAssist persona enablement failed (non-fatal): ${(err as Error).message}`,
    );
  }
}
