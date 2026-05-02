import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { expenses, expenseCategories, glAccounts, round2, createExpenseSchema, createExpenseReportSchema, unlockExpenseReportSchema } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, createAutoJournalEntry, isGlPosted , requirePlanTier } from "./middleware";
import { sendRejectionEmail, sendExpenseApprovedEmail, sendExpenseReportApprovedEmail, sendExpenseReportReopenedEmail, getSmtpConfigFromOrg } from "../email";
import rateLimit from "express-rate-limit";

const receiptUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.userId || "anonymous",
  message: { message: "Too many receipt uploads. Please try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
});
import multer from "multer";
import path from "path";
import fs from "fs";
import { scanAndQuarantine } from "../av-scanner";
import Groq from "groq-sdk";

function serializeExpenseAmounts(row: any): any {
  if (!row) return row;
  const out = { ...row };
  if (out.amount != null) out.amount = Number(out.amount).toFixed(2);
  if (out.amountInBaseCurrency != null) out.amountInBaseCurrency = Number(out.amountInBaseCurrency).toFixed(2);
  if (out.taxAmount != null) out.taxAmount = Number(out.taxAmount).toFixed(2);
  return out;
}

export function registerExpenseRoutes(app: Express) {

// ══════════════════════════════════════════════════════════════════
// EXPENSE CATEGORIES
// ══════════════════════════════════════════════════════════════════

app.get("/api/expense-categories", requireAuth, async (req, res) => {
  try {
    const result = await storage.getActiveExpenseCategories(req.session.orgId!);
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-categories", requireAdmin, async (req, res) => {
  try {
    const { name, glCode, description } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const cat = await storage.createExpenseCategory({ orgId: req.session.orgId!, name, glCode, description });
    return res.json(cat);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/expense-categories/:id", requireAdmin, async (req, res) => {
  try {
    const { name, glCode, description, isActive } = req.body;
    const cat = await storage.updateExpenseCategory(req.params.id as string, req.session.orgId!, { name, glCode, description, isActive });
    if (!cat) return res.status(404).json({ message: "Category not found" });
    return res.json(cat);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/expense-categories/:id", requireAdmin, async (req, res) => {
  try {
    const cat = await storage.deleteExpenseCategory(req.params.id as string, req.session.orgId!);
    if (!cat) return res.status(404).json({ message: "Category not found" });
    return res.json({ ok: true });
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});

// ══════════════════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════════════════

app.get("/api/expenses", requireAdmin, async (req, res) => {
  try {
    const filters: any = {};
    if (req.query.userId) filters.userId = req.query.userId;
    if (req.query.projectId) filters.projectId = req.query.projectId;
    if (req.query.clientId) filters.clientId = req.query.clientId;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.billable) filters.billable = req.query.billable === "true";
    if (req.query.startDate) filters.startDate = req.query.startDate;
    if (req.query.endDate) filters.endDate = req.query.endDate;
    if (req.query.page) filters.page = Number(req.query.page);
    if (req.query.pageSize) filters.pageSize = Math.min(Number(req.query.pageSize), 200);
    const result = await storage.getExpenses(req.session.orgId!, filters);
    if (Array.isArray(result)) {
      return res.json(result.map(serializeExpenseAmounts));
    }
    if (result && Array.isArray((result as any).expenses)) {
      return res.json({ ...(result as any), expenses: (result as any).expenses.map(serializeExpenseAmounts) });
    }
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/expenses/unbilled-preview", requireAdmin, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).json({ message: "clientId required" });
    const orgId = req.session.orgId!;
    const rows = await storage.getBillableExpensesForClient(orgId, clientId);

    let totalAmount = 0;
    const mapped = rows.map(r => {
      const amount = Number(r.expense.amount);
      totalAmount += amount;
      return {
        id: r.expense.id,
        date: r.expense.date,
        vendor: r.expense.vendor,
        description: r.expense.description,
        categoryName: r.categoryName,
        projectName: r.projectName,
        userName: r.userName,
        amount,
      };
    });

    return res.json({
      expenses: mapped,
      totalAmount: round2(totalAmount),
      count: mapped.length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/expenses/:id", requireAuth, async (req, res) => {
  try {
    const exp = await storage.getExpenseById(req.params.id as string, req.session.orgId!);
    if (!exp) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && exp.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to view this expense" });
    }
    return res.json(serializeExpenseAmounts(exp));
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/my/expenses", requireAuth, async (req, res) => {
  try {
    const result = await storage.getMyExpenses(req.session.orgId!, req.session.userId!);
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expenses", requireAuth, async (req, res) => {
  try {
    const parsed = createExpenseSchema.parse(req.body);
    if (Number(parsed.amount) <= 0) {
      return res.status(400).json({ message: "Amount must be greater than zero" });
    }
    if (parsed.additionalReceiptUrls) {
      if (parsed.additionalReceiptUrls.length > 10000) {
        return res.status(400).json({ message: "additionalReceiptUrls payload too large" });
      }
      try {
        const arr = JSON.parse(parsed.additionalReceiptUrls);
        if (!Array.isArray(arr) || !arr.every((r: any) => typeof r.url === "string" && typeof r.filename === "string")) {
          return res.status(400).json({ message: "Invalid additionalReceiptUrls format" });
        }
      } catch { return res.status(400).json({ message: "Invalid additionalReceiptUrls JSON" }); }
    }
    const exp = await storage.createExpense({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      ...parsed,
    });
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "EXPENSE_CREATED",
      entityType: "expense",
      entityId: exp.id,
      details: { amount: exp.amount, vendor: parsed.vendor },
    });
    return res.json(exp);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/expenses/:id", requireAuth, async (req, res) => {
  try {
    const exp = await storage.getExpenseById(req.params.id as string, req.session.orgId!);
    if (!exp) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && exp.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to edit this expense" });
    }
    if (exp.status !== "DRAFT" && exp.status !== "REJECTED") {
      return res.status(400).json({ message: "Only draft or rejected expenses can be edited" });
    }
    if (exp.reportId) {
      const report = await storage.getExpenseReportById(exp.reportId, req.session.orgId!);
      if (report && report.status !== "DRAFT" && report.status !== "REJECTED") {
        return res.status(400).json({ message: "Cannot edit expenses in a submitted or approved report" });
      }
    }
    const { description, amount, date, category, vendor, notes, receiptUrl, additionalReceiptUrls, projectId, serviceId, billable } = req.body;
    const updates: Record<string, any> = {};
    if (description !== undefined) updates.description = description;
    if (amount !== undefined) updates.amount = amount;
    if (date !== undefined) updates.date = date;
    if (category !== undefined) updates.category = category;
    if (vendor !== undefined) updates.vendor = vendor;
    if (notes !== undefined) updates.notes = notes;
    if (receiptUrl !== undefined) updates.receiptUrl = receiptUrl;
    if (additionalReceiptUrls !== undefined) updates.additionalReceiptUrls = additionalReceiptUrls;
    if (projectId !== undefined) updates.projectId = projectId;
    if (serviceId !== undefined) updates.serviceId = serviceId;
    if (billable !== undefined) updates.billable = billable;
    if (exp.status === "REJECTED") {
      updates.status = "DRAFT";
      updates.rejectionReason = null;
      updates.approvedByUserId = null;
      updates.approvedAt = null;
    }
    const updated = await storage.updateExpense(req.params.id as string, req.session.orgId!, updates);
    return res.json(updated);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  try {
    const existing = await storage.getExpenseById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to delete this expense" });
    }
    const exp = await storage.deleteExpense(req.params.id as string, req.session.orgId!);
    if (!exp) return res.status(404).json({ message: "Expense cannot be deleted (must be DRAFT or REJECTED)" });
    return res.json({ ok: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

const receiptDir = path.join(process.cwd(), "uploads", "receipts");
fs.mkdirSync(receiptDir, { recursive: true });

const receiptOwners = new Map<string, string>();

function sanitizeFilename(original: string): string {
  let name = path.basename(original);
  name = name.replace(/[^\w.-]/g, "_");
  name = name.replace(/\.{2,}/g, ".");
  if (name.startsWith(".")) name = "_" + name;
  return name.substring(0, 200);
}

const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".js", ".vbs", ".wsf", ".wsh", ".ps1", ".sh", ".bash",
  ".dll", ".sys", ".cpl", ".hta", ".inf", ".reg",
  ".php", ".asp", ".aspx", ".jsp", ".cgi",
  ".svg", ".html", ".htm", ".xml", ".xhtml",
]);

const ALLOWED_RECEIPT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".pdf", ".heic", ".webp"]);
const ALLOWED_RECEIPT_MIMETYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "application/pdf"]);
const MAX_RECEIPT_FILE_SIZE = 10 * 1024 * 1024;

const MAGIC_BYTES: { ext: string; mime: string; bytes: number[]; offset?: number }[] = [
  { ext: ".jpg",  mime: "image/jpeg",      bytes: [0xFF, 0xD8, 0xFF] },
  { ext: ".jpeg", mime: "image/jpeg",      bytes: [0xFF, 0xD8, 0xFF] },
  { ext: ".png",  mime: "image/png",       bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { ext: ".gif",  mime: "image/gif",       bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ".pdf",  mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { ext: ".webp", mime: "image/webp",      bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

function detectMimeFromMagicBytes(buffer: Buffer): string | null {
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) { match = false; break; }
    }
    if (match) {
      if (sig.mime === "image/webp") {
        if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
          return "image/webp";
        }
        continue;
      }
      return sig.mime;
    }
  }
  if (buffer.length >= 12) {
    const head = buffer.subarray(0, 12);
    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
      const brand = buffer.subarray(8, 12).toString("ascii");
      if (brand === "heic" || brand === "heix" || brand === "mif1") return "image/heic";
    }
  }
  return null;
}

function validateReceiptExtensionVsMagic(ext: string, detectedMime: string): boolean {
  const extMimeMap: Record<string, string[]> = {
    ".jpg":  ["image/jpeg"],
    ".jpeg": ["image/jpeg"],
    ".png":  ["image/png"],
    ".gif":  ["image/gif"],
    ".pdf":  ["application/pdf"],
    ".webp": ["image/webp"],
    ".heic": ["image/heic"],
  };
  const allowed = extMimeMap[ext.toLowerCase()];
  return !!allowed && allowed.includes(detectedMime);
}

const receiptUpload = multer({
  dest: receiptDir,
  limits: { fileSize: MAX_RECEIPT_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname);
    const ext = path.extname(sanitized).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type "${ext}" is not allowed for security reasons`));
    }
    if (!ALLOWED_RECEIPT_EXTENSIONS.has(ext)) {
      return cb(new Error(`File extension "${ext}" is not allowed. Accepted: ${[...ALLOWED_RECEIPT_EXTENSIONS].join(", ")}`));
    }
    if (!ALLOWED_RECEIPT_MIMETYPES.has(file.mimetype) && file.mimetype !== "application/octet-stream") {
      return cb(new Error(`MIME type "${file.mimetype}" is not allowed for receipt uploads`));
    }
    if (file.originalname.includes("..") || file.originalname.includes("/") || file.originalname.includes("\\")) {
      return cb(new Error("Filename contains path traversal characters"));
    }
    cb(null, true);
  },
});

app.post("/api/expenses/upload-receipt", requireAuth, receiptUploadLimiter, (req, res, next) => {
  receiptUpload.array("receipt", 10)(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: `File exceeds the maximum size of ${MAX_RECEIPT_FILE_SIZE / (1024 * 1024)}MB` });
      }
      return res.status(400).json({ message: sanitizeErrorMessage(err) || "File upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const singleFile = req.file as Express.Multer.File | undefined;
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : [];
    if (allFiles.length === 0) return res.status(400).json({ message: "No file uploaded" });

    const results: { url: string; filename: string }[] = [];
    const renamedFiles: string[] = [];
    for (const file of allFiles) {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      if (!ALLOWED_RECEIPT_EXTENSIONS.has(ext)) {
        try { fs.unlinkSync(file.path); } catch {}
        for (const rf of renamedFiles) { try { fs.unlinkSync(rf); } catch {} }
        return res.status(400).json({ message: `File extension "${ext}" is not allowed. Accepted: ${[...ALLOWED_RECEIPT_EXTENSIONS].join(", ")}` });
      }

      const headerBuf = Buffer.alloc(16);
      let fd: number | null = null;
      try {
        fd = fs.openSync(file.path, "r");
        fs.readSync(fd, headerBuf, 0, 16, 0);
      } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch {}
      }

      const detectedMime = detectMimeFromMagicBytes(headerBuf);
      if (!detectedMime) {
        try { fs.unlinkSync(file.path); } catch {}
        for (const rf of renamedFiles) { try { fs.unlinkSync(rf); } catch {} }
        return res.status(400).json({ message: `Unable to verify file type for "${file.originalname}". File may be corrupted or an unsupported format.` });
      }

      if (!validateReceiptExtensionVsMagic(ext, detectedMime)) {
        try { fs.unlinkSync(file.path); } catch {}
        for (const rf of renamedFiles) { try { fs.unlinkSync(rf); } catch {} }
        return res.status(400).json({ message: `File extension "${ext}" does not match actual file content (detected ${detectedMime}). This file has been rejected for security reasons.` });
      }

      const avResult = await scanAndQuarantine(file.path, req.session.orgId!, req.session.userId || null, "receipt-upload");
      if (!avResult.clean) {
        for (const rf of renamedFiles) { try { fs.unlinkSync(rf); } catch {} }
        return res.status(400).json({ message: `File rejected: malware detected (${avResult.threat})`, sha256: avResult.sha256, quarantined: avResult.quarantined });
      }

      const newName = file.filename + ext;
      const destPath = path.join(receiptDir, newName);
      fs.renameSync(file.path, destPath);
      renamedFiles.push(destPath);
      receiptOwners.set(newName, req.session.userId!);
      results.push({ url: `/api/uploads/receipts/${newName}`, filename: file.originalname });
    }

    if (results.length === 1) {
      return res.json(results[0]);
    }
    return res.json({ files: results });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/uploads/receipts/:filename", requireAuth, (req, res) => {
  const fp = path.join(receiptDir, path.basename(req.params.filename as string));
  if (!fs.existsSync(fp)) return res.status(404).json({ message: "Not found" });
  return res.sendFile(fp);
});
app.post("/api/expenses/scan-receipt", requireAuth, async (req, res) => {
  try {
    const { receiptUrl } = req.body as { receiptUrl?: string };
    if (!receiptUrl) return res.status(400).json({ message: "receiptUrl required" });

    let imageBase64: string;
    let mediaType: string = "image/jpeg";
    let imagePath: string | null = null;
    let cleanupPath: string | null = null;

    if (receiptUrl.startsWith("/api/uploads/receipts/")) {
      const filename = path.basename(receiptUrl);
      const owner = receiptOwners.get(filename);
      if (owner && owner !== req.session.userId) {
        return res.status(403).json({ message: "Not authorized to scan this receipt" });
      }
      const fp = path.join(receiptDir, filename);
      if (!fs.existsSync(fp)) return res.status(404).json({ message: "Receipt file not found" });
      const ext = path.extname(filename).toLowerCase();
      if (ext === ".pdf") {
        const { execFileSync } = await import("child_process");
        const pngPrefix = path.join(receiptDir, `scan_${filename}_page`);
        try {
          execFileSync("pdftoppm", ["-png", "-f", "1", "-l", "1", "-r", "300", "-singlefile", fp, pngPrefix], { timeout: 15000 });
        } catch (pdfErr: any) {
          console.error("[OCR] pdftoppm failed:", pdfErr.message);
          return res.status(500).json({ message: "Failed to convert PDF for scanning" });
        }
        const pngPath = pngPrefix + ".png";
        if (!fs.existsSync(pngPath)) {
          return res.status(500).json({ message: "PDF conversion produced no output" });
        }
        const pngStat = fs.statSync(pngPath);
        if (pngStat.size < 100) {
          try { fs.unlinkSync(pngPath); } catch {}
          return res.status(500).json({ message: "PDF conversion produced invalid output" });
        }
        imageBase64 = fs.readFileSync(pngPath).toString("base64");
        mediaType = "image/png";
        imagePath = pngPath;
        cleanupPath = pngPath;
      } else {
        imageBase64 = fs.readFileSync(fp).toString("base64");
        imagePath = fp;
        const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
        mediaType = mimeMap[ext] || "image/jpeg";
      }
    } else {
      return res.status(400).json({ message: "Only uploaded receipt files can be scanned" });
    }

    const orgId = req.session.orgId!;
    const categories = await storage.getActiveExpenseCategories(orgId);
    const categoryNames = categories.map(c => c.name);

    const groqApiKey = process.env.GROQ_API_KEY;
    let extracted: any = null;

    if (groqApiKey) {
      console.log("[OCR] Using Groq AI vision for receipt scan");
      const Groq = (await import("groq-sdk")).default;
      const groq = new Groq({ apiKey: groqApiKey });
      const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
            {
              type: "text",
              text: `Extract ALL financial details from this receipt image. Return ONLY valid JSON with these fields:
{
"vendor": "store/vendor name",
"date": "YYYY-MM-DD format",
"subtotal": "subtotal amount as a number before tax/tip, or null",
"taxAmount": "tax amount as a number if visible, or null",
"tipAmount": "tip/gratuity amount as a number if visible, or null",
"totalAmount": "total amount as a number (no currency symbol)",
"description": "brief description of what was purchased",
"suggestedCategory": "best matching category from this list: ${JSON.stringify(categoryNames)}, or null if none match",
"currency": "3-letter currency code like USD, EUR, GBP, CAD, etc. Default USD if unclear",
"paymentMethod": "Credit Card, Debit Card, Cash, Bank Transfer, Corporate Card, Check, or null if not visible",
"lineItems": [{"description": "item name", "quantity": 1, "unitPrice": 0.00, "amount": 0.00}]
}
If a field cannot be determined, use null. If no line items are visible, use an empty array []. For the date, use today's date (${new Date().toISOString().split("T")[0]}) if not visible. Return ONLY the JSON object, no markdown or explanation.`,
            },
          ],
        }],
        max_tokens: 1000,
      });

      const text = response.choices?.[0]?.message?.content || "";
      try {
        const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        extracted = JSON.parse(jsonStr);
        if (extracted.amount && !extracted.totalAmount) extracted.totalAmount = extracted.amount;
      } catch {
        console.error("[OCR] Failed to parse Groq response:", text);
      }
    }

    if (!extracted && imagePath) {
      console.log("[OCR] Falling back to Tesseract OCR");
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      let ocrText = "";
      try {
        const result = await worker.recognize(imagePath);
        ocrText = result.data.text;
      } catch (ocrErr: any) {
        console.error("[OCR] Tesseract recognition failed:", ocrErr.message);
      } finally {
        await worker.terminate().catch(() => {});
      }
      if (ocrText && ocrText.trim().length >= 3) {
        const lines = ocrText.split("\n").map((l: string) => l.trim()).filter(Boolean);
        let vendor: string | null = null;
        for (const line of lines.slice(0, 5)) {
          const clean = line.replace(/[^a-zA-Z0-9\s&'.,-]/g, "").trim();
          if (clean.length >= 3 && clean.length <= 60 && !/^\d+[\s/.-]\d+/.test(clean) && !/^(total|subtotal|tax|date|time|receipt|order|invoice)/i.test(clean)) { vendor = clean; break; }
        }
        let totalAmount: string | null = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (/\b(total|amount\s*due|balance)\b/i.test(lines[i])) {
            const m = lines[i].match(/\$?\s*(\d[\d,.]*\.\d{2})/);
            if (m) { totalAmount = m[1].replace(/,/g, ""); break; }
          }
        }
        extracted = { vendor, totalAmount, date: null, subtotal: null, taxAmount: null, tipAmount: null, description: null, suggestedCategory: null, currency: "USD", paymentMethod: null, lineItems: [] };
      }
    }

    if (cleanupPath) { try { fs.unlinkSync(cleanupPath); } catch {} }

    if (!extracted) {
      return res.json({ vendor: null, date: null, subtotal: null, taxAmount: null, tipAmount: null, totalAmount: null, description: null, suggestedCategory: null, suggestedCategoryId: null, currency: "USD", paymentMethod: null, lineItems: [] });
    }

    let matchedCategoryId: string | null = null;
    if (extracted.suggestedCategory) {
      const match = categories.find((c: any) => c.name.toLowerCase() === extracted.suggestedCategory.toLowerCase());
      if (match) matchedCategoryId = match.id;
    }

    return res.json({
      vendor: extracted.vendor || null,
      date: extracted.date || null,
      subtotal: extracted.subtotal != null ? String(extracted.subtotal) : null,
      taxAmount: extracted.taxAmount != null ? String(extracted.taxAmount) : null,
      tipAmount: extracted.tipAmount != null ? String(extracted.tipAmount) : null,
      totalAmount: extracted.totalAmount != null ? String(extracted.totalAmount) : null,
      description: extracted.description || null,
      suggestedCategory: extracted.suggestedCategory || null,
      suggestedCategoryId: matchedCategoryId,
      currency: extracted.currency || "USD",
      paymentMethod: extracted.paymentMethod || null,
      lineItems: Array.isArray(extracted.lineItems) ? extracted.lineItems : [],
    });
  } catch (err: any) {
    console.error("[OCR] Receipt scan failed:", err);
    return res.status(500).json({ message: sanitizeErrorMessage(err) || "Receipt scan failed" });
  }
});
app.get("/api/expenses/:id/receipt", requireAuth, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const exp = await storage.getExpenseById(req.params.id as string, orgId);
    if (!exp) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && exp.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to view this receipt" });
    }

    let approvedByName: string | null = null;
    if (exp.approvedByUserId) {
      const approver = await storage.getUserById(exp.approvedByUserId);
      approvedByName = approver?.name || null;
    }

    const org = await storage.getOrg(orgId);

    // Safely convert dates — Drizzle may return string or Date
    const safeDate = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === "string") return val;
      if (val instanceof Date) return val.toISOString();
      return String(val);
    };

    const { generateExpenseReceiptPdf } = await import("../pdf");
    const pdfBuffer = await generateExpenseReceiptPdf({
      id: exp.id,
      amount: Number(exp.amount),
      date: exp.date || "",
      vendor: exp.vendor || null,
      description: exp.description || null,
      categoryName: (exp as any).categoryName || null,
      projectName: (exp as any).projectName || null,
      clientName: (exp as any).clientName || null,
      userName: (exp as any).userName || null,
      status: exp.status,
      billable: !!exp.billable,
      reimbursable: !!exp.reimbursable,
      notes: exp.notes || null,
      approvedByName,
      approvedAt: safeDate(exp.approvedAt),
      rejectionReason: exp.rejectionReason || null,
      createdAt: safeDate(exp.createdAt) || new Date().toISOString(),
    }, {
      name: org?.name || "CherryWorks Pro",
      address: org?.address,
      phone: org?.phone,
      email: org?.email,
      website: org?.website,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="expense-receipt-${exp.id.slice(0, 8)}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error("[expense-receipt] PDF generation error:", err);
    return res.status(500).json({ message: sanitizeErrorMessage(err) || "Failed to generate receipt" });
  }
});
app.post("/api/expenses/:id/submit", requireAuth, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const existing = await storage.getExpenseById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to submit this expense" });
    }
    const exp = await storage.submitExpense(req.params.id as string, req.session.orgId!, req.session.userId!);
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "EXPENSE_SUBMITTED",
      entityType: "expense",
      entityId: req.params.id as string,
      details: { amount: exp?.amount },
    });
    return res.json(exp);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expenses/:id/approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const orgId = req.session.orgId!;
    const exp = await storage.approveExpense(req.params.id as string, orgId, req.session.userId!);
    if (!exp) return res.status(404).json({ message: "Expense not found or not in SUBMITTED status" });
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "EXPENSE_APPROVED",
      entityType: "expense",
      entityId: req.params.id as string,
      details: { amount: exp.amount },
    });

    const approvedSubmitter = await storage.getUserById(exp.userId);
    if (approvedSubmitter?.email) {
      const approver = await storage.getUserById(req.session.userId!);
      const expOrgForEmail = await storage.getOrg(orgId);
      const approveSmtpConfig = getSmtpConfigFromOrg(expOrgForEmail);
      const expenseLabel = exp.description || exp.vendor || `$${Number(exp.amount).toFixed(2)}`;
      sendExpenseApprovedEmail(
        approvedSubmitter.email,
        approvedSubmitter.name,
        expenseLabel,
        approver?.name || "an administrator",
        approveSmtpConfig,
        expOrgForEmail,
      ).catch(err => console.error("[email] Failed to send expense approval email:", err.message));
    }

    let payoutWarning: string | undefined;
    if (exp.reimbursable) {
      try {
        const teamMember = await storage.getUserById(exp.userId);
        if (teamMember && teamMember.workerType !== "W2_EMPLOYEE") {
          const payout = await storage.createTeamMemberPayout({
            orgId,
            teamMemberId: exp.userId,
            amount: String(exp.amount),
            payoutDate: new Date().toISOString().split("T")[0],
            paymentMethod: teamMember.paymentMethod || "TBD",
            referenceNumber: null,
            periodStart: exp.date,
            periodEnd: exp.date,
            notes: `Expense reimbursement: ${exp.vendor || exp.description || "Expense"} ($${exp.amount})`,
            status: "PENDING",
          });
          await storage.createAuditLog({
            orgId,
            userId: req.session.userId!,
            action: "PAYOUT_AUTO_CREATED",
            entityType: "payout",
            entityId: payout.id,
            details: {
              teamMemberName: teamMember.name,
              amount: exp.amount,
              reason: "expense_reimbursement",
              expenseId: exp.id,
            },
          });
        }
      } catch (payoutErr: any) {
        console.error("[expense-reimburse] Error creating reimbursement payout:", payoutErr.message);
        payoutWarning = "Expense approved but automatic reimbursement payout failed. Please create manually.";
        try {
          await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "REIMBURSEMENT_PAYOUT_FAILED", entityType: "expense", entityId: req.params.id as string, details: { error: sanitizeErrorMessage(payoutErr) } });
        } catch {}
      }
    }

    const expOrg = await storage.getOrg(orgId);
    if (expOrg?.autoPostJournalEntries) {
      const expAmt = Number(exp.amount).toFixed(2);
      let debitAcctNum = "6009";
      if (exp.categoryId) {
        const [cat] = await db.select().from(expenseCategories).where(and(eq(expenseCategories.id, exp.categoryId), eq(expenseCategories.orgId, orgId)));
        if (cat?.glAccountId) {
          const [glAcct] = await db.select().from(glAccounts).where(and(eq(glAccounts.id, cat.glAccountId), eq(glAccounts.orgId, orgId)));
          if (glAcct) debitAcctNum = glAcct.accountNumber;
        }
      }
      const creditAcctNum = exp.reimbursable ? "2200" : "1000";
      const creditMemo = exp.reimbursable ? "Accrued Employee Reimbursable" : "Cash paid";
      await createAutoJournalEntry(orgId, exp.date, `Expense approved: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE", exp.id, [
        { accountNumber: debitAcctNum, debit: expAmt, credit: "0.00", memo: exp.vendor || exp.description || "Expense" },
        { accountNumber: creditAcctNum, debit: "0.00", credit: expAmt, memo: creditMemo },
      ], req.session.userId);
    }

    return res.json(payoutWarning ? { ...exp, payoutWarning } : exp);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expenses/:id/reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const exp = await storage.rejectExpense(req.params.id as string, req.session.orgId!, req.session.userId!, reason);
    if (!exp) return res.status(404).json({ message: "Expense not found or not in SUBMITTED status" });
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "EXPENSE_REJECTED",
      entityType: "expense",
      entityId: req.params.id as string,
      details: { amount: exp.amount, reason },
    });

    const submitter = await storage.getUserById(exp.userId);
    if (submitter?.email) {
      const reviewer = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(req.session.orgId!);
      const smtpConfig = getSmtpConfigFromOrg(org);
      const label = exp.description || exp.vendor || `$${Number(exp.amount).toFixed(2)}`;
      sendRejectionEmail(
        submitter.email, submitter.name, "expense",
        label, reason,
        reviewer?.name || "an administrator", smtpConfig, org,
      ).catch(err => console.error("[email] Failed to send expense rejection email:", err.message));
    }

    return res.json(exp);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expenses/:id/reimburse", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const exp = await storage.markExpenseReimbursed(req.params.id as string, orgId);
    if (!exp) return res.status(404).json({ message: "Expense not found or not in APPROVED status" });

    const reimbOrg = await storage.getOrg(orgId);
    if (reimbOrg?.autoPostJournalEntries) {
      const reimbAmt = Number(exp.amount).toFixed(2);
      await createAutoJournalEntry(orgId, new Date().toISOString().split("T")[0], `Expense reimbursed: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE_REIMBURSE", exp.id, [
        { accountNumber: "2200", debit: reimbAmt, credit: "0.00", memo: "Accrued Employee Reimbursable cleared" },
        { accountNumber: "1000", debit: "0.00", credit: reimbAmt, memo: "Cash disbursed" },
      ], req.session.userId);
    }

    return res.json(exp);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});

// ══════════════════════════════════════════════════════════════════
// EXPENSE REPORTS
// ══════════════════════════════════════════════════════════════════

app.get("/api/expense-reports", requireAdmin, async (req, res) => {
  try {
    const result = await storage.getExpenseReports(req.session.orgId!);
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/my/expense-reports", requireAuth, async (req, res) => {
  try {
    const result = await storage.getExpenseReports(req.session.orgId!, req.session.userId!);
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/expense-reports/:id", requireAuth, async (req, res) => {
  try {
    const report = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    if (!report) return res.status(404).json({ message: "Expense report not found" });
    if (req.session.role !== "ADMIN" && report.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to view this report" });
    }
    return res.json(report);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports", requireAuth, async (req, res) => {
  try {
    const parsed = createExpenseReportSchema.parse(req.body);
    if (parsed.expenseIds && parsed.expenseIds.length > 0) {
      const orgExpenses = await db.select({ id: expenses.id, reportId: expenses.reportId })
        .from(expenses)
        .where(and(eq(expenses.orgId, req.session.orgId!)));
      const orgExpenseMap = new Map(orgExpenses.map(e => [e.id, e]));
      for (const eid of parsed.expenseIds) {
        const found = orgExpenseMap.get(eid);
        if (!found) return res.status(400).json({ message: `Expense ${eid} not found in this organization` });
        if (found.reportId) return res.status(400).json({ message: `Expense ${eid} is already attached to another report` });
      }
    }
    const report = await storage.createExpenseReport({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      ...parsed,
    });
    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/submit", requireAuth, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const existing = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Expense report not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to submit this report" });
    }
    const report = await storage.submitExpenseReport(req.params.id as string, req.session.orgId!, req.session.userId!);
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "EXPENSE_REPORT_SUBMITTED",
      entityType: "expense_report",
      entityId: req.params.id as string,
      details: { title: report?.title, totalAmount: report?.totalAmount },
    });
    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const report = await storage.approveExpenseReport(req.params.id as string, req.session.orgId!, req.session.userId!);
    if (!report) return res.status(404).json({ message: "Report not found" });
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "EXPENSE_REPORT_APPROVED",
      entityType: "expense_report",
      entityId: req.params.id as string,
      details: { title: report.title, totalAmount: report.totalAmount },
    });

    const submitter = await storage.getUserById(report.userId);
    if (submitter?.email) {
      const approver = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(req.session.orgId!);
      const smtpConfig = getSmtpConfigFromOrg(org);
      sendExpenseReportApprovedEmail(
        submitter.email,
        submitter.name,
        report.title || "Expense Report",
        approver?.name || "an administrator",
        smtpConfig,
        org,
      ).catch(err => console.error("[email] Failed to send expense report approval email:", err.message));
    }

    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/unlock", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const parsed = unlockExpenseReportSchema.parse(req.body);
    const orgId = req.session.orgId!;
    const reportId = req.params.id as string;

    const report = await storage.reopenExpenseReport(reportId, orgId, req.session.userId!);
    if (!report) return res.status(404).json({ message: "Expense report not found" });

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "EXPENSE_REPORT_REOPENED",
      entityType: "expense_report",
      entityId: reportId,
      details: {
        targetUserId: report.userId,
        title: report.title,
        previousStatus: report.previousStatus,
        reason: parsed.reason,
      },
    });

    const submitter = await storage.getUserById(report.userId);
    if (submitter?.email) {
      const reopener = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(orgId);
      const smtpConfig = getSmtpConfigFromOrg(org);
      sendExpenseReportReopenedEmail(
        submitter.email,
        submitter.name,
        report.title || "Expense Report",
        reopener?.name || "an administrator",
        parsed.reason,
        smtpConfig,
        org,
      ).catch(err => console.error("[email] Failed to send expense report re-open email:", err.message));
    }

    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const report = await storage.rejectExpenseReport(req.params.id as string, req.session.orgId!, req.session.userId!, reason);
    if (!report) return res.status(404).json({ message: "Report not found" });

    const submitter = await storage.getUserById(report.userId);
    if (submitter?.email) {
      const reviewer = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(req.session.orgId!);
      const smtpConfig = getSmtpConfigFromOrg(org);
      sendRejectionEmail(
        submitter.email, submitter.name, "expense report",
        report.title || "Expense Report", reason,
        reviewer?.name || "an administrator", smtpConfig, org,
      ).catch(err => console.error("[email] Failed to send expense report rejection email:", err.message));
    }

    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/expense-reports/:id", requireAuth, async (req, res) => {
  try {
    const existing = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Report not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized to edit this report" });
    }
    const { title, description, periodStart, periodEnd, notes } = req.body;
    if (title && title.length > 200) return res.status(400).json({ message: "Title cannot exceed 200 characters" });
    if (description && description.length > 2000) return res.status(400).json({ message: "Description cannot exceed 2000 characters" });
    if (notes && notes.length > 5000) return res.status(400).json({ message: "Notes cannot exceed 5000 characters" });
    const report = await storage.updateExpenseReport(req.params.id as string, req.session.orgId!, {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(periodStart !== undefined && { periodStart }),
      ...(periodEnd !== undefined && { periodEnd }),
      ...(notes !== undefined && { notes }),
    });
    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/add-expense", requireAuth, async (req, res) => {
  try {
    const { expenseId } = req.body;
    if (!expenseId) return res.status(400).json({ message: "expenseId is required" });
    const existing = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Report not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    const expense = await storage.getExpenseById(expenseId, req.session.orgId!);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    if (req.session.role !== "ADMIN" && expense.userId !== req.session.userId) {
      return res.status(403).json({ message: "Can only add your own expenses" });
    }
    if (expense.status !== "DRAFT") {
      return res.status(400).json({ message: "Only draft expenses can be added to a report" });
    }
    await storage.addExpenseToReport(req.params.id as string, expenseId, req.session.orgId!, req.session.userId!);
    const report = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/remove-expense", requireAuth, async (req, res) => {
  try {
    const { expenseId } = req.body;
    if (!expenseId) return res.status(400).json({ message: "expenseId is required" });
    const existing = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    if (!existing) return res.status(404).json({ message: "Report not found" });
    if (req.session.role !== "ADMIN" && existing.userId !== req.session.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    await storage.removeExpenseFromReport(req.params.id as string, expenseId, req.session.orgId!);
    const report = await storage.getExpenseReportById(req.params.id as string, req.session.orgId!);
    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expense-reports/:id/reimburse", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const report = await storage.reimburseExpenseReport(req.params.id as string, orgId, req.session.userId!);
    if (!report) return res.status(404).json({ message: "Report not found" });

    const org = await storage.getOrg(orgId);
    if (org?.autoPostJournalEntries) {
      const reportDetail = await storage.getExpenseReportById(req.params.id as string, orgId);
      if (reportDetail?.expenses) {
        for (const exp of reportDetail.expenses) {
          if (exp.reimbursable) {
            const amt = Number(exp.amount).toFixed(2);
            await createAutoJournalEntry(orgId, exp.date, `Expense reimbursed (Report: ${report.title}): ${exp.vendor || exp.description || "Expense"}`, "EXPENSE_REIMBURSE", exp.id, [
              { accountNumber: "2200", debit: amt, credit: "0.00", memo: "Reimbursement paid" },
              { accountNumber: "1000", debit: "0.00", credit: amt, memo: "Cash paid" },
            ], req.session.userId);
          }
        }
      }
    }

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "EXPENSE_REPORT_REIMBURSED",
      entityType: "expense_report",
      entityId: req.params.id as string,
      details: { title: report.title, totalAmount: report.totalAmount },
    });

    return res.json(report);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/expenses/:id/post-gl", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const exp = await storage.getExpenseById(req.params.id as string, orgId);
    if (!exp) return res.status(404).json({ message: "Expense not found" });
    if (exp.status !== "APPROVED" && exp.status !== "REIMBURSED") {
      return res.status(400).json({ message: "Only approved or reimbursed expenses can be posted to GL" });
    }
    if (exp.reportId) {
      const report = await storage.getExpenseReportById(exp.reportId, orgId);
      if (report && report.status !== "APPROVED") {
        return res.status(400).json({ message: "Expense report must be approved before posting entries to GL" });
      }
    }

    await storage.seedDefaultGLAccounts(orgId);

    if (await isGlPosted(orgId, "EXPENSE", exp.id)) {
      return res.status(400).json({ message: "Expense already posted to GL" });
    }

    const expAmt = Number(exp.amount).toFixed(2);
    let debitAcctNum = "6009";
    if (exp.categoryId) {
      const [cat] = await db.select().from(expenseCategories).where(and(eq(expenseCategories.id, exp.categoryId), eq(expenseCategories.orgId, orgId)));
      if (cat?.glAccountId) {
        const [glAcct] = await db.select().from(glAccounts).where(and(eq(glAccounts.id, cat.glAccountId), eq(glAccounts.orgId, orgId)));
        if (glAcct) debitAcctNum = glAcct.accountNumber;
      }
    }
    const creditAcctNum = exp.reimbursable ? "2200" : "1000";
    const creditMemo = exp.reimbursable ? "Accrued Employee Reimbursable" : "Cash paid";
    await createAutoJournalEntry(orgId, exp.date, `Expense approved: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE", exp.id, [
      { accountNumber: debitAcctNum, debit: expAmt, credit: "0.00", memo: exp.vendor || exp.description || "Expense" },
      { accountNumber: creditAcctNum, debit: "0.00", credit: expAmt, memo: creditMemo },
    ], req.session.userId);

    if (exp.status === "REIMBURSED" && exp.reimbursable) {
      const alreadyReimbPosted = await isGlPosted(orgId, "EXPENSE_REIMBURSE", exp.id);
      if (!alreadyReimbPosted) {
        await createAutoJournalEntry(orgId, new Date().toISOString().split("T")[0], `Expense reimbursed: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE_REIMBURSE", exp.id, [
          { accountNumber: "2200", debit: expAmt, credit: "0.00", memo: "Accrued Employee Reimbursable cleared" },
          { accountNumber: "1000", debit: "0.00", credit: expAmt, memo: "Cash disbursed" },
        ], req.session.userId);
      }
    }

    return res.json({ ok: true, message: `Expense of $${expAmt} posted to GL` });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
