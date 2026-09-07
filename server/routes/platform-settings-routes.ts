/**
 * Platform-operator switches (PLATFORM_OPERATOR_EMAILS allow-list).
 * Existence-hiding like the other operator routes: non-operators see 404.
 */
import type { Express } from "express";
import { requirePlatformOperator } from "./middleware";
import { envSignupDisabled, setSetting, signupState, SIGNUP_ENABLED_KEY } from "../platform-settings";
import { storage } from "../storage";

export function registerPlatformSettingsRoutes(app: Express) {
  app.get("/api/platform/settings/signup", requirePlatformOperator, async (_req, res) => {
    const state = await signupState();
    return res.json({ ...state, envHardOff: envSignupDisabled() });
  });

  app.put("/api/platform/settings/signup", requirePlatformOperator, async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") return res.status(400).json({ message: "enabled must be true or false" });
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 300) : null;
    await setSetting(SIGNUP_ENABLED_KEY, { enabled, message }, req.session.userId ?? null);
    await storage.createAuditLog({ orgId: req.session.orgId!, userId: req.session.userId!, action: enabled ? "SIGNUP_ENABLED" : "SIGNUP_DISABLED", entityType: "platform", entityId: SIGNUP_ENABLED_KEY, details: { message } }).catch(() => {});
    const state = await signupState();
    return res.json({ ...state, envHardOff: envSignupDisabled() });
  });
}
