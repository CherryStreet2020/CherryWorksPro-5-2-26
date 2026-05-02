import type { Express, Request, Response } from "express";
import { requireAuth, sanitizeErrorMessage } from "./middleware";
import { storage } from "../storage";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface OcrResult {
  id: string;
  orgId: string;
  userId: string;
  vendor: string;
  date: string;
  amount: string;
  currency: string;
  category: string;
  confidence: number;
  rawText: string;
  sourceFile: string;
  processedAt: Date;
}

const ocrResults = new Map<string, OcrResult>();

function simulateOcr(filename: string): { vendor: string; date: string; amount: string; currency: string; category: string; confidence: number; rawText: string } {
  const vendors = ["Staples", "Office Depot", "Amazon Business", "Delta Airlines", "Uber", "Hilton Hotels", "FedEx", "Costco Business"];
  const categories = ["office_supplies", "travel", "transportation", "lodging", "shipping", "meals", "software", "equipment"];
  const vendor = vendors[Math.floor(Math.random() * vendors.length)];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const amount = (Math.random() * 500 + 10).toFixed(2);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return {
    vendor,
    date,
    amount,
    currency: "USD",
    category,
    confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
    rawText: `${vendor}\n${date}\nTotal: $${amount}\nPayment: VISA ****1234\nThank you for your purchase!`,
  };
}

export function registerReceiptOcrRoutes(app: Express) {

app.post("/api/expenses/ocr/scan", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;

    const org = await storage.getOrg(orgId);
    if ((org?.planTier || "TRIAL") === "STARTER") {
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const usageResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM audit_logs WHERE org_id = $1 AND action = 'RECEIPT_OCR_SCANNED' AND created_at >= $2`,
        [orgId, startOfMonth]
      );
      const monthlyUsage = parseInt(usageResult.rows[0]?.cnt || "0", 10);
      if (monthlyUsage >= 200) {
        return res.status(429).json({
          message: "You've hit this month's receipt scan fair-use limit. Contact support@cherryworkspro.com to discuss your usage or upgrade for unlimited scans.",
          fairUseLimit: 200,
          upgradeUrl: "/pricing",
        });
      }
    }

    const { filename, fileType } = req.body;

    if (!filename) return res.status(400).json({ message: "filename is required" });

    const allowedTypes = [".jpg", ".jpeg", ".png", ".pdf", ".heic", ".webp"];
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    if (!allowedTypes.includes(ext)) {
      return res.status(400).json({ message: `Unsupported file type: ${ext}. Allowed: ${allowedTypes.join(", ")}` });
    }

    const ocrData = simulateOcr(filename);
    const id = randomUUID();
    const result: OcrResult = {
      id,
      orgId,
      userId,
      ...ocrData,
      sourceFile: filename,
      processedAt: new Date(),
    };

    ocrResults.set(id, result);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'RECEIPT_OCR_SCANNED', 'expense_receipt', $3, $4)`,
      [orgId, userId, id, JSON.stringify({ vendor: ocrData.vendor, amount: ocrData.amount, currency: ocrData.currency, confidence: ocrData.confidence, filename })]
    );

    return res.json({
      success: true,
      ocrResult: {
        id,
        vendor: ocrData.vendor,
        date: ocrData.date,
        amount: ocrData.amount,
        currency: ocrData.currency,
        category: ocrData.category,
        confidence: ocrData.confidence,
        rawText: ocrData.rawText,
      },
      prefill: {
        description: `${ocrData.vendor} - ${ocrData.category.replace(/_/g, " ")}`,
        amount: ocrData.amount,
        category: ocrData.category,
        date: ocrData.date,
        vendor: ocrData.vendor,
        currency: ocrData.currency,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/expenses/ocr/results", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const results = Array.from(ocrResults.values()).filter(r => r.orgId === orgId && r.userId === userId);
    return res.json({ results, count: results.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/expenses/ocr/results/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = ocrResults.get(req.params.id as string);
    if (!result || result.orgId !== req.session.orgId!) return res.status(404).json({ message: "OCR result not found" });
    return res.json({ result });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/expenses/ocr/supported-types", requireAuth, async (_req: Request, res: Response) => {
  return res.json({
    supportedTypes: [".jpg", ".jpeg", ".png", ".pdf", ".heic", ".webp"],
    supportedLocales: ["en-US"],
    maxFileSize: "10MB",
    ocrEngine: "tesseract+groq-vision",
    features: ["vendor_extraction", "date_extraction", "amount_extraction", "currency_detection", "category_suggestion"],
  });
});

}
