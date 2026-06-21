import type { Express, Request, Response } from "express";
import { db, pool } from "../db";
import { orgs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin, requirePlanTier } from "./middleware";

interface SamlConfig {
  orgId: string;
  entityId: string;
  ssoUrl: string;
  certificate: string;
  roleMapping: Record<string, string>;
  jitProvisioning: boolean;
  enabled: boolean;
  lastUpdated: string;
}

const samlConfigs: Map<string, SamlConfig> = new Map();

export function registerSamlRoutes(app: Express) {

  app.get("/api/admin/saml/config", requireAdmin, async (req: Request, res: Response) => {
    if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "SAML/SSO"))) return;
    const orgId = req.session.orgId!;
    const config = samlConfigs.get(orgId);
    if (!config) return res.json({ configured: false });
    return res.json({
      configured: true,
      entityId: config.entityId,
      ssoUrl: config.ssoUrl,
      jitProvisioning: config.jitProvisioning,
      roleMapping: config.roleMapping,
      enabled: config.enabled,
      lastUpdated: config.lastUpdated,
      hasCertificate: !!config.certificate,
    });
  });

  app.put("/api/admin/saml/config", requireAdmin, async (req: Request, res: Response) => {
    if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "SAML/SSO"))) return;
    const orgId = req.session.orgId!;
    const { entityId, ssoUrl, certificate, roleMapping, jitProvisioning, enabled } = req.body;
    if (!entityId || !ssoUrl || !certificate) {
      return res.status(400).json({ message: "entityId, ssoUrl, and certificate are required" });
    }
    const config: SamlConfig = {
      orgId,
      entityId,
      ssoUrl,
      certificate,
      roleMapping: roleMapping || { Admins: "ADMIN", "Team Members": "TEAM_MEMBER" },
      jitProvisioning: jitProvisioning !== false,
      enabled: enabled !== false,
      lastUpdated: new Date().toISOString(),
    };
    samlConfigs.set(orgId, config);

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), orgId, req.session.userId, "SAML_CONFIG_UPDATED", "org", orgId, JSON.stringify({ entityId, ssoUrl, jitProvisioning: config.jitProvisioning }), (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({ success: true, config: { ...config, certificate: "[REDACTED]" } });
  });

  app.get("/api/saml/metadata/:orgSlug", async (req: Request, res: Response) => {
    const orgSlug = req.params.orgSlug as string;
    const org = await db.select().from(orgs).where(eq(orgs.slug, orgSlug)).then(r => r[0]);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const config = samlConfigs.get(org.id);
    if (!config || !config.enabled) return res.status(404).json({ message: "SAML not configured" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${baseUrl}/api/saml/metadata/${orgSlug}">
  <SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${baseUrl}/api/saml/acs/${orgSlug}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
    res.type("application/xml").send(metadata);
  });

  // ── SAML SSO sign-in is DISABLED (audit #1, CRITICAL) ──────────────────────
  // The previous Assertion Consumer Service established an authenticated session
  // from identity fields (email / name / groups) taken straight from the request
  // body, WITHOUT verifying the signed SAML assertion against the configured IdP
  // certificate. Any unauthenticated caller could therefore log in as an existing
  // user (or JIT-provision a fresh ADMIN) for a SAML-enabled org — a full SSO
  // auth bypass and privilege escalation.
  //
  // A correct implementation must base64-decode and XML-DSig-verify the
  // SAMLResponse against the stored cert, and validate Issuer / Audience /
  // Recipient (== this SP's ACS URL) / Conditions(NotOnOrAfter) and bind
  // InResponseTo to a server-issued AuthnRequest ID — deriving identity ONLY
  // from the verified, signed assertion. Until that verified flow exists, the
  // sign-in endpoints must never establish a session. They return 503 so no
  // identity can be asserted. (Org config + metadata stubs below are retained
  // for the eventual real build; they establish no session.)
  app.post("/api/saml/acs/:orgSlug", (_req: Request, res: Response) => {
    return res.status(503).json({ message: "SAML SSO is not available." });
  });

  app.get("/api/saml/login/:orgSlug", (_req: Request, res: Response) => {
    return res.status(503).json({ message: "SAML SSO is not available." });
  });

  app.delete("/api/admin/saml/config", requireAdmin, async (req: Request, res: Response) => {
    if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "SAML/SSO"))) return;
    const orgId = req.session.orgId!;
    samlConfigs.delete(orgId);
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), orgId, req.session.userId, "SAML_CONFIG_DELETED", "org", orgId, "{}", (req as any).ip || "unknown"]
      );
    } catch {}
    return res.json({ success: true });
  });
}
