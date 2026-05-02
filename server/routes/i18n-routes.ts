import type { Express, Request, Response } from "express";
import { requireAuth } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";
import { SUPPORTED_LOCALES, getTranslations, formatDate, formatCurrency, formatNumber, getDirection, type Locale } from "../i18n";

export function registerI18nRoutes(app: Express) {

  app.get("/api/i18n/locales", (_req: Request, res: Response) => {
    return res.json({
      locales: SUPPORTED_LOCALES.map(l => ({
        code: l,
        name: { en: "English", es: "Español", fr: "Français" }[l],
        direction: getDirection(l),
      })),
      default: "en",
    });
  });

  app.get("/api/i18n/translations/:locale", (req: Request, res: Response) => {
    const locale = req.params.locale as Locale;
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return res.status(400).json({ message: `Unsupported locale: ${locale}. Supported: ${SUPPORTED_LOCALES.join(", ")}` });
    }
    return res.json({ locale, translations: getTranslations(locale), direction: getDirection(locale) });
  });

  app.get("/api/i18n/user-locale", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT COALESCE(locale, 'en') AS locale FROM users WHERE id = $1`,
        [req.session.userId]
      );
      const locale = result.rows[0]?.locale || "en";
      return res.json({ locale, direction: getDirection(locale as Locale) });
    } catch {
      return res.json({ locale: "en", direction: "ltr" });
    }
  });

  app.patch("/api/i18n/user-locale", requireAuth, async (req: Request, res: Response) => {
    const { locale } = req.body;
    if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
      return res.status(400).json({ message: `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(", ")}` });
    }
    try {
      await pool.query(`UPDATE users SET locale = $1 WHERE id = $2`, [locale, req.session.userId]);
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), req.session.orgId, req.session.userId, "LOCALE_CHANGED", "user", req.session.userId, JSON.stringify({ locale }), (req as any).ip || "unknown"]
        );
      } catch {}
      return res.json({ success: true, locale });
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to update locale" });
    }
  });

  app.get("/api/i18n/format-demo", requireAuth, async (req: Request, res: Response) => {
    const locale = (req.query.locale as Locale) || "en";
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return res.status(400).json({ message: "Unsupported locale" });
    }
    const now = new Date();
    return res.json({
      locale,
      direction: getDirection(locale),
      samples: {
        date: formatDate(now, locale),
        currency_usd: formatCurrency(1234.56, "USD", locale),
        currency_eur: formatCurrency(1234.56, "EUR", locale),
        number: formatNumber(1234567.89, locale),
      },
    });
  });
}
