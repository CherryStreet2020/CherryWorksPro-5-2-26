import type { Express, Request, Response } from "express";
import { db, pool } from "../db";
import { orgs, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
import { requireAdmin, requireAuth, requirePlanTier } from "./middleware";
import { hashPassword } from "../auth";

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
const usedAssertionIds: Set<string> = new Set();

function validateSamlAssertion(assertionId: string, notOnOrAfter: string): { valid: boolean; error?: string } {
  if (usedAssertionIds.has(assertionId)) {
    return { valid: false, error: "Replay detected: assertion already consumed" };
  }
  const expiry = new Date(notOnOrAfter);
  if (isNaN(expiry.getTime()) || expiry < new Date()) {
    return { valid: false, error: "Assertion expired" };
  }
  usedAssertionIds.add(assertionId);
  setTimeout(() => usedAssertionIds.delete(assertionId), 24 * 60 * 60 * 1000);
  return { valid: true };
}

function mapRole(idpGroups: string[], roleMapping: Record<string, string>): string {
  for (const group of idpGroups) {
    if (roleMapping[group]) return roleMapping[group];
  }
  return "TEAM_MEMBER";
}

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

  app.post("/api/saml/acs/:orgSlug", async (req: Request, res: Response) => {
    const orgSlug = req.params.orgSlug as string;
    const org = await db.select().from(orgs).where(eq(orgs.slug, orgSlug)).then(r => r[0]);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const config = samlConfigs.get(org.id);
    if (!config || !config.enabled) return res.status(400).json({ message: "SAML not configured for this org" });

    const { SAMLResponse, email, name, groups, assertionId, notOnOrAfter } = req.body;

    if (!email) return res.status(400).json({ message: "Email is required in SAML assertion" });

    const replayCheck = validateSamlAssertion(
      assertionId || createHash("sha256").update(JSON.stringify(req.body)).digest("hex"),
      notOnOrAfter || new Date(Date.now() + 5 * 60_000).toISOString()
    );
    if (!replayCheck.valid) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), org.id, "SAML_REPLAY_BLOCKED", "auth", org.id, JSON.stringify({ email, error: replayCheck.error }), (req as any).ip || "unknown"]
        );
      } catch {}
      return res.status(400).json({ message: replayCheck.error });
    }

    const idpGroups: string[] = Array.isArray(groups) ? groups : (groups ? [groups] : []);
    const mappedRole = mapRole(idpGroups, config.roleMapping);

    let user = await db.select().from(users).where(and(eq(users.orgId, org.id), eq(users.email, email.toLowerCase()))).then(r => r[0]);

    if (!user && config.jitProvisioning) {
      const newUserId = randomUUID();
      const tempPassword = await hashPassword(randomUUID());
      await db.insert(users).values({
        id: newUserId,
        orgId: org.id,
        email: email.toLowerCase(),
        name: name || email.split("@")[0],
        password: tempPassword,
        role: mappedRole as any,
      });
      user = await db.select().from(users).where(eq(users.id, newUserId)).then(r => r[0]);

      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), org.id, newUserId, "SAML_JIT_PROVISIONED", "user", newUserId, JSON.stringify({ email, role: mappedRole, groups: idpGroups }), (req as any).ip || "unknown"]
        );
      } catch {}
    }

    if (!user) return res.status(403).json({ message: "User not found and JIT provisioning is disabled" });

    req.session.userId = user.id;
    req.session.orgId = org.id;
    req.session.role = user.role;
    req.session.lastActivity = Date.now();

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), org.id, user.id, "SAML_LOGIN", "user", user.id, JSON.stringify({ email, method: SAMLResponse ? "IdP-initiated" : "SP-initiated", groups: idpGroups, role: user.role }), (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role }, method: "saml" });
  });

  app.get("/api/saml/login/:orgSlug", async (req: Request, res: Response) => {
    const orgSlug = req.params.orgSlug as string;
    const org = await db.select().from(orgs).where(eq(orgs.slug, orgSlug)).then(r => r[0]);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const config = samlConfigs.get(org.id);
    if (!config || !config.enabled) return res.status(400).json({ message: "SAML not configured" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const samlRequest = Buffer.from(`<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_${randomUUID()}" Version="2.0" IssueInstant="${new Date().toISOString()}" AssertionConsumerServiceURL="${baseUrl}/api/saml/acs/${orgSlug}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${baseUrl}/api/saml/metadata/${orgSlug}</saml:Issuer></samlp:AuthnRequest>`).toString("base64");

    return res.json({
      ssoUrl: config.ssoUrl,
      samlRequest,
      method: "SP-initiated",
    });
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
