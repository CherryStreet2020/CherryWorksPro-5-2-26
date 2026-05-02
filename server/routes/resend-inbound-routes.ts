import type { Express, Request, Response } from "express";
import { db, pool } from "../db";
import { inboundEmails } from "@shared/schema";
import { randomUUID } from "crypto";

const RESEND_FROM_ADDRESS = "noreply@cherryworkspro.com";

function normalizeField(value: any): string {
  if (!value) return "unknown";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value) : "unknown";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function matchesCherryDomain(value: any): boolean {
  if (!value) return false;
  if (typeof value === "string") return value.endsWith("@cherryworkspro.com");
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && v.endsWith("@cherryworkspro.com"));
  return false;
}

export function registerResendInboundRoutes(app: Express) {
  app.post("/api/webhooks/resend/inbound", async (req: Request, res: Response) => {
    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.error("[resend-inbound] RESEND_API_KEY not configured");
        return res.status(500).json({ message: "Webhook not configured" });
      }

      const body = req.body;
      if (!body || !body.type) {
        return res.status(400).json({ message: "Invalid webhook payload" });
      }

      if (body.type !== "email.received") {
        return res.status(200).json({ message: "Event type ignored", type: body.type });
      }

      const data = body.data || {};
      if (!matchesCherryDomain(data.to)) {
        return res.status(200).json({ message: "Ignored: not a @cherryworkspro.com address" });
      }

      const fromValue = normalizeField(data.from);
      const toValue = normalizeField(data.to);

      const emailId = randomUUID();
      await db.insert(inboundEmails).values({
        id: emailId,
        from: fromValue,
        to: toValue,
        subject: data.subject || null,
        bodyText: data.text || null,
        bodyHtml: data.html || null,
        headers: data.headers || null,
        resendMessageId: data.message_id || data.id || null,
      });

      const orgRow = await pool.query(`SELECT id FROM orgs LIMIT 1`);
      const systemOrgId = orgRow.rows[0]?.id;
      if (systemOrgId) {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES ($1, $2, NULL, 'INBOUND_EMAIL_RECEIVED', 'inbound_email', $3, $4)`,
          [randomUUID(), systemOrgId, emailId, JSON.stringify({
            from: fromValue,
            to: toValue,
            subject: data.subject || "(no subject)",
            resendMessageId: data.message_id || data.id || null,
            fromAddress: RESEND_FROM_ADDRESS,
          })]
        );
      }

      console.log(`[resend-inbound] Stored inbound email ${emailId} from ${fromValue} to ${toValue}`);
      return res.status(200).json({ success: true, emailId });
    } catch (err: any) {
      console.error("[resend-inbound] Error processing webhook:", err.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}
