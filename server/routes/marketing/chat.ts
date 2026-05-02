/**
 * Sprint M-Chat-1 — Marketing chatbot HTTP routes.
 *   POST /api/marketing/chat               — main turn endpoint
 *   GET  /api/marketing/brand-info?slug=… — embed-script bootstrap
 *   GET  /embed/chat.js                    — universal embed script
 * Stealth-404 on every gate (env, brand, chat_enabled, entitlement, throw).
 * HR4: lead capture writes only to `marketing_prospects`.
 */
import type { Express, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { storage } from "../../storage";
import { isMarketingOsEnabled } from "../../lib/featureFlags";
import { EntitlementService } from "../../services/entitlements";
import {
  chatComplete,
  type ChatMessage,
  BothProvidersFailedError,
} from "../../lib/llm-providers";
import { getKnowledgeForBrand } from "../../marketing/chat-knowledge";

// Anchor to the project root via process.cwd(). We deliberately avoid
// `fileURLToPath(import.meta.url)` here — esbuild compiles
// `import.meta.url` to `undefined` when bundling to CJS for the
// `dist/index.cjs` deploy artifact, which then crashes the process at
// module load. process.cwd() is the workspace root in both dev
// (`tsx server/index.ts`) and the Replit deploy runtime
// (`node dist/index.cjs`).
const EMBED_SCRIPT_PATH = path.resolve(
  process.cwd(),
  "public/embed/chat.js",
);

// Per-conversation token cap. Refuse new turns when current total + the
// projected next turn would exceed this.
const PER_CONVERSATION_TOKEN_CAP = 10_000;
// Conservative reservation for the next turn (input estimate + output budget).
const NEXT_TURN_TOKEN_BUDGET = 800;

const MAX_TRANSCRIPT_TURNS = 40;

const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const NOT_FOUND = { message: "Not found" } as const;

function stealth404(res: Response): Response {
  return res.status(404).json(NOT_FOUND);
}

// Per-IP rate limit. 429 responses must include CORS headers so cross-
// origin embeds can read the status and surface "try again in a minute".
function buildChatLimiter() {
  const envMax = Number(process.env.MARKETING_CHAT_RATE_LIMIT_MAX);
  const isTestEnv = process.env.NODE_ENV === "test";
  const max = Number.isFinite(envMax) && envMax > 0
    ? envMax
    : isTestEnv ? 1000 : 10;
  return rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) => {
      applyCors(res);
      res.status(429).json({ message: "Too many requests" });
    },
  });
}

const chatBody = z.object({
  brandSlug: z.string().min(1).max(100),
  sessionToken: z.string().min(36).max(128),
  message: z.string().min(1).max(2000),
});

const brandInfoQuery = z.object({
  slug: z.string().min(1).max(100),
});

interface ResolvedBrand {
  id: string;
  orgId: string;
  primaryColor: string | null;
  chatEnabled: boolean | null;
  chatPersonaName: string | null;
  chatWelcomeMessage: string | null;
  chatSystemPrompt: string | null;
}

/**
 * Custom stealth-404 gate. Resolves brand → org → entitlement check,
 * returning the brand row when the gate passes or `null` (and writing a
 * 404 to res) when any gate fails. The shared helper keeps the four
 * stealth-404 conditions in one place so they cannot drift.
 */
async function requireMarketingOsForBrand(
  brandSlug: string,
  res: Response,
): Promise<ResolvedBrand | null> {
  // Gate 1: env flag.
  if (!isMarketingOsEnabled()) {
    stealth404(res);
    return null;
  }

  // Gate 2/3/4 in one pass with try/catch. ANY error is a stealth 404.
  try {
    const brand = await storage.getBrandBySlugForChat(brandSlug);
    if (!brand) {
      stealth404(res);
      return null;
    }
    if (brand.chatEnabled !== true) {
      stealth404(res);
      return null;
    }
    const ent = await EntitlementService.hasFeature(brand.orgId, "marketing_os");
    if (!ent) {
      stealth404(res);
      return null;
    }
    return brand;
  } catch {
    // Lookup error — never leak. Stealth 404.
    stealth404(res);
    return null;
  }
}

function applyCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function registerMarketingChatRoutes(app: Express): void {
  // ───────────────────────────────────────────────────────────────────
  // CORS preflight for the embed.
  // ───────────────────────────────────────────────────────────────────
  app.options("/api/marketing/chat", (_req, res) => {
    applyCors(res);
    res.status(204).end();
  });
  app.options("/api/marketing/brand-info", (_req, res) => {
    applyCors(res);
    res.status(204).end();
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /embed/chat.js
  // Universal embed loader. Served from a dedicated route (not
  // express.static) so we own the headers explicitly:
  //   - Content-Type:  application/javascript; charset=utf-8
  //   - Cache-Control: public, max-age=3600 (one hour CDN-friendly)
  //   - CORS:          Access-Control-Allow-Origin: *  (any host site)
  //   - X-Content-Type-Options: nosniff
  //
  // Gated on the marketing_os env flag with a stealth-404 to match
  // the rest of the chat surface — when the feature is off, the embed
  // script must look exactly like a missing file.
  // ───────────────────────────────────────────────────────────────────
  app.get("/embed/chat.js", (_req: Request, res: Response) => {
    if (!isMarketingOsEnabled()) return stealth404(res);
    fs.readFile(EMBED_SCRIPT_PATH, "utf8", (err, body) => {
      if (err || !body) return stealth404(res);
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      // Spec: short-lived public cache + must-revalidate so brand admins
      // who toggle chat_enabled see the change within 5 minutes.
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(body);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /api/marketing/brand-info?slug=<brand>
  // Embed bootstrap. Same stealth-404 gates as the chat endpoint.
  // ───────────────────────────────────────────────────────────────────
  app.get("/api/marketing/brand-info", async (req: Request, res: Response) => {
    applyCors(res);
    const parsed = brandInfoQuery.safeParse(req.query);
    if (!parsed.success) return stealth404(res);

    const brand = await requireMarketingOsForBrand(parsed.data.slug, res);
    if (!brand) return; // 404 already sent

    return res.json({
      persona: brand.chatPersonaName ?? "Assistant",
      welcome:
        brand.chatWelcomeMessage ??
        "Hi! Ask me anything — I'm happy to help.",
      primaryColor: brand.primaryColor ?? "#cf3339",
      brandSlug: parsed.data.slug,
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /api/marketing/chat
  // The single-turn endpoint. body = { brandSlug, sessionToken, message }
  // ───────────────────────────────────────────────────────────────────
  const chatLimiter = buildChatLimiter();
  app.post(
    "/api/marketing/chat",
    chatLimiter,
    async (req: Request, res: Response) => {
      applyCors(res);

      const parsed = chatBody.safeParse(req.body);
      if (!parsed.success) {
        // Validation failure is also stealth 404 — never tell a probing
        // client which field they got wrong.
        return stealth404(res);
      }
      const { brandSlug, sessionToken, message } = parsed.data;

      const brand = await requireMarketingOsForBrand(brandSlug, res);
      if (!brand) return; // 404 already sent

      // Resolve or create the conversation row, then append the user turn.
      let conversation;
      try {
        conversation = await storage.getOrCreateChatConversation({
          orgId: brand.orgId,
          brandId: brand.id,
          sessionToken,
        });
      } catch {
        return stealth404(res);
      }

      try {
        await storage.appendChatMessage({
          conversationId: conversation.id,
          role: "user",
          content: message,
        });
      } catch {
        return stealth404(res);
      }

      // Email-in-message → soft prospect upsert + one-shot link.
      const emailMatch = message.match(EMAIL_RX);
      if (emailMatch) {
        try {
          const { id: prospectId } = await storage.softCreateProspectFromChat({
            orgId: brand.orgId,
            brandId: brand.id,
            email: emailMatch[0],
            conversationId: conversation.id,
            firstSeenMessage: message,
          });
          await storage.linkConversationToProspect(conversation.id, prospectId);
        } catch (err) {
          // Lead capture failure must never block the reply — log and
          // continue.
          console.error(
            `[chat] soft prospect upsert failed (non-fatal): ${(err as Error).message}`,
          );
        }
      }

      // Per-conversation token cap. Refuse the next turn if running
      // total + projected next-turn budget would exceed the cap. The
      // projection is current message length / 4 (rough token estimate)
      // plus a fixed output reservation, so we never make a provider
      // call that could materially blow past the cap.
      const totalTokensSoFar =
        (conversation.tokensInTotal ?? 0) + (conversation.tokensOutTotal ?? 0);
      const projectedNextTurn =
        Math.ceil(message.length / 4) + NEXT_TURN_TOKEN_BUDGET;

      if (totalTokensSoFar + projectedNextTurn > PER_CONVERSATION_TOKEN_CAP) {
        const cappedReply =
          "Thanks for chatting! For a deeper conversation, share your email and our team will follow up.";
        try {
          await storage.appendChatMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: cappedReply,
            model: "capped",
          });
        } catch {
          /* swallow — caller already has reply */
        }
        return res.json({
          reply: cappedReply,
          sessionToken,
          capped: true,
        });
      }

      // Build the prompt: system from override or curated knowledge file,
      // plus the last N transcript turns.
      const systemPrompt =
        brand.chatSystemPrompt && brand.chatSystemPrompt.trim().length > 0
          ? brand.chatSystemPrompt
          : getKnowledgeForBrand(brandSlug);

      let transcriptRows;
      try {
        transcriptRows = await storage.getConversationMessages(
          conversation.id,
          MAX_TRANSCRIPT_TURNS,
        );
      } catch {
        return stealth404(res);
      }
      const messages: ChatMessage[] = transcriptRows
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Provider call.
      let result;
      try {
        result = await chatComplete({
          system: systemPrompt,
          messages,
          maxTokens: 512,
        });
      } catch (err) {
        if (err instanceof BothProvidersFailedError) {
          // Neither provider reachable. Log the per-provider failure
          // reasons so this is debuggable from production logs (e.g.
          // missing API keys, upstream 5xx, network errors). The reply
          // body intentionally stays generic — visitors must never see
          // which provider answered or why it failed. Return 503 (NOT
          // a stealth 404): the gate already passed, this is a
          // transient upstream issue the bubble UI surfaces as "try
          // again".
          console.error(
            `[chat] both LLM providers failed — groq="${err.groqError}" anthropic="${err.anthropicError}"`,
          );
          return res
            .status(503)
            .json({ message: "Assistant temporarily unavailable" });
        }
        // Defensive branch — chatComplete only throws BothProvidersFailedError
        // by contract, but if a future change throws something else we still
        // want to know about it instead of silently 503'ing.
        console.error(
          `[chat] unexpected provider error: ${(err as Error).message}`,
        );
        return res
          .status(503)
          .json({ message: "Assistant temporarily unavailable" });
      }

      try {
        await storage.appendChatMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: result.text,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
      } catch (err) {
        console.error(
          `[chat] failed to persist assistant message (non-fatal): ${(err as Error).message}`,
        );
      }

      return res.json({
        reply: result.text,
        sessionToken,
        capped: false,
      });
    },
  );
}
