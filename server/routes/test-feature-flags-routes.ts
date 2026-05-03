import type { Express, Request, Response, NextFunction } from "express";
import {
  __setMarketingOsEnabledForTests,
  __resetMarketingOsFlagForTests,
  isMarketingOsEnabled,
} from "../lib/featureFlags";
import {
  __setEmailOauthEnabledForTests,
  __resetEmailOauthFlagForTests,
  isEmailOauthEnabled,
} from "../email/feature-flag";
import { requireAuth } from "./middleware";

function isTestOnly(): boolean {
  return process.env.NODE_ENV !== "production";
}

function notFound(res: Response): Response {
  return res.status(404).json({ message: "Not found" });
}

/** Belt-and-braces guard: production NEVER reaches the handlers, even
 * if requireAuth is somehow bypassed. */
function devOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isTestOnly()) {
    notFound(res);
    return;
  }
  next();
}

export function registerTestFeatureFlagRoutes(app: Express): void {
  app.get(
    "/api/__test__/feature-flags",
    devOnly,
    requireAuth,
    (_req: Request, res: Response) => {
      return res.json({
        marketingOs: isMarketingOsEnabled(),
        emailOauth: isEmailOauthEnabled(),
      });
    },
  );

  app.post("/api/__test__/feature-flags", devOnly, requireAuth, (req: Request, res: Response) => {
    const { marketingOs, emailOauth } = (req.body ?? {}) as {
      marketingOs?: boolean | null;
      emailOauth?: boolean | null;
    };
    if (marketingOs !== undefined) {
      __setMarketingOsEnabledForTests(
        marketingOs === null ? null : Boolean(marketingOs),
      );
    }
    if (emailOauth !== undefined) {
      __setEmailOauthEnabledForTests(
        emailOauth === null ? null : Boolean(emailOauth),
      );
    }
    return res.json({
      marketingOs: isMarketingOsEnabled(),
      emailOauth: isEmailOauthEnabled(),
    });
  });

  app.delete("/api/__test__/feature-flags", devOnly, requireAuth, (_req: Request, res: Response) => {
    __resetMarketingOsFlagForTests();
    __resetEmailOauthFlagForTests();
    return res.json({
      marketingOs: isMarketingOsEnabled(),
      emailOauth: isEmailOauthEnabled(),
    });
  });
}
