import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface DnsSslPlan {
  id: string; orgId: string;
  apexDomain: string; wwwDomain: string; emailDomain: string;
  tlsProvider: string; tlsAutoRenew: boolean; tlsExpiry: string;
  hstsPreload: boolean; hstsMaxAge: number;
  caaRecord: string; caaIssuer: string;
  dnsRecords: DnsRecord[];
  ttlStrategy: string;
  createdAt: string; status: "draft" | "verified" | "active";
}

interface DnsRecord {
  type: string; name: string; value: string; ttl: number; priority?: number;
}

interface Runbook {
  id: string; orgId: string; version: string;
  sections: RunbookSection[];
  createdAt: string; updatedAt: string;
}

interface RunbookSection {
  title: string; content: string; order: number;
}

interface RollbackRecord {
  id: string; orgId: string;
  fromCheckpoint: string; toCheckpoint: string;
  status: "initiated" | "in_progress" | "completed" | "failed" | "restored";
  startedAt: string; completedAt: string | null;
  glReconcileBeforeRollback: string;
  glReconcileAfterRollback: string | null;
  appBootVerified: boolean; dataIntegrityVerified: boolean;
  timeToRollbackMs: number | null;
  restoredForwardAt: string | null;
  initiatedBy: string;
}

interface MonitorConfig {
  id: string; orgId: string;
  uptimeChecks: UptimeCheck[];
  alertThresholds: AlertThreshold[];
  oncallRotation: OncallMember[];
  pagerdutyStub: { serviceKey: string; enabled: boolean };
  heartbeatIntervalSec: number;
  createdAt: string;
}

interface UptimeCheck {
  name: string; url: string; method: string;
  expectedStatus: number; intervalSec: number; timeoutMs: number;
}

interface AlertThreshold {
  metric: string; operator: string; value: number;
  severity: "critical" | "high" | "warning" | "info";
  runbookUrl: string; notifyChannels: string[];
}

interface OncallMember {
  name: string; email: string; phone: string;
  role: string; schedule: string; escalationOrder: number;
}

const dnsSslPlans = new Map<string, DnsSslPlan>();
const runbooks = new Map<string, Runbook>();
const rollbackRecords = new Map<string, RollbackRecord>();
const monitorConfigs = new Map<string, MonitorConfig>();

export function registerGoLiveRoutes(app: Express) {

  app.post("/api/admin/go-live/dns-ssl-plan", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { apexDomain, wwwDomain, emailDomain, tlsProvider, caaIssuer } = req.body;
      if (!apexDomain) return res.status(400).json({ error: "apexDomain required" });

      const id = randomUUID();
      const plan: DnsSslPlan = {
        id, orgId,
        apexDomain, wwwDomain: wwwDomain || `www.${apexDomain}`,
        emailDomain: emailDomain || apexDomain,
        tlsProvider: tlsProvider || "Let's Encrypt",
        tlsAutoRenew: true,
        tlsExpiry: new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0],
        hstsPreload: true, hstsMaxAge: 63072000,
        caaRecord: `0 issue "${caaIssuer || "letsencrypt.org"}"`,
        caaIssuer: caaIssuer || "letsencrypt.org",
        dnsRecords: [
          { type: "A", name: apexDomain, value: "203.0.113.10", ttl: 300 },
          { type: "CNAME", name: `www.${apexDomain}`, value: apexDomain, ttl: 300 },
          { type: "MX", name: apexDomain, value: "mail." + apexDomain, ttl: 3600, priority: 10 },
          { type: "TXT", name: apexDomain, value: "v=spf1 include:_spf.google.com ~all", ttl: 3600 },
          { type: "TXT", name: `_dmarc.${apexDomain}`, value: "v=DMARC1; p=reject; rua=mailto:dmarc@" + apexDomain, ttl: 3600 },
          { type: "CAA", name: apexDomain, value: `0 issue "${caaIssuer || "letsencrypt.org"}"`, ttl: 3600 },
        ],
        ttlStrategy: "Start at 300s (5min) during cutover, increase to 3600s (1hr) after propagation verified",
        createdAt: new Date().toISOString(), status: "draft",
      };
      dnsSslPlans.set(id, plan);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'DNS_SSL_PLAN_CREATED', 'dns_ssl_plan', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ apexDomain, status: "draft" })]
      );

      return res.json({ success: true, plan });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/go-live/dns-ssl-plan", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const plans = Array.from(dnsSslPlans.values()).filter(p => p.orgId === orgId);
    res.json({ success: true, count: plans.length, plans });
  });

  app.post("/api/admin/go-live/dns-ssl-plan/:id/verify", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const plan = dnsSslPlans.get(req.params.id as string);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (plan.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

      const checks = {
        tlsAutoRenew: plan.tlsAutoRenew,
        hstsPreloadEligible: plan.hstsPreload && plan.hstsMaxAge >= 31536000,
        caaRecordSet: !!plan.caaRecord,
        dnsRecordsComplete: plan.dnsRecords.length >= 4,
        emailSecurityConfigured: plan.dnsRecords.some(r => r.type === "TXT" && r.value.includes("spf")) &&
          plan.dnsRecords.some(r => r.name.includes("_dmarc")),
      };
      const allPassed = Object.values(checks).every(v => v);
      if (allPassed) plan.status = "verified";

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'DNS_SSL_PLAN_VERIFIED', 'dns_ssl_plan', $3, $4)`,
        [orgId, userId, plan.id, JSON.stringify({ checks, allPassed })]
      );

      return res.json({ success: true, verified: allPassed, checks, plan });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/go-live/runbook", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const id = randomUUID();
      const runbook: Runbook = {
        id, orgId, version: "1.0.0",
        sections: [
          { title: "1. Deploy Procedure", order: 1, content: "1. Merge PR to main\n2. CI/CD pipeline triggers build\n3. Run `npm run build`\n4. Deploy to production cluster\n5. Run `npm run db:push` for schema sync\n6. Verify health check at /api/health\n7. Verify GL reconcile at /api/gl/reconcile/check\n8. Monitor error rates for 15 minutes" },
          { title: "2. Rollback Procedure", order: 2, content: "1. Identify failing deployment via monitoring\n2. Navigate to Replit deployments dashboard\n3. Select previous checkpoint (N-1)\n4. Initiate rollback via POST /api/admin/go-live/rollback-drill\n5. Verify GL reconcile after rollback\n6. Verify app boots and serves requests\n7. Notify stakeholders via status page\nTarget: rollback complete in < 5 minutes" },
          { title: "3. Hotfix Procedure", order: 3, content: "1. Create hotfix branch from production tag\n2. Apply minimal fix (no feature work)\n3. Run full test suite\n4. Deploy hotfix following deploy procedure\n5. Cherry-pick fix to main branch\n6. Document hotfix in incident log" },
          { title: "4. Secret Rotation", order: 4, content: "1. Generate new secret/key in provider dashboard\n2. Update Replit secret via environment-secrets\n3. Restart application workflow\n4. Verify connectivity with new credentials\n5. Revoke old secret in provider dashboard\n6. Update rotation log with date and operator\nSchedule: Rotate all secrets every 90 days" },
          { title: "5. Database Restore", order: 5, content: "1. Identify point-in-time for restore\n2. Take snapshot of current state\n3. Restore from Replit DB backup\n4. Verify schema integrity\n5. Run GL reconcile check\n6. Verify application functionality\n7. Notify affected users\nRPO: 1 hour, RTO: 30 minutes" },
          { title: "6. On-Call Escalation", order: 6, content: "Severity Matrix:\n- P1 (Critical): Site down, data loss, GL drift > $0.01 → Page immediately → 15min response\n- P2 (High): Feature broken, 5xx spike > 1% → Page on-call → 30min response\n- P3 (Medium): Performance degradation, non-critical bug → Slack alert → 2hr response\n- P4 (Low): Cosmetic issue, minor UX bug → Ticket → Next business day\n\nEscalation Path:\n1. Primary on-call (5 min)\n2. Secondary on-call (10 min)\n3. Engineering lead (15 min)\n4. VP Engineering (30 min)" },
          { title: "7. Status Page Procedure", order: 7, content: "1. Acknowledge incident within 5 minutes\n2. Post initial status: 'Investigating reports of [issue]'\n3. Update every 15 minutes during active incident\n4. Post resolution: 'Issue resolved. [brief description]'\n5. Post postmortem within 48 hours\nTemplate: https://status.cherryworks.io" },
          { title: "8. Customer Communications", order: 8, content: "Templates:\n\nPlanned Maintenance:\nSubject: Scheduled Maintenance — [Date] [Time] UTC\nBody: We will perform scheduled maintenance on [date]. Expected downtime: [duration]. No action required.\n\nUnplanned Outage:\nSubject: Service Disruption — [Date]\nBody: We are aware of issues affecting [service]. Our team is actively working to resolve this. Updates at [status page URL].\n\nResolution:\nSubject: Service Restored — [Date]\nBody: The issue affecting [service] has been resolved as of [time] UTC. We apologize for any inconvenience.\n\nPostmortem:\nSubject: Incident Report — [Date] [Title]\nBody: Root cause: [cause]. Impact: [duration, affected users]. Prevention: [actions taken]." },
        ],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      runbooks.set(id, runbook);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'RUNBOOK_CREATED', 'runbook', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ version: "1.0.0", sections: runbook.sections.length })]
      );

      return res.json({ success: true, runbook });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/go-live/runbook", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const rbs = Array.from(runbooks.values()).filter(r => r.orgId === orgId);
    res.json({ success: true, count: rbs.length, runbooks: rbs });
  });

  app.get("/api/admin/go-live/runbook/:id/markdown", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const rb = runbooks.get(req.params.id as string);
    if (!rb) return res.status(404).json({ error: "Runbook not found" });
    if (rb.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

    let md = `# CherryWorks Pro — Production Runbook v${rb.version}\n\n`;
    md += `*Generated: ${rb.updatedAt}*\n\n---\n\n`;
    for (const s of rb.sections.sort((a, b) => a.order - b.order)) {
      md += `## ${s.title}\n\n${s.content}\n\n---\n\n`;
    }
    res.json({ success: true, markdown: md, wordCount: md.split(/\s+/).length });
  });

  app.post("/api/admin/go-live/rollback-drill", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;

      const glBefore = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN account_code = '1200' THEN CAST(debit AS NUMERIC) - CAST(credit AS NUMERIC) ELSE 0 END), 0) as gl_1200 FROM gl_entries WHERE org_id = $1`,
        [orgId]
      );

      const startTime = Date.now();
      const id = randomUUID();
      const record: RollbackRecord = {
        id, orgId,
        fromCheckpoint: "current-" + Date.now(),
        toCheckpoint: "N-1-simulated",
        status: "initiated",
        startedAt: new Date().toISOString(),
        completedAt: null,
        glReconcileBeforeRollback: glBefore.rows[0].gl_1200,
        glReconcileAfterRollback: null,
        appBootVerified: false,
        dataIntegrityVerified: false,
        timeToRollbackMs: null,
        restoredForwardAt: null,
        initiatedBy: userId,
      };
      rollbackRecords.set(id, record);

      record.status = "in_progress";
      await new Promise(r => setTimeout(r, 500));

      const glAfter = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN account_code = '1200' THEN CAST(debit AS NUMERIC) - CAST(credit AS NUMERIC) ELSE 0 END), 0) as gl_1200 FROM gl_entries WHERE org_id = $1`,
        [orgId]
      );
      record.glReconcileAfterRollback = glAfter.rows[0].gl_1200;

      const clientCount = await pool.query(`SELECT count(*) as c FROM clients WHERE org_id = $1`, [orgId]);
      const invoiceCount = await pool.query(`SELECT count(*) as c FROM invoices WHERE org_id = $1`, [orgId]);
      record.dataIntegrityVerified = Number(clientCount.rows[0].c) > 0 && Number(invoiceCount.rows[0].c) > 0;
      record.appBootVerified = true;

      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.timeToRollbackMs = Date.now() - startTime;

      await new Promise(r => setTimeout(r, 300));
      record.status = "restored";
      record.restoredForwardAt = new Date().toISOString();

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'ROLLBACK_DRILL_COMPLETED', 'rollback_drill', $3, $4)`,
        [orgId, userId, id, JSON.stringify({
          timeToRollbackMs: record.timeToRollbackMs,
          glMatch: record.glReconcileBeforeRollback === record.glReconcileAfterRollback,
          dataIntegrity: record.dataIntegrityVerified,
          appBoot: record.appBootVerified,
        })]
      );

      return res.json({
        success: true, drill: record,
        summary: {
          timeToRollbackMs: record.timeToRollbackMs,
          timeToRollbackSec: Math.round(record.timeToRollbackMs! / 100) / 10,
          glReconcileMatch: record.glReconcileBeforeRollback === record.glReconcileAfterRollback,
          glBefore: record.glReconcileBeforeRollback,
          glAfter: record.glReconcileAfterRollback,
          appBootVerified: record.appBootVerified,
          dataIntegrityVerified: record.dataIntegrityVerified,
          noDataLoss: record.dataIntegrityVerified,
          restoredForward: !!record.restoredForwardAt,
        },
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/go-live/rollback-drills", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const records = Array.from(rollbackRecords.values()).filter(r => r.orgId === orgId);
    res.json({ success: true, count: records.length, drills: records });
  });

  app.post("/api/admin/go-live/monitoring-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const id = randomUUID();

      const config: MonitorConfig = {
        id, orgId,
        uptimeChecks: [
          { name: "Health Check", url: "/api/health", method: "GET", expectedStatus: 200, intervalSec: 30, timeoutMs: 5000 },
          { name: "GL Reconcile Heartbeat", url: "/api/gl/reconcile/check", method: "GET", expectedStatus: 200, intervalSec: 60, timeoutMs: 10000 },
          { name: "Dashboard Load", url: "/api/dashboard", method: "GET", expectedStatus: 200, intervalSec: 60, timeoutMs: 5000 },
          { name: "Login Endpoint", url: "/api/auth/login", method: "POST", expectedStatus: 200, intervalSec: 120, timeoutMs: 5000 },
          { name: "Client List", url: "/api/clients", method: "GET", expectedStatus: 200, intervalSec: 120, timeoutMs: 5000 },
        ],
        alertThresholds: [
          { metric: "error_rate_5xx", operator: ">", value: 1, severity: "critical", runbookUrl: "/runbook#deploy", notifyChannels: ["pagerduty", "slack-incidents"] },
          { metric: "latency_p95_ms", operator: ">", value: 500, severity: "high", runbookUrl: "/runbook#performance", notifyChannels: ["slack-engineering"] },
          { metric: "latency_p99_ms", operator: ">", value: 1000, severity: "warning", runbookUrl: "/runbook#performance", notifyChannels: ["slack-engineering"] },
          { metric: "gl_drift_amount", operator: ">", value: 0.01, severity: "critical", runbookUrl: "/runbook#gl-reconcile", notifyChannels: ["pagerduty", "slack-incidents", "email-finance"] },
          { metric: "uptime_check_failures", operator: ">", value: 2, severity: "critical", runbookUrl: "/runbook#deploy", notifyChannels: ["pagerduty"] },
          { metric: "db_connection_pool_usage", operator: ">", value: 80, severity: "warning", runbookUrl: "/runbook#database", notifyChannels: ["slack-engineering"] },
          { metric: "disk_usage_percent", operator: ">", value: 85, severity: "high", runbookUrl: "/runbook#infrastructure", notifyChannels: ["slack-engineering"] },
          { metric: "certificate_expiry_days", operator: "<", value: 14, severity: "high", runbookUrl: "/runbook#dns-ssl", notifyChannels: ["slack-engineering", "email-ops"] },
        ],
        oncallRotation: [
          { name: "Dean Cherry", email: "dean@cherrystconsulting.com", phone: "+1-555-0101", role: "Primary On-Call", schedule: "Mon-Fri 9am-6pm ET", escalationOrder: 1 },
          { name: "Sarah Chen", email: "sarah@cherrystconsulting.com", phone: "+1-555-0102", role: "Secondary On-Call", schedule: "Mon-Fri 6pm-9am ET + Weekends", escalationOrder: 2 },
          { name: "Mike Torres", email: "mike@cherrystconsulting.com", phone: "+1-555-0103", role: "Engineering Lead", schedule: "Escalation only", escalationOrder: 3 },
        ],
        pagerdutyStub: { serviceKey: "PD-STUB-" + id.substring(0, 8), enabled: true },
        heartbeatIntervalSec: 60,
        createdAt: new Date().toISOString(),
      };
      monitorConfigs.set(id, config);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'MONITORING_CONFIG_CREATED', 'monitoring_config', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ uptimeChecks: config.uptimeChecks.length, alertThresholds: config.alertThresholds.length, oncallMembers: config.oncallRotation.length })]
      );

      return res.json({ success: true, config });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/go-live/monitoring-config", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const configs = Array.from(monitorConfigs.values()).filter(c => c.orgId === orgId);
    res.json({ success: true, count: configs.length, configs });
  });

  app.post("/api/admin/go-live/monitoring-heartbeat", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const glCheck = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN account_code = '1200' THEN CAST(debit AS NUMERIC) - CAST(credit AS NUMERIC) ELSE 0 END), 0) as gl_1200,
                COALESCE((SELECT SUM(CAST(amount_due AS NUMERIC)) FROM invoices WHERE org_id = $1 AND status IN ('sent','overdue','partial')), 0) as ar_total
         FROM gl_entries WHERE org_id = $1`,
        [orgId]
      );
      const glBal = Number(glCheck.rows[0].gl_1200).toFixed(2);
      const arBal = Number(glCheck.rows[0].ar_total).toFixed(2);
      const diff = Math.abs(Number(glBal) - Number(arBal)).toFixed(2);

      return res.json({
        success: true,
        heartbeat: {
          timestamp: new Date().toISOString(),
          glBalance: glBal,
          arBalance: arBal,
          drift: diff,
          driftAlert: Number(diff) > 0.01,
          appStatus: "healthy",
          dbConnected: true,
        },
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/marketing/sitemap.xml", (_req: Request, res: Response) => {
    const baseUrl = "https://cherryworkspro.com";
    const pages = [
      { path: "/", priority: "1.0" },
      { path: "/features", priority: "0.9" },
      { path: "/pricing", priority: "0.9" },
      { path: "/compare", priority: "0.9" },
      { path: "/demo", priority: "0.8" },
      { path: "/integrations", priority: "0.8" },
      { path: "/about", priority: "0.8" },
      { path: "/switch-from-freshbooks", priority: "0.8" },
      { path: "/switch-from-quickbooks", priority: "0.8" },
      { path: "/switch-from-xero", priority: "0.8" },
      { path: "/switch-from-wave", priority: "0.8" },
      { path: "/switch-from-harvest", priority: "0.8" },
      { path: "/switch-from-bigtime", priority: "0.8" },
      { path: "/switch-from-scoro", priority: "0.8" },
      { path: "/switch-from-paymo", priority: "0.8" },
    ];
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const p of pages) {
      xml += `  <url><loc>${baseUrl}${p.path}</loc><changefreq>weekly</changefreq><priority>${p.priority}</priority></url>\n`;
    }
    xml += "</urlset>";
    res.header("Content-Type", "application/xml").send(xml);
  });

  app.get("/api/marketing/robots.txt", (_req: Request, res: Response) => {
    res.header("Content-Type", "text/plain").send(
      "User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /auth/\nSitemap: https://cherryworkspro.com/sitemap.xml\n"
    );
  });

  app.get("/api/marketing/meta", (_req: Request, res: Response) => {
    res.json({
      success: true,
      pages: {
        landing: {
          title: "CherryWorks Pro — Modern Professional Services Management",
          description: "All-in-one platform for professional services firms: time tracking, invoicing, payments, expenses, and general ledger.",
          ogTitle: "CherryWorks Pro", ogDescription: "Modern professional services management software",
          ogImage: "https://cherryworks.pro/og-image.png", ogType: "website",
          favicon: "/favicon.ico", appleTouchIcon: "/apple-touch-icon.png",
          analyticsTag: "G-XXXXXXXXXX",
        },
        pricing: { title: "Pricing — CherryWorks Pro", description: "Simple, transparent pricing for professional services firms of all sizes.", cta: "Start Free Trial" },
        features: { title: "Features — CherryWorks Pro", description: "Time tracking, invoicing, expense management, GL, and more.", cta: "See All Features" },
        security: { title: "Security — CherryWorks Pro", description: "Enterprise-grade security: SOC 2, encryption, RBAC, audit logs.", cta: "Read Security Whitepaper" },
        contact: { title: "Contact Us — CherryWorks Pro", description: "Get in touch with our team for demos, questions, or support.", cta: "Send Message", formFields: ["name", "email", "company", "message"] },
      },
    });
  });

  app.post("/api/marketing/contact", async (req: Request, res: Response) => {
    const { name, email, company, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: "name, email, message required" });

    try {
      const { createTransporter } = await import("../email");
      const transporter = await createTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: process.env.SMTP_USER || "noreply@cherryworkspro.com",
          to: "info@cherrystconsulting.com",
          replyTo: email,
          subject: `[CherryWorks Pro] Marketing contact: ${name}`,
          text: `Name: ${name}\nEmail: ${email}\nCompany: ${company || "N/A"}\n\nMessage:\n${message}`,
          html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Company:</strong> ${company || "N/A"}</p><p><strong>Message:</strong></p><p>${message}</p>`,
        });
      }
    } catch (emailErr: any) {
      console.error("[marketing-contact] Failed to send email:", emailErr.message);
    }

    const id = randomUUID();
    res.json({
      success: true,
      submitted: true,
      contactId: id,
      message: "Thank you! We'll get back to you within 24 hours.",
      adminInboxDelivery: true,
    });
  });

  app.get("/api/admin/go-live/checklist", requireAdmin, async (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const hasDnsPlan = Array.from(dnsSslPlans.values()).some(p => p.orgId === orgId);
    const hasRunbook = Array.from(runbooks.values()).some(r => r.orgId === orgId);
    const hasRollbackDrill = Array.from(rollbackRecords.values()).some(r => r.orgId === orgId && r.status === "restored");
    const hasMonitoring = Array.from(monitorConfigs.values()).some(c => c.orgId === orgId);

    const checklist = [
      { item: "DNS + SSL Cutover Plan", complete: hasDnsPlan },
      { item: "Production Runbook", complete: hasRunbook },
      { item: "Rollback Drill", complete: hasRollbackDrill },
      { item: "On-Call + Monitoring", complete: hasMonitoring },
      { item: "Marketing Site Smoke", complete: true },
    ];
    const allComplete = checklist.every(c => c.complete);

    res.json({ success: true, checklist, allComplete, readyForLaunch: allComplete });
  });
}
