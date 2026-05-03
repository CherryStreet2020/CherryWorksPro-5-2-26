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

/**
 * Belt-and-braces guard. To reach a handler, ALL of the following must
 * hold:
 *   1. NODE_ENV !== "production"        (this `devOnly` check)
 *   2. caller is authenticated          (`requireAuth` further down)
 *   3. caller sends X-E2E-Flag-Override (this `devOnly` check)
 *
 * The header gate stops a stray browser tab on a shared dev/staging
 * environment from accidentally (or maliciously) flipping global
 * feature switches just because the user happens to be logged in.
 * The token value is intentionally a fixed sentinel rather than a
 * secret — anyone reading the spec can find it. The point is to make
 * the test-only nature explicit and prevent drive-by mutations, not
 * to keep the seam itself secret.
 */
const E2E_OVERRIDE_HEADER = "x-e2e-flag-override";
const E2E_OVERRIDE_TOKEN = "task-437-test-only";
function devOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isTestOnly()) {
    notFound(res);
    return;
  }
  if (req.header(E2E_OVERRIDE_HEADER) !== E2E_OVERRIDE_TOKEN) {
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
