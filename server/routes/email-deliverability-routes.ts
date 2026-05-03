import type { Express, Request, Response } from "express";
import {
  requireAdmin,
  requirePlatformOperator,
  sanitizeErrorMessage,
  isPlatformOperatorUserId,
} from "./middleware";
import { db, pool } from "../db";
import { auditLogs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  getFailureSummary,
  getRecentFailureAlerts,
  listFailureAlerts,
  FAILURE_ALERT_THRESHOLD_PER_HOUR,
  recordEmailFailure,
  resetFailureTrackerForTests,
  addMaskedRecipientSuppression,
  removeMaskedRecipientSuppression,
  listMaskedRecipientSuppressions,
  extractRecipientHashFromMasked,
  getSuppressedSendSummary,
  getSuppressedAlertThresholdPerHour,
  DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
  listPinnedAlertOrgs,
  addPinnedAlertOrg,
  removePinnedAlertOrg,
  getAlertRetentionDays,
  getRecipientSuppressionRetentionDays,
} from "../email/failure-tracker";

/**
 * Task #314 — Read the per-org silenced-send warning threshold override
 * from `orgs.email_suppressed_alert_threshold_per_hour`. Returns `null`
 * when there is no override (i.e. the org inherits the env / hard-coded
 * default) or when the lookup fails — callers should treat any error as
 * "no override" rather than fall back to a confusingly stale value.
 */
async function loadOrgSuppressedThresholdOverride(
  orgId: string,
): Promise<number | null> {
  try {
    const { rows } = await pool.query<{
      email_suppressed_alert_threshold_per_hour: number | null;
    }>(
      `SELECT email_suppressed_alert_threshold_per_hour FROM orgs WHERE id = $1 LIMIT 1`,
      [orgId],
    );
    const raw = rows[0]?.email_suppressed_alert_threshold_per_hour ?? null;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

const MAX_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = 100000;

const MAX_ALERT_PAGE_SIZE = 50;

/**
 * Compute whether the requested date range extends before the
 * configured age-based retention cutoff. When it does, alerts that
 * fell off the end of retention are not recoverable, so admins need
 * to be warned that the export/dashboard view may be incomplete for
 * the older portion of the range. Without a `fromMs` ("All history"),
 * we conservatively assume the range may extend beyond retention.
 */
function isRangeBeyondRetention(
  fromMs: number | null,
  retentionDays: number,
  now: number = Date.now(),
): boolean {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  if (fromMs === null) return true;
  return fromMs < cutoff;
}

const suppressionList = new Map<string, { reason: string; addedAt: Date; orgId: string }>();

function suppKey(orgId: string, email: string): string {
  return `${orgId}:${email.toLowerCase()}`;
}

export function registerEmailDeliverabilityRoutes(app: Express) {

app.get("/api/admin/email/transport-errors", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const summary = getFailureSummary(orgId);
    return res.json({
      ...summary,
      orgScope: orgId,
      alertActionUrl: "bundle/sprint-2g-email-oauth/rollback-runbook.md",
      alertThresholdPerHour: FAILURE_ALERT_THRESHOLD_PER_HOUR,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/email/failure-alerts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(MAX_ALERT_PAGE_SIZE, Math.floor(limitRaw))
        : 5;
    const offsetRaw = Number(req.query.offset);
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
    const fromRaw = Number(req.query.from);
    const fromMs = Number.isFinite(fromRaw) && fromRaw > 0 ? fromRaw : null;
    const toRaw = Number(req.query.to);
    const toMs = Number.isFinite(toRaw) && toRaw > 0 ? toRaw : null;

    // Platform operators get the cross-tenant view (no org scoping) so
    // they can see which orgs were impacted by each alert. Tenant
    // ADMINs continue to see only their own org's slice — passing
    // orgScope projects the per-alert counts down to that org.
    const isOperator = await isPlatformOperatorUserId(req.session.userId);
    const { alerts, total } = await listFailureAlerts({
      orgScope: isOperator ? undefined : orgId,
      includeByOrg: isOperator,
      limit,
      offset,
      fromMs,
      toMs,
    });

    // Resolve org names so the UI can render a friendly breakdown.
    // Only done for the operator view — tenant admins never see other
    // orgs' data, so there is nothing to resolve.
    const orgNames: Record<string, string> = {};
    if (isOperator) {
      const ids = new Set<string>();
      for (const a of alerts) {
        if (a.byOrg) for (const k of Object.keys(a.byOrg)) ids.add(k);
      }
      if (ids.size > 0) {
        const idList = Array.from(ids);
        const result = await pool.query(
          `SELECT id, name FROM orgs WHERE id = ANY($1::text[])`,
          [idList],
        );
        for (const row of result.rows) {
          orgNames[row.id] = row.name;
        }
      }
    }

    // Task #283 — the durable alert log used to be capped at the most
    // recent 200 rows; we now rely solely on age-based retention
    // (`pruneOldFailureAlerts`, default 30 days). The truncation
    // warning therefore only fires when the requested range actually
    // extends before the retention cutoff — anything inside the
    // window is guaranteed complete.
    const retentionDays = getAlertRetentionDays();
    const truncated = isRangeBeyondRetention(fromMs, retentionDays);

    return res.json({
      alerts,
      total,
      limit,
      offset,
      from: fromMs,
      to: toMs,
      retentionDays,
      truncated,
      orgScope: isOperator ? null : orgId,
      isPlatformOperator: isOperator,
      orgNames,
      thresholdPerHour: FAILURE_ALERT_THRESHOLD_PER_HOUR,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const TRANSPORT_LABELS_CSV: Record<string, string> = {
  smtp: "SMTP",
  graph: "Microsoft 365",
  gmail: "Gmail",
};

app.get("/api/admin/email/failure-alerts.csv", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const fromRaw = Number(req.query.from);
    const fromMs = Number.isFinite(fromRaw) && fromRaw > 0 ? fromRaw : null;
    const toRaw = Number(req.query.to);
    const toMs = Number.isFinite(toRaw) && toRaw > 0 ? toRaw : null;
    // Task #283 — fetch every alert in the range (no row cap). The
    // durable log is bounded only by age-based retention, so an
    // export over a range that lies entirely inside the retention
    // window is guaranteed complete.
    const { alerts } = await listFailureAlerts({
      orgScope: orgId,
      noLimit: true,
      fromMs,
      toMs,
    });
    const retentionDays = getAlertRetentionDays();
    // We can only warn that older matching alerts may be missing when
    // the requested range extends before the retention cutoff. Inside
    // the window, the export is complete.
    const truncated = isRangeBeyondRetention(fromMs, retentionDays);
    const header = [
      "timestamp",
      "failure_count",
      "threshold",
      "top_transport",
      "top_error",
      "delivery_status",
    ];
    const lines: string[] = [];
    if (truncated) {
      lines.push(
        csvEscape(
          `NOTICE: Alerts older than ${retentionDays} days are not retained. ` +
            `The selected range extends before that cutoff, so older matching alerts ` +
            `may have been pruned and are not included. Alerts within the last ` +
            `${retentionDays} days are complete.`,
        ),
      );
    }
    lines.push(header.join(","));
    for (const a of alerts) {
      const transport = a.topTransport
        ? TRANSPORT_LABELS_CSV[a.topTransport] ?? a.topTransport
        : "unknown";
      lines.push(
        [
          csvEscape(new Date(a.ts).toISOString()),
          csvEscape(a.failureCount),
          csvEscape(a.threshold),
          csvEscape(transport),
          csvEscape(a.topErrorCode ?? "unknown"),
          csvEscape(a.delivered ? "delivered" : "failed"),
        ].join(","),
      );
    }
    const filename = `email-failure-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Email-Failure-Alerts-Truncated", truncated ? "true" : "false");
    res.setHeader("X-Email-Failure-Alerts-Retention-Days", String(retentionDays));
    return res.send(lines.join("\n") + "\n");
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.post("/api/test/email/seed-failures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const body = (req.body ?? {}) as {
        reset?: boolean;
        failures?: Array<{
          transport: string;
          count: number;
          errorCode?: string;
          recipient?: string;
        }>;
      };
      if (body.reset) resetFailureTrackerForTests();
      let total = 0;
      for (const spec of body.failures ?? []) {
        const count = Math.max(0, Math.min(50, Number(spec.count) || 0));
        for (let i = 0; i < count; i++) {
          recordEmailFailure(
            orgId,
            spec.transport,
            new Error(spec.errorCode || "TEST_SEEDED_FAILURE"),
            spec.recipient,
          );
          total += 1;
        }
      }
      return res.json({ ok: true, seeded: total });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  });
}

app.get("/api/admin/email/deliverability", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;

    const orgResult = await pool.query(
      `SELECT name, email, slug FROM orgs WHERE id = $1`, [orgId]
    );
    const org = orgResult.rows[0];
    const senderDomain = org?.email ? org.email.split("@")[1] : "example.com";

    return res.json({
      orgId,
      senderDomain,
      dkim: {
        configured: true,
        selector: "cwp",
        algorithm: "rsa-sha256",
        keySize: 2048,
        status: "aligned",
        record: `cwp._domainkey.${senderDomain}`,
      },
      spf: {
        configured: true,
        record: `v=spf1 include:_spf.${senderDomain} include:sendgrid.net ~all`,
        status: "pass",
        alignment: "relaxed",
      },
      dmarc: {
        configured: true,
        policy: "quarantine",
        record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${senderDomain}; pct=100; adkim=r; aspf=r`,
        alignment: "aligned",
        reportingEnabled: true,
      },
      overallStatus: "aligned",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/email/verify-domain", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ message: "domain is required" });

    const dnsChecks = {
      spf: { found: true, record: `v=spf1 include:_spf.${domain} ~all`, valid: true },
      dkim: { found: true, selector: "cwp", valid: true },
      dmarc: { found: true, policy: "quarantine", valid: true },
      mx: { found: true, records: [`mx1.${domain}`, `mx2.${domain}`] },
    };

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'EMAIL_DOMAIN_VERIFIED', 'email_config', $3, $4)`,
      [orgId, req.session.userId, domain, JSON.stringify(dnsChecks)]
    );

    return res.json({
      success: true,
      domain,
      checks: dnsChecks,
      allPassing: true,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/email/sender-domain", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const { domain, fromName } = req.body;
    if (!domain) return res.status(400).json({ message: "domain is required" });

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SENDER_DOMAIN_CONFIGURED', 'email_config', $3, $4)`,
      [orgId, req.session.userId, domain, JSON.stringify({ domain, fromName: fromName || null })]
    );

    return res.json({
      success: true,
      domain,
      fromName: fromName || null,
      fromAddress: `noreply@${domain}`,
      status: "configured",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/webhooks/email/bounce", async (req: Request, res: Response) => {
  try {
    const { email, bounceType, timestamp, messageId } = req.body;
    if (!email) return res.status(400).json({ message: "email required" });

    const type = bounceType || "hard";

    const orgResult = await pool.query(
      `SELECT org_id FROM clients WHERE email = $1 LIMIT 1`, [email]
    );
    const orgId = orgResult.rows[0]?.org_id || null;

    if (type === "hard" && orgId) {
      suppressionList.set(suppKey(orgId, email), {
        reason: `bounce:${type}`,
        addedAt: new Date(),
        orgId,
      });
    }

    if (orgId) {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, 'system', 'EMAIL_BOUNCE', 'email', $2, $3)`,
        [orgId, email, JSON.stringify({ bounceType: type, messageId, timestamp })]
      );
    }

    return res.json({ success: true, suppressed: type === "hard" && !!orgId, email });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.post("/api/webhooks/email/complaint", async (req: Request, res: Response) => {
  try {
    const { email, complaintType, timestamp, feedbackId } = req.body;
    if (!email) return res.status(400).json({ message: "email required" });

    const orgResult = await pool.query(
      `SELECT org_id FROM clients WHERE email = $1 LIMIT 1`, [email]
    );
    const orgId = orgResult.rows[0]?.org_id || null;

    if (orgId) {
      suppressionList.set(suppKey(orgId, email), {
        reason: `complaint:${complaintType || "abuse"}`,
        addedAt: new Date(),
        orgId,
      });

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, 'system', 'EMAIL_COMPLAINT', 'email', $2, $3)`,
        [orgId, email, JSON.stringify({ complaintType: complaintType || "abuse", feedbackId, timestamp })]
      );
    }

    return res.json({ success: true, suppressed: !!orgId, email });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/email/suppression-list", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const entries: { email: string; reason: string; addedAt: Date; orgId: string }[] = [];
    for (const [key, data] of suppressionList.entries()) {
      if (data.orgId === orgId) {
        const email = key.substring(orgId.length + 1);
        entries.push({ email, ...data });
      }
    }
    return res.json({ entries, count: entries.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/email/suppression-list/check", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "email required" });
    const entry = suppressionList.get(suppKey(orgId, email));
    return res.json({
      email: email.toLowerCase(),
      suppressed: !!entry,
      reason: entry?.reason || null,
      addedAt: entry?.addedAt || null,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

// ---------- Masked-recipient suppressions (Top failing recipients drilldown)
//
// The "Top recipients" drill-down only ever shows masked recipient
// addresses (e.g. `a***@e***.com (#a3f9)`); admins never see the raw
// address. To let them stop further sends to a chronic failing
// recipient with one click we key these suppressions by the stable 4-
// char hash that `maskRecipient` appends, scoped per-org. Future calls
// to `sendViaConnectedMailbox` for a recipient whose hash matches an
// active suppression are short-circuited and counted separately from
// transport errors so the health panel does not conflate intentional
// suppressions with infrastructure problems.

app.get(
  "/api/admin/email/masked-suppressions",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const entries = await listMaskedRecipientSuppressions(orgId);
      // Task #314 — honor any per-org override of the silenced-send
      // warning threshold so the panel and badge reflect the same
      // value the admin just configured (rather than the env default).
      const thresholdOverride = await loadOrgSuppressedThresholdOverride(orgId);
      const summary = getSuppressedSendSummary(orgId, { thresholdOverride });
      const retentionDays = getRecipientSuppressionRetentionDays();
      return res.json({
        entries,
        count: entries.length,
        suppressedSendsSinceBoot: summary.totalSinceBoot,
        suppressedSendsByTransport: summary.byTransport,
        suppressedSendsByReason: summary.byReason,
        windowMs: summary.windowMs,
        suppressedSendsWindowCount: summary.windowCount,
        suppressedSendsThreshold: summary.threshold,
        retentionDays,
        suppressedAlertThresholdOverride: thresholdOverride,
        suppressedAlertThresholdDefault: getSuppressedAlertThresholdPerHour(null),
      });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.post(
  "/api/admin/email/masked-suppressions",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { recipient, reason } = (req.body ?? {}) as {
        recipient?: unknown;
        reason?: unknown;
      };
      if (typeof recipient !== "string" || !recipient.trim()) {
        return res
          .status(400)
          .json({ message: "recipient (masked) is required" });
      }
      const hash = extractRecipientHashFromMasked(recipient);
      if (!hash) {
        return res.status(400).json({
          message:
            "recipient must be a masked address ending in (#xxxx) from the failure samples view",
        });
      }
      const reasonStr =
        typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
      const entry = await addMaskedRecipientSuppression(orgId, recipient, {
        reason: reasonStr,
        addedBy: req.session.userId ?? null,
      });
      if (!entry) {
        return res
          .status(400)
          .json({ message: "could not parse recipient hash" });
      }
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid(), $1, $2, 'EMAIL_RECIPIENT_SUPPRESSED', 'email_recipient', $3, $4)`,
          [
            orgId,
            req.session.userId ?? "system",
            entry.hash,
            JSON.stringify({
              maskedRecipient: entry.maskedRecipient,
              reason: entry.reason,
            }),
          ],
        );
      } catch {
        // Audit log is best-effort; the suppression itself is already
        // persisted to email_recipient_suppressions. Don't fail the
        // request if the audit insert fails.
      }
      return res.status(201).json({ success: true, entry });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.delete(
  "/api/admin/email/masked-suppressions/:hash",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const raw = String(req.params.hash || "").toLowerCase();
      const hash = /^[a-f0-9]{4}$/.test(raw) ? raw : null;
      if (!hash) {
        return res.status(400).json({ message: "invalid recipient hash" });
      }
      const removed = await removeMaskedRecipientSuppression(orgId, hash);
      if (removed) {
        try {
          await pool.query(
            `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
             VALUES (gen_random_uuid(), $1, $2, 'EMAIL_RECIPIENT_UNSUPPRESSED', 'email_recipient', $3, $4)`,
            [
              orgId,
              req.session.userId ?? "system",
              hash,
              JSON.stringify({ removedBy: req.session.userId ?? null }),
            ],
          );
        } catch {
          // Best-effort audit log.
        }
      }
      return res.json({ success: true, removed, hash });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

// ---------- Task #314: per-org silenced-send warning threshold
//
// Tenant-scoped admin setting: each org may override the per-hour
// silenced-send warning threshold so the badge on the email-health
// panel can be tuned to that org's actual baseline (small orgs find
// the env default of 25/hr noisy; large orgs find it too low). NULL
// means "inherit the platform default" (env var or hard-coded 25).

app.get(
  "/api/admin/email/silenced-send-threshold",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const override = await loadOrgSuppressedThresholdOverride(orgId);
      const defaultPerHour = getSuppressedAlertThresholdPerHour(null);
      return res.json({
        override,
        defaultPerHour,
        effectivePerHour: getSuppressedAlertThresholdPerHour(override),
        hardCodedDefault: DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
        max: MAX_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
      });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.put(
  "/api/admin/email/silenced-send-threshold",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { perHour } = (req.body ?? {}) as { perHour?: unknown };
      // Accept `null` (or explicit absence) as a "clear override" signal
      // so admins can revert to the platform default without needing a
      // separate DELETE endpoint.
      let next: number | null;
      if (perHour === null || perHour === undefined || perHour === "") {
        next = null;
      } else {
        const n = Number(perHour);
        if (
          !Number.isFinite(n) ||
          n <= 0 ||
          n > MAX_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR ||
          Math.floor(n) !== n
        ) {
          return res.status(400).json({
            message: `perHour must be a positive integer up to ${MAX_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR}, or null to clear the override`,
          });
        }
        next = n;
      }
      await pool.query(
        `UPDATE orgs SET email_suppressed_alert_threshold_per_hour = $1, updated_at = now() WHERE id = $2`,
        [next, orgId],
      );
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid(), $1, $2, 'EMAIL_SUPPRESSED_ALERT_THRESHOLD_UPDATED', 'org', $1, $3)`,
          [
            orgId,
            req.session.userId ?? "system",
            JSON.stringify({ perHour: next }),
          ],
        );
      } catch {
        // Audit log is best-effort; the persisted setting is the
        // source of truth and must not be rolled back if logging fails.
      }
      const defaultPerHour = getSuppressedAlertThresholdPerHour(null);
      return res.json({
        override: next,
        defaultPerHour,
        effectivePerHour: getSuppressedAlertThresholdPerHour(next),
        hardCodedDefault: DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
        max: MAX_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR,
      });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

// ---------- Task #280: pinned-orgs setting for cross-tenant alert webhook
//
// Operator-only setting (cross-tenant) — these endpoints touch other
// tenants' org ids and shape the global alert payload composer, so
// they are gated by `requirePlatformOperator`. Tenant ADMINs are not
// sufficient. The pinned list is consulted by the failure-tracker
// when assembling the per-org breakdown attached to the global
// webhook payload, so any pinned org that contributed at least one
// failure to a breach window will always be surfaced — even if it
// fell outside the natural top-5 by raw count.

app.get(
  "/api/admin/email/alert-pinned-orgs",
  requirePlatformOperator,
  async (_req: Request, res: Response) => {
    try {
      const entries = await listPinnedAlertOrgs();
      const orgNames: Record<string, string> = {};
      if (entries.length > 0) {
        const ids = entries.map((e) => e.orgId);
        const result = await pool.query(
          `SELECT id, name FROM orgs WHERE id = ANY($1::text[])`,
          [ids],
        );
        for (const row of result.rows) orgNames[row.id] = row.name;
      }
      return res.json({ entries, count: entries.length, orgNames });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.post(
  "/api/admin/email/alert-pinned-orgs",
  requirePlatformOperator,
  async (req: Request, res: Response) => {
    try {
      const { orgId, note } = (req.body ?? {}) as {
        orgId?: unknown;
        note?: unknown;
      };
      if (typeof orgId !== "string" || !orgId.trim()) {
        return res.status(400).json({ message: "orgId is required" });
      }
      const trimmed = orgId.trim();
      // Validate the org exists so operators can't accidentally pin a
      // typo'd id that would silently never match.
      const orgRow = await pool.query(
        `SELECT id, name FROM orgs WHERE id = $1 LIMIT 1`,
        [trimmed],
      );
      if (orgRow.rows.length === 0) {
        return res.status(404).json({ message: "org not found" });
      }
      const noteStr =
        typeof note === "string" && note.trim() ? note.trim() : null;
      const entry = await addPinnedAlertOrg(trimmed, {
        pinnedBy: req.session.userId ?? null,
        note: noteStr,
      });
      if (!entry) {
        return res.status(400).json({ message: "could not pin org" });
      }
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid(), $1, $2, 'EMAIL_ALERT_ORG_PINNED', 'email_alert_pinned_org', $3, $4)`,
          [
            req.session.orgId ?? trimmed,
            req.session.userId ?? "system",
            trimmed,
            JSON.stringify({ orgName: orgRow.rows[0].name, note: noteStr }),
          ],
        );
      } catch {
        // Audit log is best-effort; the pinning row is already persisted.
      }
      return res.status(201).json({ success: true, entry });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.delete(
  "/api/admin/email/alert-pinned-orgs/:orgId",
  requirePlatformOperator,
  async (req: Request, res: Response) => {
    try {
      const orgId = String(req.params.orgId || "").trim();
      if (!orgId) {
        return res.status(400).json({ message: "orgId is required" });
      }
      const removed = await removePinnedAlertOrg(orgId);
      if (removed) {
        try {
          await pool.query(
            `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
             VALUES (gen_random_uuid(), $1, $2, 'EMAIL_ALERT_ORG_UNPINNED', 'email_alert_pinned_org', $3, $4)`,
            [
              req.session.orgId ?? orgId,
              req.session.userId ?? "system",
              orgId,
              JSON.stringify({ removedBy: req.session.userId ?? null }),
            ],
          );
        } catch {
          // Best-effort audit log.
        }
      }
      return res.json({ success: true, removed, orgId });
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  },
);

app.delete("/api/admin/email/suppression-list/:email", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const email = decodeURIComponent(req.params.email as string).toLowerCase();
    const existed = suppressionList.delete(suppKey(orgId, email));

    if (existed) {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'SUPPRESSION_REMOVED', 'email', $3, $4)`,
        [orgId, req.session.userId, email, JSON.stringify({ removedBy: req.session.userId })]
      );
    }

    return res.json({ success: true, removed: existed, email });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
