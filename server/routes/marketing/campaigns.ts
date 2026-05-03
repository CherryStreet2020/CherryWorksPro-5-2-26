/**
 * Sprint 2n — Marketing Campaigns + Sequences API.
 *
 * Campaigns are single-email drafts. Sequences chain multiple steps with
 * delays. Both surfaces are brand-scoped and gated behind the
 * `marketing_os` entitlement + ADMIN-or-MANAGER role, mirroring
 * segments/tags.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import { paramId } from "../../lib/req-params";
import { sendEmail, ResendSendError } from "../../lib/resend";
import {
  insertMarketingCampaignSchema,
  insertMarketingSequenceSchema,
  insertMarketingSequenceStepSchema,
  refineCampaignAudience,
} from "@shared/schema";

// Sprint 2p — In-memory per-campaign dispatch lock. Prevents two
// near-simultaneous "Send Now" clicks from broadcasting twice while the
// first call is still iterating recipients (the sent_at stamp only
// lands AFTER all sends complete). 60-second TTL is generous for
// audience sizes seen in this sprint.
const SEND_NOW_LOCK_TTL_MS = 60_000;
const sendNowLocks = new Map<string, number>();
function acquireSendNowLock(campaignId: string): boolean {
  const now = Date.now();
  const existing = sendNowLocks.get(campaignId);
  if (existing && existing > now) return false;
  sendNowLocks.set(campaignId, now + SEND_NOW_LOCK_TTL_MS);
  return true;
}
function releaseSendNowLock(campaignId: string): void {
  sendNowLocks.delete(campaignId);
}

function emailDomain(addr: string): string | null {
  const at = addr.lastIndexOf("@");
  if (at < 0 || at === addr.length - 1) return null;
  return addr.slice(at + 1).trim().toLowerCase();
}

const flagGate: RequestHandler = requireFeature("marketing_os");

// Task #294 — Above this recipient count, the campaign editor shows a
// soft warning so admins double-check before sending.
//
// Task #322 — Each org now sets its own threshold via
// `orgs.marketing_large_audience_threshold` (default 1000). This
// constant is the fallback when an org has no value persisted yet,
// matching the pre-Task-322 behavior.
const DEFAULT_LARGE_AUDIENCE_THRESHOLD = 1000;

async function resolveLargeAudienceThreshold(orgId: string): Promise<number> {
  const org = await storage.getOrg(orgId);
  const v = org?.marketingLargeAudienceThreshold;
  return typeof v === "number" && v > 0 ? v : DEFAULT_LARGE_AUDIENCE_THRESHOLD;
}

async function assertBrandOwned(brandId: string, orgId: string): Promise<void> {
  const brand = await storage.getBrand(brandId, orgId);
  if (!brand) throw new Error("Invalid brand for this organization");
}

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

const createCampaignBody = insertMarketingCampaignSchema
  .omit({ orgId: true })
  .superRefine(refineCampaignAudience);
const updateCampaignBody = insertMarketingCampaignSchema
  .omit({ orgId: true, brandId: true })
  .partial()
  .superRefine(refineCampaignAudience);

/**
 * Task #234 — Validate that a referenced segment belongs to the same org
 * + brand as the campaign. Throws a Zod-style Error so the route's catch
 * surfaces a 400 with a useful message.
 */
async function assertSegmentBelongsToBrand(
  orgId: string,
  brandId: string,
  segmentId: string,
): Promise<void> {
  const segment = await storage.getSegment(segmentId, orgId);
  if (!segment) throw new Error("Segment not found");
  if (segment.brandId !== brandId) {
    throw new Error("Segment belongs to a different brand than this campaign");
  }
}

const createSequenceBody = insertMarketingSequenceSchema.omit({ orgId: true });
const updateSequenceBody = createSequenceBody.partial().omit({ brandId: true });

const stepInputSchema = insertMarketingSequenceStepSchema
  .omit({ orgId: true, sequenceId: true, stepOrder: true })
  .extend({
    delayDays: z.number().int().min(0).max(365),
    subject: z.string().max(300),
    body: z.string().max(50_000),
  });
const replaceStepsBody = z.object({
  steps: z.array(stepInputSchema).max(50),
});

const enrollBody = z.object({
  prospectIds: z.array(z.string().uuid()).max(1000).optional(),
  segmentId: z.string().uuid().optional(),
}).refine(
  (b) => (b.prospectIds && b.prospectIds.length > 0) || !!b.segmentId,
  { message: "Provide prospectIds or segmentId" },
);

const updateEnrollmentBody = z.object({
  status: z.enum(["active", "paused", "completed", "removed"]),
});

export function registerMarketingCampaignRoutes(app: Express) {
  // ── Campaigns ────────────────────────────────────────────────────────
  app.get("/api/marketing/campaigns", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const brandId = z.string().uuid().parse(req.query.brandId);
      const rows = await storage.listCampaignsByBrand(req.session.orgId!, brandId);
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // Task #264 — Live recipient-count preview for the campaign editor.
  // Returns the number of contacts a campaign would email right now,
  // given a brand + audience selection. Mirrors the same predicates
  // used at scheduled-send time so admins see a faithful preview.
  //
  // Task #294 — Also returns a `threshold` and `isLarge` flag so the
  // editor can warn admins before they send to an unusually large
  // audience (e.g. picked the wrong segment). Threshold is a constant
  // for now; can be made org-configurable later.
  app.get(
    "/api/marketing/campaigns/audience-preview",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const querySchema = z
          .object({
            brandId: z.string().uuid(),
            audienceType: z.enum(["all", "segment"]),
            segmentId: z.string().uuid().optional(),
          })
          .superRefine((q, ctx) => {
            if (q.audienceType === "segment" && !q.segmentId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "segmentId is required when audienceType is 'segment'",
                path: ["segmentId"],
              });
            }
          });
        const parsed = querySchema.parse(req.query);
        await assertBrandOwned(parsed.brandId, orgId);
        let count: number;
        if (parsed.audienceType === "segment") {
          const segment = await storage.getSegment(parsed.segmentId!, orgId);
          if (!segment) return res.status(404).json({ message: "Segment not found" });
          if (segment.brandId !== parsed.brandId) {
            return res.status(400).json({
              message: "Segment belongs to a different brand than this campaign",
            });
          }
          const filter = (segment.filter ?? {}) as { tagIds?: string[]; search?: string };
          count = await storage.countProspectsByFilter(orgId, parsed.brandId, {
            tagIds: filter.tagIds ?? [],
            search: filter.search ?? "",
          });
        } else {
          count = await storage.countProspectsByFilter(orgId, parsed.brandId, {
            tagIds: [],
            search: "",
          });
        }
        const threshold = await resolveLargeAudienceThreshold(orgId);
        return res.json({
          count,
          threshold,
          isLarge: count > threshold,
        });
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.get("/api/marketing/campaigns/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const row = await storage.getCampaign(id, req.session.orgId!);
      if (!row) return res.status(404).json({ message: "Campaign not found" });
      return res.json(row);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // Per-campaign metrics tiles: success / failure / permanent_failure
  // counts plus distinct recipients. Powers the campaign-detail page.
  app.get(
    "/api/marketing/campaigns/:id/metrics",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const camp = await storage.getCampaign(id, orgId);
        if (!camp) return res.status(404).json({ message: "Campaign not found" });
        const metrics = await storage.getCampaignSendMetrics(orgId, id);
        return res.json({
          campaignId: id,
          sentAt: camp.sentAt,
          ...metrics,
        });
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.post("/api/marketing/campaigns", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const parsed = createCampaignBody.parse(req.body);
      const orgId = req.session.orgId!;
      await assertBrandOwned(parsed.brandId, orgId);
      if (parsed.audienceType === "segment" && parsed.audienceSegmentId) {
        await assertSegmentBelongsToBrand(orgId, parsed.brandId, parsed.audienceSegmentId);
      }
      const created = await storage.createCampaign({
        ...parsed,
        orgId,
        audienceSegmentId: parsed.audienceSegmentId ?? null,
      });
      return res.status(201).json(created);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.patch("/api/marketing/campaigns/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;
      const parsed = updateCampaignBody.parse(req.body);
      // Need the existing campaign to validate cross-field segment ownership
      // when only one of (audienceType, audienceSegmentId) is patched.
      const existing = await storage.getCampaign(id, orgId);
      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      const nextType = parsed.audienceType ?? existing.audienceType;
      const nextSegId = parsed.audienceSegmentId !== undefined
        ? parsed.audienceSegmentId
        : existing.audienceSegmentId;
      if (nextType === "segment") {
        if (!nextSegId) {
          return res.status(400).json({
            message: "audienceSegmentId is required when audienceType is 'segment'",
          });
        }
        await assertSegmentBelongsToBrand(orgId, existing.brandId, nextSegId);
      }
      const patch: typeof parsed = { ...parsed };
      if (nextType === "all") patch.audienceSegmentId = null;
      const updated = await storage.updateCampaign(id, orgId, patch);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      return res.json(updated);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.delete("/api/marketing/campaigns/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const ok = await storage.deleteCampaign(id, req.session.orgId!);
      if (!ok) return res.status(404).json({ message: "Campaign not found" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Sprint 2p — Immediate-dispatch "Send Now" ────────────────────────
  // One-shot synchronous broadcast via Resend. Resolves the audience
  // (all-brand or saved segment), iterates recipients sequentially,
  // writes a terminal email_send_attempts row per recipient, and stamps
  // campaigns.sent_at on success. No scheduler, no retry, no queueing —
  // intentionally minimal per Sprint 2p spec.
  app.post(
    "/api/marketing/campaigns/:id/send-now",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      const orgId = req.session.orgId!;
      const id = paramId(req);
      let lockHeld = false;
      try {
        const campaign = await storage.getCampaign(id, orgId);
        if (!campaign) return res.status(404).json({ message: "Campaign not found" });
        if (campaign.sentAt) {
          return res.status(409).json({ message: "Campaign has already been sent" });
        }

        const brand = await storage.getBrand(campaign.brandId, orgId);
        if (!brand) return res.status(404).json({ message: "Brand not found" });

        // Resolve effective sender. Campaign overrides win; otherwise
        // fall back to brand defaults so admins don't have to retype
        // them on every draft.
        const fromEmail = (campaign.fromEmail || brand.fromEmail || "").trim();
        const fromName = (campaign.fromName || brand.fromName || "").trim();
        const replyTo = (campaign.replyTo || brand.replyTo || "").trim();
        if (!fromEmail) {
          return res.status(400).json({
            message: "Campaign has no from-email and brand has no default sender",
          });
        }
        if (!campaign.subject || !campaign.subject.trim()) {
          return res.status(400).json({ message: "Campaign subject is required" });
        }

        // DRIFT: Spec calls for validating the from-email against
        // `brands.sending_domain`, but the brands table has only
        // `domain` + `fromEmail`. We validate against `brands.domain`
        // when set; if not set, we fall back to the domain of
        // `brands.fromEmail`. If neither is configured, we skip the
        // check rather than 400 every send.
        const fromDomain = emailDomain(fromEmail);
        if (!fromDomain) {
          return res.status(400).json({ message: "From-email is malformed" });
        }
        const expectedDomain =
          (brand.domain && brand.domain.trim().toLowerCase()) ||
          (brand.fromEmail ? emailDomain(brand.fromEmail) : null);
        if (expectedDomain && expectedDomain !== fromDomain) {
          return res.status(400).json({
            message: `From-email domain (${fromDomain}) does not match brand domain (${expectedDomain})`,
          });
        }

        // Acquire the in-memory dispatch lock BEFORE doing any sends.
        if (!acquireSendNowLock(id)) {
          return res.status(429).json({
            message: "This campaign is already being sent. Try again in a minute.",
          });
        }
        lockHeld = true;

        // Resolve audience. Mirrors /audience-preview semantics so the
        // count the planner saw matches what we actually mail. Paginate
        // through every page so we don't silently truncate to 500.
        const filterArg: { tagIds?: string[]; search?: string } = {};
        if (campaign.audienceType === "segment") {
          if (!campaign.audienceSegmentId) {
            return res.status(400).json({
              message: "Campaign audienceType is 'segment' but no segment is set",
            });
          }
          const segment = await storage.getSegment(campaign.audienceSegmentId, orgId);
          if (!segment) return res.status(400).json({ message: "Segment not found" });
          if (segment.brandId !== campaign.brandId) {
            return res.status(400).json({
              message: "Segment belongs to a different brand than this campaign",
            });
          }
          const segFilter = (segment.filter ?? {}) as { tagIds?: string[]; search?: string };
          filterArg.tagIds = segFilter.tagIds ?? [];
          filterArg.search = segFilter.search ?? "";
        }

        const recipients: Array<{ id: string; email: string }> = [];
        const PAGE = 500;
        for (let offset = 0; ; offset += PAGE) {
          const page = await storage.listProspectsByFilter(
            orgId,
            campaign.brandId,
            filterArg,
            { limit: PAGE, offset },
          );
          for (const r of page) {
            if (r.email && !r.unsubscribedAt && !r.bouncedAt) {
              recipients.push({ id: r.id, email: r.email });
            }
          }
          if (page.length < PAGE) break;
        }

        if (recipients.length === 0) {
          return res.status(422).json({ message: "No deliverable recipients in audience" });
        }

        const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
        const subject = campaign.subject;
        const html = campaign.body || "";

        let sentCount = 0;
        let failedCount = 0;
        for (const r of recipients) {
          try {
            const result = await sendEmail({
              from: fromHeader,
              to: r.email,
              subject,
              html,
              replyTo: replyTo || null,
            });
            await storage.recordCampaignSendAttempt({
              orgId,
              campaignId: id,
              prospectId: r.id,
              recipientEmail: r.email,
              status: "success",
              providerMessageId: result.id,
            });
            sentCount += 1;
          } catch (sendErr) {
            const code =
              sendErr instanceof ResendSendError ? sendErr.code : "send_error";
            const message =
              sendErr instanceof Error ? sendErr.message : String(sendErr);
            await storage.recordCampaignSendAttempt({
              orgId,
              campaignId: id,
              prospectId: r.id,
              recipientEmail: r.email,
              // DRIFT: email_send_attempts.status enum has no 'queued'
              // value, AND Sprint 2p ships no retry scheduler. We use
              // 'permanent_failure' so the existing campaign failures
              // dialog renders these as "Gave up" rather than the
              // misleading "Pending retry" copy reserved for 'failed'.
              status: "permanent_failure",
              errorCode: code,
              errorMessage: message.slice(0, 500),
            });
            failedCount += 1;
          }
        }

        const updated = await storage.markCampaignSent(id, orgId);
        return res.json({
          campaignId: id,
          sentCount,
          failedCount,
          sentAt: updated?.sentAt ?? null,
        });
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      } finally {
        if (lockHeld) releaseSendNowLock(id);
      }
    },
  );

  // ── Sequences ────────────────────────────────────────────────────────
  app.get("/api/marketing/sequences", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const brandId = z.string().uuid().parse(req.query.brandId);
      const rows = await storage.listSequencesByBrand(req.session.orgId!, brandId);
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.get("/api/marketing/sequences/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;
      const seq = await storage.getSequence(id, orgId);
      if (!seq) return res.status(404).json({ message: "Sequence not found" });
      const steps = await storage.listSequenceSteps(id, orgId);
      return res.json({ ...seq, steps });
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.post("/api/marketing/sequences", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const parsed = createSequenceBody.parse(req.body);
      const orgId = req.session.orgId!;
      await assertBrandOwned(parsed.brandId, orgId);
      const created = await storage.createSequence({ ...parsed, orgId });
      return res.status(201).json(created);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.patch("/api/marketing/sequences/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;
      const parsed = updateSequenceBody.parse(req.body);
      const updated = await storage.updateSequence(id, orgId, parsed);
      if (!updated) return res.status(404).json({ message: "Sequence not found" });
      return res.json(updated);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.delete("/api/marketing/sequences/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const ok = await storage.deleteSequence(id, req.session.orgId!);
      if (!ok) return res.status(404).json({ message: "Sequence not found" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // Replace all steps for a sequence (simple atomic editor save).
  app.put("/api/marketing/sequences/:id/steps", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const orgId = req.session.orgId!;
      const seq = await storage.getSequence(id, orgId);
      if (!seq) return res.status(404).json({ message: "Sequence not found" });
      const parsed = replaceStepsBody.parse(req.body);
      const rows = await storage.replaceSequenceSteps(id, orgId, parsed.steps);
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Task #208: Sequence enrollments ────────────────────────────────
  app.get(
    "/api/marketing/sequences/:id/enrollments",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const seq = await storage.getSequence(id, orgId);
        if (!seq) return res.status(404).json({ message: "Sequence not found" });
        const rows = await storage.listSequenceEnrollments(id, orgId);
        return res.json(rows);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  // Task #293 — Live recipient-count preview for the sequence
  // enrollment dialog. Mirrors the campaigns /audience-preview pattern
  // and adds an `alreadyEnrolled` count so the planner can see how many
  // contacts will be newly enrolled (segment enrollment is idempotent).
  app.get(
    "/api/marketing/sequences/:id/enrollment-preview",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const seq = await storage.getSequence(id, orgId);
        if (!seq) return res.status(404).json({ message: "Sequence not found" });
        const querySchema = z.object({ segmentId: z.string().uuid() });
        const parsed = querySchema.parse(req.query);
        const seg = await storage.getSegment(parsed.segmentId, orgId);
        if (!seg) return res.status(404).json({ message: "Segment not found" });
        if (seg.brandId !== seq.brandId) {
          return res.status(400).json({
            message: "Segment belongs to a different brand than this sequence",
          });
        }
        const preview = await storage.previewSegmentSequenceEnrollment(
          orgId,
          id,
          parsed.segmentId,
        );
        return res.json(preview);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.post(
    "/api/marketing/sequences/:id/enrollments",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const seq = await storage.getSequence(id, orgId);
        if (!seq) return res.status(404).json({ message: "Sequence not found" });
        const parsed = enrollBody.parse(req.body);
        let result: { inserted: number; skipped: number };
        if (parsed.segmentId) {
          const seg = await storage.getSegment(parsed.segmentId, orgId);
          if (!seg) return res.status(404).json({ message: "Segment not found" });
          if (seg.brandId !== seq.brandId) {
            return res.status(400).json({ message: "Segment belongs to a different brand than this sequence" });
          }
          result = await storage.enrollSegmentInSequence(orgId, id, parsed.segmentId);
        } else if (parsed.prospectIds && parsed.prospectIds.length > 0) {
          // Sprint 2o.0 — enrollments reference marketing_prospects.
          result = await storage.enrollProspectsInSequence(
            orgId,
            id,
            seq.brandId,
            parsed.prospectIds,
          );
        } else {
          return res.status(400).json({ message: "Provide prospectIds or segmentId" });
        }
        return res.status(201).json(result);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.patch(
    "/api/marketing/sequences/:id/enrollments/:enrollmentId",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const sequenceId = paramId(req);
        const enrollmentId = z.string().uuid().parse(req.params.enrollmentId);
        const parsed = updateEnrollmentBody.parse(req.body);
        const updated = await storage.updateSequenceEnrollmentStatus(
          enrollmentId,
          orgId,
          sequenceId,
          parsed.status,
        );
        if (!updated) return res.status(404).json({ message: "Enrollment not found" });
        return res.json(updated);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  // ── Task #235: Per-recipient send failures ─────────────────────────
  app.get(
    "/api/marketing/campaigns/:id/failures",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const campaign = await storage.getCampaign(id, orgId);
        if (!campaign) return res.status(404).json({ message: "Campaign not found" });
        const rows = await storage.listCampaignFailedRecipients(orgId, id);
        return res.json(rows);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.get(
    "/api/marketing/sequences/:id/failures",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const id = paramId(req);
        const orgId = req.session.orgId!;
        const seq = await storage.getSequence(id, orgId);
        if (!seq) return res.status(404).json({ message: "Sequence not found" });
        let stepIndex: number | undefined;
        const raw = req.query.stepIndex;
        if (typeof raw === "string" && raw.length > 0) {
          if (!/^\d+$/.test(raw)) {
            return res.status(400).json({ message: "Invalid stepIndex" });
          }
          stepIndex = Number.parseInt(raw, 10);
        }
        const rows = await storage.listSequenceFailedRecipients(orgId, id, stepIndex);
        return res.json(rows);
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );

  app.delete(
    "/api/marketing/sequences/:id/enrollments/:enrollmentId",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const sequenceId = paramId(req);
        const enrollmentId = z.string().uuid().parse(req.params.enrollmentId);
        const ok = await storage.deleteSequenceEnrollment(enrollmentId, orgId, sequenceId);
        if (!ok) return res.status(404).json({ message: "Enrollment not found" });
        return res.json({ ok: true });
      } catch (err: unknown) {
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );
}
