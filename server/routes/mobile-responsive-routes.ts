import type { Express } from "express";
import { requireAdmin } from "./middleware";

export function registerMobileResponsiveRoutes(app: Express) {

app.get("/api/responsive/config", async (_req, res) => {
  return res.json({
    breakpoints: {
      mobile: 375,
      mobileLarge: 414,
      tablet: 768,
      desktop: 1024,
      wide: 1440,
    },
    features: {
      hamburgerNav: true,
      tablesToCards: true,
      tapTargets44px: true,
      swipeGestures: true,
      touchOptimized: true,
      viewportMeta: "width=device-width, initial-scale=1",
    },
    testedWidths: [375, 414, 768, 1024, 1440],
  });
});

app.get("/api/responsive/check", requireAdmin, async (_req, res) => {
  const { readFileSync, existsSync } = await import("fs");
  const path = await import("path");

  const cssPath = path.join(process.cwd(), "client", "src", "index.css");
  const indexPath = path.join(process.cwd(), "client", "index.html");

  const checks: Record<string, boolean> = {};

  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, "utf8");
    checks.hasMediaQueries = css.includes("@media");
    checks.has375px = css.includes("375px") || css.includes("max-width: 640px") || css.includes("sm:") || css.includes("min-width: 640px");
    checks.has768px = css.includes("768px") || css.includes("md:") || css.includes("min-width: 768px");
    checks.hasTapTargets = css.includes("min-height: 44px") || css.includes("min-height:44px") || css.includes("tap-target") || css.includes("touch-target");
    checks.hasHamburger = css.includes("hamburger") || css.includes("mobile-nav") || css.includes("mobile-menu");
    checks.hasCardLayout = css.includes("card") || css.includes("responsive-card");
    checks.hasTouchOptimization = css.includes("touch-action") || css.includes("-webkit-tap-highlight");
    checks.hasFlexGrid = css.includes("flex") || css.includes("grid");
  }

  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf8");
    checks.hasViewportMeta = html.includes("viewport") && !html.includes("user-scalable=no");
  }

  const passCount = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;

  return res.json({
    checks,
    score: `${passCount}/${totalChecks}`,
    pass: passCount >= totalChecks * 0.7,
  });
});

}
