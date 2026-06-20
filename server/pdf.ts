import type { InvoiceLine } from "@shared/schema";
import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";
import type { DetailItem } from "./invoice-details";
import { formatHM } from "./invoice-details";
// Re-export so existing imports (`server/pdf.ts` is the historical home
// of this guard, and `tests/unit/pdf-logo-loader-ssrf.test.ts` imports
// it from here) keep working after the Task #474 extraction.
import { isAllowedLogoUrl } from "./lib/logo-url-allowlist";
export { isAllowedLogoUrl };

interface InvoiceWithDetails {
  id: string;
  number: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  subtotal: string;
  discountType: string;
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  notes: string | null;
  clientName: string;
  clientEmail: string;
  lines: InvoiceLine[];
  publicToken?: string | null;
  currency?: string;
}

// Renders the per-line time-entry block. Caller passes
// `onPageBreak()` which must add a new page and return the new
// top-y; this helper then re-emits its own column header on every
// continuation page. Returns the new y cursor.
function drawDetailBlock(
  doc: InstanceType<typeof PDFDocument>,
  startY: number,
  items: DetailItem[],
  opts: {
    leftX: number;
    rightX: number;
    bottomLimit: number;
    accentColor: string;
    mutedColor: string;
    textColor: string;
    onPageBreak: () => number;
  },
): number {
  const { leftX, rightX, bottomLimit, accentColor, mutedColor, textColor, onPageBreak } = opts;
  const indent = 12;
  const blockLeft = leftX + indent;
  const blockRight = rightX - 4;
  const blockW = blockRight - blockLeft;
  const cTime = blockLeft;
  const cTimeW = 60;
  const cProject = cTime + cTimeW + 6;
  const cProjectW = 90;
  const cTicket = cProject + cProjectW + 6;
  const cTicketW = 50;
  const cDesc = cTicket + cTicketW + 6;
  const cTagW = 52;
  const cHrsW = 34;
  const cTag = blockRight - cTagW;
  const cHrs = cTag - 6 - cHrsW;
  const cDescW = cHrs - 6 - cDesc;

  let y = startY + 4;

  const drawHeader = (continued: boolean): number => {
    doc.fontSize(7).font("Helvetica-Bold").fillColor(mutedColor);
    const label = continued ? "TIME (cont.)" : "TIME";
    doc.text(label, cTime, y, { width: cTimeW, characterSpacing: 0.5 });
    doc.text("PROJECT", cProject, y, { width: cProjectW, characterSpacing: 0.5 });
    doc.text("TICKET", cTicket, y, { width: cTicketW, characterSpacing: 0.5 });
    doc.text("DESCRIPTION", cDesc, y, { width: cDescW, characterSpacing: 0.5 });
    doc.text("HRS", cHrs, y, { width: cHrsW, align: "right", characterSpacing: 0.5 });
    doc.text("STATUS", cTag, y, { width: cTagW, align: "right", characterSpacing: 0.5 });
    y += 11;
    doc.moveTo(blockLeft, y - 2).lineTo(blockRight, y - 2)
      .strokeColor("#cbd5e1").lineWidth(0.6).stroke();
    return y;
  };

  drawHeader(false);

  const ensureSpace = (rows: number, rowH: number = 12) => {
    if (y + rows * rowH > bottomLimit) {
      y = onPageBreak();
      drawHeader(true);
    }
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "day") {
      ensureSpace(2, 14);
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(textColor)
        .text(it.weekday, cTime, y, { width: blockW - 60, characterSpacing: 0.5 });
      doc.fontSize(8).font("Helvetica").fillColor(mutedColor)
        .text(`${formatHM(it.totalHours)} h`, cTime, y, { width: blockW, align: "right" });
      y += 14;
      doc.moveTo(blockLeft, y - 2).lineTo(blockRight, y - 2)
        .strokeColor("#e5e7eb").lineWidth(0.4).stroke();
    } else if (it.kind === "entry") {
      const timeText = it.startTime && it.endTime
        ? `${it.startTime}–${it.endTime}`
        : "—";
      doc.fontSize(8);
      const descText = it.description || "";
      const projectText = it.project || "";
      doc.font("Helvetica");
      const descH = descText
        ? doc.heightOfString(descText, { width: cDescW, lineGap: 1 })
        : 11;
      const projectH = projectText
        ? doc.heightOfString(projectText, { width: cProjectW })
        : 11;
      const rowH = Math.max(12, descH, projectH) + 2;
      ensureSpace(1, rowH);
      doc.fontSize(8).font("Helvetica").fillColor(mutedColor)
        .text(timeText, cTime, y, { width: cTimeW });
      doc.font("Helvetica").fillColor(textColor)
        .text(projectText, cProject, y, { width: cProjectW });
      doc.font("Helvetica-Bold").fillColor(textColor)
        .text(it.ticket || "", cTicket, y, { width: cTicketW });
      doc.font("Helvetica").fillColor(mutedColor)
        .text(descText, cDesc, y, { width: cDescW, lineGap: 1 });
      doc.font("Helvetica").fillColor(textColor)
        .text(formatHM(it.hours), cHrs, y, { width: cHrsW, align: "right" });
      doc.fontSize(7).fillColor(it.billable ? accentColor : "#94a3b8")
        .text(it.billable ? "BILLABLE" : "UNBILLED", cTag, y, { width: cTagW, align: "right", characterSpacing: 0.5 });
      y += rowH;
    } else if (it.kind === "week") {
      ensureSpace(1, 14);
      y += 2;
      doc.moveTo(blockLeft, y).lineTo(blockRight, y)
        .strokeColor("#e5e7eb").lineWidth(0.4).stroke();
      y += 4;
      const wkLabel = `This week: ${formatHM(it.billableHours)} billable + ${formatHM(it.internalHours)} unbilled = ${formatHM(it.totalHours)}`;
      doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(mutedColor)
        .text(wkLabel, cTime, y, { width: blockW, align: "right" });
      doc.font("Helvetica");
      y += 12;
    }
  }

  return y + 4;
}

export interface OrgBranding {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  invoiceTheme?: string | null;
  dateLocale?: string | null;
  dateFormat?: string | null;
}

const VALID_CURRENCIES = new Set(['USD','EUR','GBP','CAD','AUD','JPY','CHF','CNY','INR','MXN','BRL','ZAR','NZD','SGD','HKD','KRW','SEK','NOK','DKK','PLN','CZK','HUF','ILS','THB','PHP','MYR','IDR','TWD','AED','SAR','QAR','KWD','BHD','OMR','TRY','RUB','NGN','KES','GHS','EGP','PKR','BDT','VND','CLP','COP','PEN','ARS']);

function validateCurrency(code: string | undefined | null): string {
  const upper = (code || 'USD').toUpperCase();
  return VALID_CURRENCIES.has(upper) ? upper : 'USD';
}

interface ThemeColors {
  headerBg: string;
  headerText: string;
  accent: string;
  accentLight: string;
  text: string;
  textMuted: string;
  tableBg: string;
  tableBorder: string;
  totalColor: string;
  footerText: string;
  negativeColor: string;
}

function getTheme(name: string): ThemeColors {
  switch (name) {
    case "modern":
      return {
        headerBg: "#0f172a", headerText: "#ffffff", accent: "#c9a44a",
        accentLight: "#f5e6b8", text: "#0f172a", textMuted: "#64748b",
        tableBg: "#f1f5f9", tableBorder: "#cbd5e1", totalColor: "#c9a44a",
        footerText: "#94a3b8", negativeColor: "#b91c1c",
      };
    case "minimal":
      return {
        headerBg: "#ffffff", headerText: "#0f172a", accent: "#0f172a",
        accentLight: "#f1f5f9", text: "#0f172a", textMuted: "#94a3b8",
        tableBg: "#ffffff", tableBorder: "#e2e8f0", totalColor: "#0f172a",
        footerText: "#cbd5e1", negativeColor: "#b91c1c",
      };
    case "bold":
      return {
        headerBg: "#cf3339", headerText: "#ffffff", accent: "#cf3339",
        accentLight: "#fef2f2", text: "#0f172a", textMuted: "#475569",
        tableBg: "#fef2f2", tableBorder: "#fecaca", totalColor: "#cf3339",
        footerText: "#94a3b8", negativeColor: "#b91c1c",
      };
    case "classic":
      return {
        headerBg: "#ffffff", headerText: "#0f172a", accent: "#c9a44a",
        accentLight: "#faf6ec", text: "#0f172a", textMuted: "#64748b",
        tableBg: "#f8f9fb", tableBorder: "#e2e8f0", totalColor: "#0f172a",
        footerText: "#94a3b8", negativeColor: "#b91c1c",
      };
    default:
      return {
        headerBg: "#ffffff", headerText: "#0f172a", accent: "#c9a44a",
        accentLight: "#faf6ec", text: "#0f172a", textMuted: "#64748b",
        tableBg: "#ffffff", tableBorder: "#e5e7eb", totalColor: "#0f172a",
        footerText: "#94a3b8", negativeColor: "#b91c1c",
      };
  }
}

const logoBaseDir = path.join(process.cwd(), "uploads", "logos");

// Bounded in-memory cache of resolved logo bytes keyed by logoUrl. Each
// entry expires after LOGO_CACHE_TTL_MS so a logo replaced via the
// settings UI shows up on the next PDF generation without a server
// restart. Negative results (null bytes) are cached too so a stale URL
// doesn't trigger a network round-trip on every generation.
const LOGO_CACHE_TTL_MS = 5 * 60 * 1000;
const LOGO_CACHE_MAX = 64;
const logoBytesCache = new Map<string, { bytes: Buffer | null; expiresAt: number }>();

function getCachedLogo(key: string): Buffer | null | undefined {
  const hit = logoBytesCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    logoBytesCache.delete(key);
    return undefined;
  }
  return hit.bytes;
}

function setCachedLogo(key: string, bytes: Buffer | null): void {
  if (logoBytesCache.size >= LOGO_CACHE_MAX) {
    const firstKey = logoBytesCache.keys().next().value;
    if (firstKey) logoBytesCache.delete(firstKey);
  }
  logoBytesCache.set(key, { bytes, expiresAt: Date.now() + LOGO_CACHE_TTL_MS });
}

function deriveBaseUrl(): string | null {
  const fromEnv = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;
  return null;
}

// SSRF guard for logo URLs lives in `server/lib/logo-url-allowlist.ts`
// (Task #474). `isAllowedLogoUrl` is imported and re-exported at the
// top of this file so legacy callers and the regression suite keep
// working unchanged.

// Loads logo image bytes for embedding into a PDF. Accepts:
//   - https:// URLs whose host is in our allowlist (APP_BASE_URL /
//     REPLIT_DOMAINS) AND whose path starts with one of our public
//     object-storage / legacy uploads prefixes — used by hosted logos.
//   - /api/public-objects/... or /api/uploads/logos/... relative paths
//     (resolved against APP_BASE_URL / REPLIT_DOMAINS, with a local-disk
//     fallback for legacy `/api/uploads/logos/` URLs that may still exist
//     pre-migration)
//   - null/undefined → null
// Any error (404, network failure, decode failure) returns null silently
// so the PDF still renders without a logo. Anything outside the
// allowlist (e.g. attacker-supplied http://169.254.169.254/) is rejected
// silently — no fetch is issued.
//
// The SSRF guard is pinned by `tests/unit/pdf-logo-loader-ssrf.test.ts`
// (Task #470). That suite also covers the parallel guard in PATCH
// /api/org/settings, so changes here should keep both call sites in sync.
export async function loadLogoBytes(
  logoUrl: string | null | undefined,
): Promise<Buffer | null> {
  if (!logoUrl) return null;
  const cacheKey = logoUrl;
  const cached = getCachedLogo(cacheKey);
  if (cached !== undefined) return cached;

  // Local-disk fast path for legacy /api/uploads/logos/<file> URLs that
  // were uploaded before the move to object storage. The migration nulls
  // these in the DB on production, but in dev the file may still exist.
  if (logoUrl.startsWith("/api/uploads/logos/")) {
    try {
      const filename = path.basename(logoUrl);
      const fp = path.join(logoBaseDir, filename);
      if (fs.existsSync(fp)) {
        const bytes = fs.readFileSync(fp);
        setCachedLogo(cacheKey, bytes);
        return bytes;
      }
    } catch {
      // fall through to URL fetch
    }
  }

  let absoluteUrl: string | null = null;
  if (/^https?:\/\//i.test(logoUrl)) {
    absoluteUrl = logoUrl;
  } else if (logoUrl.startsWith("/")) {
    const base = deriveBaseUrl();
    if (base) absoluteUrl = base + logoUrl;
  }

  if (!absoluteUrl || !isAllowedLogoUrl(absoluteUrl)) {
    setCachedLogo(cacheKey, null);
    return null;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(absoluteUrl, { signal: ctrl.signal, redirect: "manual" });
    clearTimeout(timer);
    // Reject redirects so a 302 from an allowed host can't be used to
    // bounce the fetch to an internal target.
    if (res.status >= 300 && res.status < 400) {
      setCachedLogo(cacheKey, null);
      return null;
    }
    if (!res.ok) {
      setCachedLogo(cacheKey, null);
      return null;
    }
    const arr = await res.arrayBuffer();
    const bytes = Buffer.from(arr);
    setCachedLogo(cacheKey, bytes);
    return bytes;
  } catch {
    setCachedLogo(cacheKey, null);
    return null;
  }
}

function embedLogo(
  doc: InstanceType<typeof PDFDocument>,
  logoBytes: Buffer | null,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): number {
  if (!logoBytes || logoBytes.length === 0) return 0;
  try {
    const img = (doc as any).openImage(logoBytes);
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * ratio;
    const h = img.height * ratio;
    doc.image(logoBytes, x, y, { width: w, height: h });
    return w + 12;
  } catch {
    return 0;
  }
}

function fmtDate(dateStr: string, orgDateFormat?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;

  if (orgDateFormat) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    switch (orgDateFormat) {
      case "DD/MM/YYYY": return `${day}/${m}/${y}`;
      case "YYYY-MM-DD": return `${y}-${m}-${day}`;
      case "DD.MM.YYYY": return `${day}.${m}.${y}`;
      case "MM/DD/YYYY": return `${m}/${day}/${y}`;
      default: break;
    }
  }

  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const MAX_PDF_LINE_ITEMS = Number(process.env.MAX_PDF_LINE_ITEMS) || 500;
const MAX_MEMO_LENGTH = 5000;

const LX = { ml: 56, mr: 56, mt: 48, mb: 48, pageW: 612, pageH: 792 };
const LX_CONTENT_W = LX.pageW - LX.ml - LX.mr;
const LX_RIGHT = LX.pageW - LX.mr;

function isLuxury(themeName: string): boolean {
  return themeName !== "modern" && themeName !== "minimal" && themeName !== "bold" && themeName !== "classic";
}

// X coordinate where the right-side meta block (INVOICE NO / STATUS /
// ISSUED / DUE) begins. Kept in sync with drawLuxuryMetaBlock's labelX.
const LX_META_LABEL_X = 380;

function drawLuxuryHeader(
  doc: InstanceType<typeof PDFDocument>,
  orgName: string,
  orgAddress: string,
  orgPhone: string,
  orgEmail: string,
  orgWebsite: string,
  _docTypeLabel: string,
  logoBytes: Buffer | null,
): number {
  const theme = getTheme("luxury");
  const y = LX.mt;
  const logoW = embedLogo(doc, logoBytes, LX.ml, y, 48, 48);
  const nameX = LX.ml + logoW;
  // Reserve a 16pt gutter before the meta block so descenders / accent
  // rule never touch the right column. Clamped to ≥160 so very wide
  // logos still leave usable name width (PDFKit will ellipsize the rest).
  const nameMaxW = Math.max(160, LX_META_LABEL_X - 16 - nameX);
  doc.fontSize(28).fillColor(theme.headerText).font("Helvetica-Bold")
    .text(orgName, nameX, y, {
      characterSpacing: 1.5,
      width: nameMaxW,
      ellipsis: true,
      lineBreak: false,
    });
  const nameH = doc.heightOfString(orgName, {
    width: nameMaxW,
    characterSpacing: 1.5,
    lineBreak: false,
  });
  const accentY = y + nameH + 4;
  doc.moveTo(nameX, accentY).lineTo(nameX + 60, accentY)
    .strokeColor(theme.accent).lineWidth(2).stroke();

  // Per-field measured height — multi-line addresses (e.g. street + city
  // separated by a literal newline) stack correctly without overrunning
  // the next field. Same nameMaxW guarantees no spill into the meta column.
  const infoMaxW = nameMaxW;
  let infoY = y + nameH + 14;
  doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica");
  const drawInfoLine = (text: string) => {
    if (!text) return;
    doc.text(text, nameX, infoY, { width: infoMaxW });
    infoY += doc.heightOfString(text, { width: infoMaxW }) + 2;
  };
  drawInfoLine(orgAddress);
  drawInfoLine(orgPhone);
  drawInfoLine(orgEmail);
  drawInfoLine(orgWebsite);

  // The right-aligned "INVOICE" / "ESTIMATE" wordmark used to live at
  // `LX_RIGHT` and competed with the meta block (which already starts
  // with "INVOICE NO"). Dropping it removes the collision; the doc type
  // is conveyed by the meta block label.

  const ruleY = Math.max(infoY + 6, y + 68);
  doc.moveTo(LX.ml, ruleY).lineTo(LX_RIGHT, ruleY)
    .strokeColor("#e5e7eb").lineWidth(0.75).stroke();

  return ruleY + 16;
}

function drawLuxuryMetaBlock(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  rows: [string, string][],
): number {
  const labelX = 380;
  const valX = 462;
  const valW = LX_RIGHT - valX;
  for (const [label, value] of rows) {
    doc.fontSize(8).fillColor("#94a3b8").font("Helvetica")
      .text(label.toUpperCase(), labelX, y, { width: 78, align: "right", characterSpacing: 1 });
    doc.fontSize(10).fillColor("#0f172a").font("Helvetica")
      .text(value, valX, y - 1, { width: valW, align: "right" });
    y += 16;
  }
  return y;
}

function drawLuxuryBillTo(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  label: string,
  clientName: string,
  clientEmail: string | null,
  clientAddress?: string | null,
): number {
  doc.fontSize(8).fillColor("#94a3b8").font("Helvetica")
    .text(label, LX.ml, y, { characterSpacing: 2 });
  y += 16;
  doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold")
    .text(clientName, LX.ml, y);
  y += 18;
  if (clientEmail) {
    doc.fontSize(10).fillColor("#64748b").font("Helvetica")
      .text(clientEmail, LX.ml, y);
    y += 18;
  }
  if (clientAddress) {
    doc.fontSize(10).fillColor("#64748b").font("Helvetica")
      .text(clientAddress, LX.ml, y, { lineGap: 4 });
    y += doc.heightOfString(clientAddress, { width: 300, lineGap: 4 }) + 8;
  }
  return y;
}

function drawLuxuryWatermark(
  doc: InstanceType<typeof PDFDocument>,
  status: string,
) {
  const isOverdue = status === "OVERDUE";
  const wmColor = isOverdue ? "#b91c1c" : "#0f172a";
  const wmOpacity = isOverdue ? 0.06 : 0.04;
  doc.save();
  doc.translate(306, 400).rotate(-30);
  doc.fontSize(110).fillColor(wmColor).opacity(wmOpacity).font("Helvetica-Bold")
    .text(status, -180, -50);
  doc.restore().opacity(1);
}

function drawLuxuryNotes(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  notes: string,
  maxLen: number,
  docLabel: string,
): number {
  const safeMemo = notes.slice(0, maxLen);
  if (notes.length > maxLen) {
    console.warn(`[pdf] ${docLabel} memo truncated from ${notes.length} to ${maxLen} chars`);
  }
  y += 10;
  if (y > 640) { doc.addPage({ size: "LETTER", margin: LX.ml }); y = LX.mt; }
  doc.fontSize(8).fillColor("#94a3b8").font("Helvetica")
    .text("NOTES", LX.ml, y, { characterSpacing: 2 });
  y += 14;
  doc.fontSize(9.5).fillColor("#64748b").font("Helvetica-Oblique")
    .text(safeMemo, LX.ml, y, { width: 400, lineGap: 4 });
  y += doc.heightOfString(safeMemo, { width: 400, lineGap: 4 }) + 16;
  return y;
}

function drawLuxuryFooter(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  orgName: string,
  pageNum: number,
  extraLine?: string | null,
) {
  y = Math.max(y + 20, 680);
  if (y > 720) { doc.addPage({ size: "LETTER", margin: LX.ml }); y = 700; }
  const cx = LX.ml + LX_CONTENT_W / 2;
  doc.moveTo(cx - 20, y).lineTo(cx + 20, y)
    .strokeColor("#c9a44a").lineWidth(0.5).stroke();
  y += 8;
  doc.moveTo(LX.ml, y).lineTo(LX_RIGHT, y)
    .strokeColor("#e5e7eb").lineWidth(0.75).stroke();
  y += 12;
  doc.fontSize(8).fillColor("#94a3b8").font("Helvetica");
  doc.text("Thank you for your business", LX.ml, y, { align: "center", width: LX_CONTENT_W });
  y += 12;
  if (extraLine) {
    doc.text(extraLine, LX.ml, y, { align: "center", width: LX_CONTENT_W });
    y += 12;
  }
  doc.text(`${orgName}  |  Page ${pageNum}`, LX.ml, y, { align: "center", width: LX_CONTENT_W });
}

const HEADER_LEFT_X = 50;
const HEADER_RIGHT_META_X = 350;
const HEADER_LEFT_GUTTER = 16;
const HEADER_RIGHT_META_W = 212;

function measureLogoWidth(
  doc: InstanceType<typeof PDFDocument>,
  logoBytes: Buffer | null,
  maxW: number,
  maxH: number,
): number {
  if (!logoBytes || logoBytes.length === 0) return 0;
  try {
    const img = (doc as any).openImage(logoBytes);
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    return img.width * ratio + 12;
  } catch {
    return 0;
  }
}

function measureHeaderInfoHeight(
  doc: InstanceType<typeof PDFDocument>,
  fontSize: number,
  maxW: number,
  lines: string[],
  gap: number = 2,
): number {
  doc.font("Helvetica").fontSize(fontSize);
  let total = 0;
  let count = 0;
  for (const line of lines) {
    if (!line) continue;
    total += doc.heightOfString(line, { width: maxW });
    count++;
  }
  if (count > 0) total += (count - 1) * gap;
  return total;
}

function drawHeaderInfoLines(
  doc: InstanceType<typeof PDFDocument>,
  textX: number,
  startY: number,
  maxW: number,
  fontSize: number,
  color: string,
  lines: string[],
  gap: number = 2,
): number {
  doc.font("Helvetica").fontSize(fontSize).fillColor(color);
  let y = startY;
  let drewAny = false;
  for (const line of lines) {
    if (!line) continue;
    if (drewAny) y += gap;
    doc.text(line, textX, y, { width: maxW });
    y += doc.heightOfString(line, { width: maxW });
    drewAny = true;
  }
  return y;
}

interface HeaderMetaRow {
  text: string;
  font?: string;
  size?: number;
  color?: string;
  gap?: number;
}

function drawHeaderMetaRows(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  startY: number,
  width: number,
  rows: HeaderMetaRow[],
): number {
  let y = startY;
  let drewAny = false;
  for (const r of rows) {
    if (!r.text) continue;
    const font = r.font ?? "Helvetica";
    const size = r.size ?? 10;
    const color = r.color ?? "#64748b";
    const gap = r.gap ?? 2;
    if (drewAny) y += gap;
    doc.font(font).fontSize(size).fillColor(color);
    doc.text(r.text, x, y, { width, align: "right" });
    y += doc.heightOfString(r.text, { width });
    drewAny = true;
  }
  return y;
}

export async function generateInvoicePdf(
  invoice: InvoiceWithDetails,
  org?: OrgBranding,
  baseUrl?: string,
  // Per-line detail items, pre-fetched by the caller (PDF draw loop
  // must stay synchronous). Undefined / empty => no detail rows.
  lineDetails?: Map<string, DetailItem[]>,
): Promise<Buffer> {
  const errors: string[] = [];
  if (!invoice.number) errors.push("Invoice number is missing");
  if (!invoice.issuedDate) errors.push("Issue date is missing");
  if (!invoice.dueDate) errors.push("Due date is missing");
  if (!invoice.clientName) errors.push("Client name is missing");
  if (!invoice.lines || invoice.lines.length === 0) errors.push("Invoice has no line items");
  if (invoice.lines && invoice.lines.length > MAX_PDF_LINE_ITEMS) {
    errors.push(`Invoice has ${invoice.lines.length} line items, exceeding the maximum of ${MAX_PDF_LINE_ITEMS}. Please split this invoice into smaller invoices.`);
  }
  if (invoice.lines?.length) {
    for (let i = 0; i < invoice.lines.length; i++) {
      const line = invoice.lines[i];
      if (line.amount == null) {
        errors.push(`Line item ${i + 1} is missing an amount`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Cannot generate PDF: ${errors.join("; ")}`);
  }

  // Resolve the logo bytes BEFORE entering the Promise executor below
  // (PDFKit's draw loop must stay synchronous; the executor cannot be
  // async without breaking the resolve/reject contract).
  const logoBytes = await loadLogoBytes(org?.logoUrl);

  return new Promise((resolve, reject) => {
    const themeName = org?.invoiceTheme || "luxury";
    const theme = getTheme(themeName);
    const luxury = isLuxury(themeName);
    const margin = luxury ? LX.ml : 50;
    const doc = new PDFDocument({ size: "LETTER", margin });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pdfCurrency = validateCurrency((invoice as any).currency);
    const fmt = (n: number | string) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency: pdfCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

    const orgName = org?.name || "CherryWorks Pro";
    const orgAddress = org?.address || "";
    const orgPhone = org?.phone || "";
    const orgEmail = org?.email || "";
    const orgWebsite = org?.website || "";
    const dateFmt = org?.dateFormat || null;
    const issuedFormatted = fmtDate(invoice.issuedDate, dateFmt);
    const dueFormatted = fmtDate(invoice.dueDate, dateFmt);

    let y: number;
    let pageNum = 1;
    const contentLeft = luxury ? LX.ml : 50;
    const contentRight = luxury ? LX_RIGHT : 562;
    const contentW = contentRight - contentLeft;

    if (luxury) {
      y = drawLuxuryHeader(doc, orgName, orgAddress, orgPhone, orgEmail, orgWebsite, "INVOICE", logoBytes);

      const metaRows: [string, string][] = [
        ["INVOICE NO", invoice.number],
        ["STATUS", invoice.status],
        ["ISSUED", issuedFormatted],
        ["DUE DATE", dueFormatted],
      ];
      drawLuxuryMetaBlock(doc, y, metaRows);

      y = drawLuxuryBillTo(doc, y, "BILL TO", invoice.clientName, invoice.clientEmail);

      if (invoice.status === "PAID" || invoice.status === "VOID" || invoice.status === "OVERDUE") {
        drawLuxuryWatermark(doc, invoice.status);
      }

      y += 20;
      const colX = [contentLeft, 310, 390, 470];
      const colW = [250, 75, 75, contentRight - 470];

      const drawTableHeader = (atY: number) => {
        doc.fontSize(8).fillColor("#94a3b8").font("Helvetica");
        doc.text("DESCRIPTION", colX[0], atY, { characterSpacing: 2 });
        doc.text("QTY", colX[1], atY, { width: colW[1], align: "right", characterSpacing: 2 });
        doc.text("RATE", colX[2], atY, { width: colW[2], align: "right", characterSpacing: 2 });
        doc.text("AMOUNT", colX[3], atY, { width: colW[3], align: "right", characterSpacing: 2 });
        atY += 14;
        doc.moveTo(contentLeft, atY).lineTo(contentRight, atY)
          .strokeColor("#e5e7eb").lineWidth(0.75).stroke();
        return atY + 10;
      };

      y = drawTableHeader(y);
      doc.font("Helvetica").fontSize(10).fillColor(theme.text);

      for (const line of invoice.lines) {
        if (y > 680) {
          drawLuxuryFooter(doc, 700, orgName, pageNum);
          pageNum++;
          doc.addPage({ size: "LETTER", margin: LX.ml });
          y = drawTableHeader(LX.mt);
          doc.font("Helvetica").fontSize(10).fillColor(theme.text);
        }

        if (line.isHeader) {
          doc.font("Helvetica-Bold").fontSize(9).fillColor(theme.text)
            .text(line.description, colX[0], y, { width: 450 });
          doc.font("Helvetica").fontSize(10).fillColor(theme.text);
          y += 20;
          continue;
        }

        const lineHeight = doc.heightOfString(line.description, { width: colW[0] });
        const rowHeight = Math.max(lineHeight, 14);
        doc.fillColor(theme.text).text(line.description, colX[0], y, { width: colW[0] });
        doc.text(Number(line.quantity).toFixed(2), colX[1], y, { width: colW[1], align: "right" });
        doc.text(fmt(line.unitRate), colX[2], y, { width: colW[2], align: "right" });
        const amt = Number(line.amount);
        doc.font("Helvetica-Bold").fillColor(amt < 0 ? theme.negativeColor : theme.text)
          .text(fmt(amt), colX[3], y, { width: colW[3], align: "right" });
        doc.font("Helvetica").fillColor(theme.text);
        y += rowHeight + 14;

        const detailItems = (line.id && lineDetails) ? lineDetails.get(line.id) : undefined;
        if (detailItems && detailItems.length > 0) {
          y = drawDetailBlock(doc, y, detailItems, {
            leftX: contentLeft,
            rightX: contentRight,
            bottomLimit: 700,
            accentColor: theme.accent || "#0f172a",
            mutedColor: "#64748b",
            textColor: theme.text,
            onPageBreak: () => {
              drawLuxuryFooter(doc, 700, orgName, pageNum);
              pageNum++;
              doc.addPage({ size: "LETTER", margin: LX.ml });
              return drawTableHeader(LX.mt);
            },
          });
          doc.font("Helvetica").fontSize(10).fillColor(theme.text);
        }

        doc.moveTo(contentLeft, y - 6).lineTo(contentRight, y - 6)
          .strokeColor("#f1f5f9").lineWidth(0.5).stroke();
      }

      y += 14;
      if (y + 120 > 720) {
        drawLuxuryFooter(doc, 700, orgName, pageNum);
        pageNum++;
        doc.addPage({ size: "LETTER", margin: LX.ml });
        y = LX.mt;
      }

      // The customer-facing "additional unbilled worklog" section was removed:
      // getInvoiceTimeEntryDetails now returns only this invoice's own line
      // entries, so there is no unallocated bucket to render here.

      const subtotal = Number(invoice.subtotal || 0);
      const discountAmt = Number(invoice.discountAmount || 0);
      const taxAmt = Number(invoice.taxAmount || 0);
      const total = Number(invoice.total || 0);
      const paidAmount = Number(invoice.paidAmount || 0);

      const totLabelX = 370;
      const totValX = 462;
      const totValW = contentRight - totValX;

      doc.fontSize(10).fillColor("#64748b").font("Helvetica");
      doc.text("Subtotal", totLabelX, y, { width: 88, align: "right" });
      doc.fillColor(theme.text).text(fmt(subtotal), totValX, y, { width: totValW, align: "right" });
      y += 18;

      if (discountAmt > 0) {
        const dType = invoice.discountType || "NONE";
        const dVal = Number(invoice.discountValue || 0);
        const dLabel = dType === "PERCENT" ? `Discount (${dVal}%)` : "Discount";
        doc.fillColor("#64748b").text(dLabel, totLabelX - 10, y, { width: 98, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.negativeColor)
          .text(`-${fmt(discountAmt)}`, totValX, y, { width: totValW, align: "right" });
        doc.font("Helvetica");
        y += 18;
      }

      if (taxAmt > 0) {
        const taxRate = Number(invoice.taxRate || 0);
        doc.fillColor("#64748b").text(`Tax (${taxRate}%)`, totLabelX, y, { width: 88, align: "right" });
        doc.fillColor(theme.text).text(fmt(taxAmt), totValX, y, { width: totValW, align: "right" });
        y += 18;
      }

      doc.moveTo(totLabelX, y).lineTo(contentRight, y)
        .strokeColor("#e5e7eb").lineWidth(0.75).stroke();
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor(theme.text)
        .text("TOTAL", totLabelX, y, { width: 88, align: "right", characterSpacing: 1.5 });
      doc.text(fmt(total), totValX, y, { width: totValW, align: "right" });
      y += 20;
      doc.moveTo(totValX + totValW - 80, y - 4).lineTo(totValX + totValW, y - 4)
        .strokeColor("#c9a44a").lineWidth(2).stroke();

      if (paidAmount > 0) {
        y += 8;
        doc.fontSize(10).font("Helvetica").fillColor("#64748b")
          .text("Amount Paid", totLabelX, y, { width: 88, align: "right" });
        doc.fillColor("#22c55e").text(fmt(paidAmount), totValX, y, { width: totValW, align: "right" });
        y += 18;
        const outstanding = total - paidAmount;
        doc.fontSize(11).font("Helvetica-Bold").fillColor(theme.text)
          .text("Balance Due", totLabelX - 10, y, { width: 98, align: "right" });
        doc.text(fmt(outstanding), totValX, y, { width: totValW, align: "right" });
        y += 24;
      }

      if (invoice.notes) {
        y = drawLuxuryNotes(doc, y, invoice.notes, MAX_MEMO_LENGTH, `Invoice ${invoice.number}`);
      }

      const hasStripe = !!process.env.STRIPE_SECRET_KEY;
      const payDomain = baseUrl
        ? baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : orgWebsite ? orgWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
      const payOnlineText = invoice.status !== "PAID" && invoice.status !== "VOID" && hasStripe && invoice.publicToken && payDomain
        ? `Pay online at ${payDomain}` : null;

      drawLuxuryFooter(doc, y, orgName, pageNum, payOnlineText);

    } else {
      let headerBottomY: number;

      if (themeName === "modern") {
        const logoW = measureLogoWidth(doc, logoBytes, 50, 50);
        const textX = 50 + logoW;
        const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
        const rightW = 162;
        const rightX = 400;

        const nameH = doc.font("Helvetica-Bold").fontSize(22)
          .heightOfString(orgName, { width: leftMaxW, lineBreak: false });
        const infoStartY = 30 + nameH + 6;
        const infoH = measureHeaderInfoHeight(doc, 10, leftMaxW, [orgPhone, orgEmail], 2);
        const numH = doc.font("Helvetica-Bold").fontSize(22)
          .heightOfString(invoice.number, { width: rightW });
        const labelH = doc.font("Helvetica").fontSize(11)
          .heightOfString("INVOICE", { width: rightW });
        const statusH = doc.font("Helvetica").fontSize(10)
          .heightOfString(invoice.status, { width: rightW });
        const rightBottom = 30 + labelH + 4 + numH + 8 + statusH;
        const leftBottom = infoStartY + infoH;
        const barH = Math.max(100, leftBottom + 16, rightBottom + 16);

        doc.rect(0, 0, 612, barH).fill(theme.headerBg);
        embedLogo(doc, logoBytes, 50, 22, 50, 50);
        doc.font("Helvetica-Bold").fontSize(22).fillColor(theme.headerText)
          .text(orgName, textX, 30, { width: leftMaxW, ellipsis: true, lineBreak: false });
        drawHeaderInfoLines(doc, textX, infoStartY, leftMaxW, 10, "#94a3b8",
          [orgPhone, orgEmail], 2);
        doc.rect(0, barH, 612, 3).fill(theme.accent);
        doc.font("Helvetica").fontSize(11).fillColor("#94a3b8")
          .text("INVOICE", rightX, 30, { align: "right", width: rightW });
        doc.font("Helvetica-Bold").fontSize(22).fillColor(theme.headerText)
          .text(invoice.number, rightX, 30 + labelH + 4, { align: "right", width: rightW });
        doc.font("Helvetica").fontSize(10).fillColor("#94a3b8")
          .text(invoice.status, rightX, 30 + labelH + 4 + numH + 8, { align: "right", width: rightW });
        headerBottomY = barH + 6;
      } else if (themeName === "bold") {
        const logoW = measureLogoWidth(doc, logoBytes, 50, 50);
        const textX = 50 + logoW;
        const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
        const rightW = HEADER_RIGHT_META_W;
        const rightX = HEADER_RIGHT_META_X;
        const infoColor = "rgba(255,255,255,0.7)";
        const metaColor = "rgba(255,255,255,0.8)";

        const nameH = doc.font("Helvetica-Bold").fontSize(26)
          .heightOfString(orgName, { width: leftMaxW, lineBreak: false });
        const infoStartY = 28 + nameH + 6;
        const infoH = measureHeaderInfoHeight(doc, 10, leftMaxW,
          [orgAddress, orgPhone, orgEmail], 2);
        const leftBottom = infoStartY + infoH;

        const numH = doc.font("Helvetica-Bold").fontSize(32)
          .heightOfString(invoice.number, { width: rightW });
        const statusH = doc.font("Helvetica").fontSize(12)
          .heightOfString(invoice.status, { width: rightW });
        const issuedH = doc.font("Helvetica").fontSize(10)
          .heightOfString(`Issued: ${issuedFormatted}`, { width: rightW });
        const dueH = doc.font("Helvetica").fontSize(10)
          .heightOfString(`Due: ${dueFormatted}`, { width: rightW });
        const rightBottom = 30 + numH + 10 + statusH + 4 + issuedH + 2 + dueH;
        const barH = Math.max(120, leftBottom + 16, rightBottom + 16);

        doc.rect(0, 0, 612, barH).fill(theme.headerBg);
        embedLogo(doc, logoBytes, 50, 20, 50, 50);
        doc.font("Helvetica-Bold").fontSize(26).fillColor(theme.headerText)
          .text(orgName, textX, 28, { width: leftMaxW, ellipsis: true, lineBreak: false });
        drawHeaderInfoLines(doc, textX, infoStartY, leftMaxW, 10, infoColor,
          [orgAddress, orgPhone, orgEmail], 2);
        doc.font("Helvetica-Bold").fontSize(32).fillColor(theme.headerText)
          .text(invoice.number, rightX, 30, { align: "right", width: rightW });
        const statusY = 30 + numH + 10;
        doc.font("Helvetica").fontSize(12).fillColor(metaColor)
          .text(invoice.status, rightX, statusY, { align: "right", width: rightW });
        const issuedY = statusY + statusH + 4;
        doc.font("Helvetica").fontSize(10).fillColor(metaColor)
          .text(`Issued: ${issuedFormatted}`, rightX, issuedY, { align: "right", width: rightW });
        doc.font("Helvetica").fontSize(10).fillColor(metaColor)
          .text(`Due: ${dueFormatted}`, rightX, issuedY + issuedH + 2, { align: "right", width: rightW });
        headerBottomY = barH + 6;
      } else if (themeName === "minimal") {
        const logoW = embedLogo(doc, logoBytes, 50, 44, 40, 40);
        const textX = 50 + logoW;
        const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
        const rightW = HEADER_RIGHT_META_W;
        const rightX = HEADER_RIGHT_META_X;

        doc.font("Helvetica").fontSize(11).fillColor(theme.textMuted)
          .text(orgName.toUpperCase(), textX, 50, {
            width: leftMaxW, characterSpacing: 3, ellipsis: true, lineBreak: false,
          });
        const leftEndY = drawHeaderInfoLines(
          doc, textX, 68, leftMaxW, 9, "#cbd5e1",
          [orgAddress, orgPhone], 2,
        );

        doc.font("Helvetica").fontSize(9).fillColor(theme.textMuted)
          .text("INVOICE", rightX + 100, 50, { align: "right", width: rightW - 100 });
        const numH = doc.font("Helvetica-Bold").fontSize(16)
          .heightOfString(invoice.number, { width: rightW });
        doc.font("Helvetica-Bold").fontSize(16).fillColor(theme.text)
          .text(invoice.number, rightX, 64, { align: "right", width: rightW });
        const datesY = 64 + numH + 4;
        doc.font("Helvetica").fontSize(9).fillColor(theme.textMuted)
          .text(`${issuedFormatted}  ·  Due ${dueFormatted}`, rightX, datesY, {
            align: "right", width: rightW,
          });
        const datesH = doc.heightOfString(`${issuedFormatted}  ·  Due ${dueFormatted}`, { width: rightW });
        const rightEndY = datesY + datesH;

        const dividerY = Math.max(leftEndY, rightEndY) + 6;
        doc.moveTo(50, dividerY).lineTo(562, dividerY)
          .strokeColor("#e2e8f0").lineWidth(0.3).stroke();
        headerBottomY = dividerY + 10;
      } else {
        const logoW = embedLogo(doc, logoBytes, 50, 44, 50, 50);
        const textX = 50 + logoW;
        const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
        const rightW = HEADER_RIGHT_META_W;
        const rightX = HEADER_RIGHT_META_X;

        doc.font("Helvetica-Bold").fontSize(22).fillColor(theme.headerText)
          .text(orgName, textX, 50, {
            width: leftMaxW, ellipsis: true, lineBreak: false,
          });
        const nameH = doc.heightOfString(orgName, { width: leftMaxW, lineBreak: false });
        const leftEndY = drawHeaderInfoLines(
          doc, textX, 50 + nameH + 6, leftMaxW, 10, theme.textMuted,
          [orgAddress, orgPhone, orgEmail, orgWebsite], 2,
        );

        doc.font("Helvetica-Bold").fontSize(24).fillColor(theme.text)
          .text(invoice.number, rightX, 50, { align: "right", width: rightW });
        const numH = doc.heightOfString(invoice.number, { width: rightW });
        const rightEndY = drawHeaderMetaRows(
          doc, rightX, 50 + numH + 6, rightW,
          [
            { text: `Status: ${invoice.status}`, size: 11, color: theme.textMuted },
            { text: `Issued: ${issuedFormatted}`, size: 11, color: theme.textMuted },
            { text: `Due: ${dueFormatted}`, size: 11, color: theme.textMuted },
          ],
        );
        headerBottomY = Math.max(leftEndY, rightEndY);
      }

      y = headerBottomY;
      if (themeName === "modern") {
        doc.font("Helvetica").fontSize(10).fillColor(theme.textMuted);
        doc.text(`Issued: ${issuedFormatted}`, 50, y + 14);
        doc.text(`Due: ${dueFormatted}`, 200, y + 14);
        y += 14 + doc.heightOfString(`Issued: ${issuedFormatted}`) + 2;
      }

      y = Math.max(y, themeName === "minimal" ? 110 : 140) + 16;
      doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica-Bold").text("BILL TO", 50, y, { characterSpacing: themeName === "minimal" ? 2 : 1 });
      y += 16;
      doc.fontSize(13).fillColor(theme.text).font("Helvetica-Bold").text(invoice.clientName, 50, y);
      y += 18;
      if (invoice.clientEmail) {
        doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica").text(invoice.clientEmail, 50, y);
        y += 16;
      }

      if (invoice.status === "PAID" || invoice.status === "VOID") {
        doc.save();
        doc.translate(300, 400).rotate(-30);
        const wmColor = invoice.status === "PAID" ? "#0f172a" : "#0f172a";
        doc.fontSize(100).fillColor(wmColor).opacity(0.04).font("Helvetica-Bold").text(invoice.status, -150, -50);
        doc.restore().opacity(1);
      }

      y += 28;
      const colX = [50, 300, 380, 460];
      const colW = [245, 75, 75, 80];

      const drawTableHeader = (atY: number) => {
        if (themeName === "minimal") {
          doc.moveTo(50, atY).lineTo(562, atY).strokeColor(theme.tableBorder).lineWidth(0.5).stroke();
          atY += 6;
        } else if (themeName === "bold") {
          doc.rect(50, atY, 512, 26).fill(theme.headerBg);
        } else if (themeName === "modern") {
          doc.rect(50, atY, 512, 26).fill(theme.headerBg);
        } else {
          doc.rect(50, atY, 512, 24).fill(theme.tableBg);
        }
        const hdrColor = (themeName === "bold" || themeName === "modern") ? "#ffffff" : theme.textMuted;
        doc.fontSize(9).fillColor(hdrColor).font("Helvetica-Bold");
        const hdrY = themeName === "minimal" ? atY + 2 : atY + 7;
        doc.text("DESCRIPTION", colX[0] + 6, hdrY);
        doc.text("QTY", colX[1] + 6, hdrY, { width: colW[1], align: "right" });
        doc.text("RATE", colX[2] + 6, hdrY, { width: colW[2], align: "right" });
        doc.text("AMOUNT", colX[3] + 6, hdrY, { width: colW[3], align: "right" });
        return themeName === "minimal" ? atY + 22 : atY + 28;
      };

      y = drawTableHeader(y);

      doc.font("Helvetica").fontSize(11).fillColor(theme.text);
      for (const line of invoice.lines) {
        if (y > 680) {
          doc.addPage();
          y = drawTableHeader(50);
          doc.font("Helvetica").fontSize(11).fillColor(theme.text);
        }

        if (line.isHeader) {
          doc.rect(50, y - 2, 512, 20).fill(theme.tableBg || "#f1f5f9");
          doc.font("Helvetica-Bold").fontSize(10).fillColor(theme.text).text(line.description, colX[0] + 6, y, { width: 500 });
          doc.font("Helvetica").fontSize(11).fillColor(theme.text);
          y += 24;
          continue;
        }

        const lineHeight = doc.heightOfString(line.description, { width: colW[0] });
        const rowHeight = Math.max(lineHeight, 16);
        doc.text(line.description, colX[0] + 6, y, { width: colW[0] });
        doc.text(Number(line.quantity).toFixed(2), colX[1] + 6, y, { width: colW[1], align: "right" });
        doc.text(fmt(line.unitRate), colX[2] + 6, y, { width: colW[2], align: "right" });
        const lineAmt = Number(line.amount);
        doc.font("Helvetica-Bold").fillColor(lineAmt < 0 ? theme.negativeColor : theme.accent)
          .text(fmt(lineAmt), colX[3] + 6, y, { width: colW[3], align: "right" });
        doc.font("Helvetica").fillColor(theme.text);
        y += rowHeight + 8;
        doc.moveTo(50, y).lineTo(562, y).strokeColor(theme.tableBorder).lineWidth(themeName === "minimal" ? 0.3 : 0.5).stroke();
        y += 6;

        const detailItems = lineDetails?.get(line.id);
        if (detailItems && detailItems.length > 0) {
          y = drawDetailBlock(doc, y, detailItems, {
            leftX: 50,
            rightX: 562,
            bottomLimit: 700,
            accentColor: theme.accent,
            mutedColor: theme.textMuted,
            textColor: theme.text,
            onPageBreak: () => {
              doc.addPage();
              const ny = drawTableHeader(50);
              doc.font("Helvetica").fontSize(11).fillColor(theme.text);
              return ny;
            },
          });
          doc.font("Helvetica").fontSize(11).fillColor(theme.text);
        }
      }

      y += 16;
      if (y + 120 > 720) { doc.addPage(); y = 50; }

      // The customer-facing "additional unbilled worklog" section was removed:
      // getInvoiceTimeEntryDetails now returns only this invoice's own line
      // entries, so there is no unallocated bucket to render here.

      const subtotal = Number(invoice.subtotal || 0);
      const discountAmt = Number(invoice.discountAmount || 0);
      const taxAmt = Number(invoice.taxAmount || 0);
      const total = Number(invoice.total || 0);
      const paidAmount = Number(invoice.paidAmount || 0);

      doc.fontSize(11).fillColor(theme.textMuted).font("Helvetica");
      doc.text("Subtotal", 380, y, { width: 80, align: "right" });
      doc.font("Helvetica-Bold").fillColor(theme.text).text(fmt(subtotal), 465, y, { width: 97, align: "right" });
      y += 20;

      if (discountAmt > 0) {
        const dType = invoice.discountType || "NONE";
        const dVal = Number(invoice.discountValue || 0);
        const dLabel = dType === "PERCENT" ? `Discount (${dVal}%)` : "Discount";
        doc.font("Helvetica").fillColor(theme.textMuted).text(dLabel, 360, y, { width: 100, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.negativeColor).text(`-${fmt(discountAmt)}`, 465, y, { width: 97, align: "right" });
        y += 20;
      }

      if (taxAmt > 0) {
        const taxRate = Number(invoice.taxRate || 0);
        doc.font("Helvetica").fillColor(theme.textMuted).text(`Tax (${taxRate}%)`, 380, y, { width: 80, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.text).text(fmt(taxAmt), 465, y, { width: 97, align: "right" });
        y += 20;
      }

      if (themeName === "bold") {
        doc.rect(370, y, 192, 32).fill(theme.accent);
        doc.fontSize(14).font("Helvetica-Bold").fillColor("#ffffff").text("TOTAL", 380, y + 8, { width: 80, align: "right" });
        doc.text(fmt(total), 465, y + 8, { width: 90, align: "right" });
        y += 40;
      } else {
        doc.moveTo(380, y).lineTo(562, y).strokeColor(theme.accent).lineWidth(themeName === "minimal" ? 0.5 : 1.5).stroke();
        y += 8;
        doc.fontSize(16).font("Helvetica-Bold").fillColor(theme.text).text("Total", 380, y, { width: 80, align: "right" });
        doc.fillColor(theme.totalColor).text(fmt(total), 465, y, { width: 97, align: "right" });
        y += 28;
      }

      if (paidAmount > 0) {
        doc.fontSize(11).font("Helvetica").fillColor(theme.textMuted).text("Paid", 380, y, { width: 80, align: "right" });
        doc.font("Helvetica-Bold").fillColor("#22c55e").text(fmt(paidAmount), 465, y, { width: 97, align: "right" });
        y += 20;
        const outstanding = total - paidAmount;
        doc.fontSize(13).font("Helvetica-Bold").fillColor(theme.text).text("Balance Due", 360, y, { width: 100, align: "right" });
        doc.fillColor(theme.totalColor).text(fmt(outstanding), 465, y, { width: 97, align: "right" });
        y += 28;
      }

      if (invoice.notes) {
        const safeMemo = invoice.notes.slice(0, MAX_MEMO_LENGTH);
        if (invoice.notes.length > MAX_MEMO_LENGTH) {
          console.warn(`[pdf] Invoice ${invoice.number} memo truncated from ${invoice.notes.length} to ${MAX_MEMO_LENGTH} chars`);
        }
        y += 8;
        if (y > 640) { doc.addPage(); y = 50; }
        doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica-Bold").text("NOTES", 50, y, { characterSpacing: 1 });
        y += 14;
        doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica").text(safeMemo, 50, y, { width: 400 });
        y += doc.heightOfString(safeMemo, { width: 400 }) + 16;
      }

      const hasStripe = !!process.env.STRIPE_SECRET_KEY;
      const payDomain = baseUrl
        ? baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : orgWebsite
          ? orgWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")
          : null;
      const payOnlineText = invoice.status !== "PAID" && invoice.status !== "VOID" && hasStripe && invoice.publicToken && payDomain
        ? `Pay online at ${payDomain}`
        : null;

      y = Math.max(y + 20, 670);
      if (y > 710) { doc.addPage(); y = 690; }

      if (themeName === "bold") {
        doc.rect(0, y, 612, 72).fill("#0f172a");
        doc.fontSize(10).fillColor("#94a3b8").font("Helvetica");
        const footY = y + 14;
        doc.text("Thank you for your business.", 50, footY, { align: "center", width: 512 });
        if (payOnlineText) {
          doc.fontSize(9).fillColor("#64748b").text(payOnlineText, 50, footY + 18, { align: "center", width: 512 });
        }
        doc.fontSize(9).fillColor("#64748b").text(orgName, 50, footY + (payOnlineText ? 34 : 18), { align: "center", width: 512 });
      } else if (themeName === "modern") {
        doc.rect(0, y, 612, 3).fill(theme.accent);
        y += 16;
        doc.fontSize(10).fillColor(theme.footerText).font("Helvetica");
        doc.text("Thank you for your business.", 50, y, { align: "center", width: 512 });
        y += 16;
        if (payOnlineText) {
          doc.fontSize(9).text(payOnlineText, 50, y, { align: "center", width: 512 });
          y += 14;
        }
        doc.fontSize(9).text(orgName, 50, y, { align: "center", width: 512 });
      } else {
        doc.moveTo(50, y).lineTo(562, y).strokeColor(theme.tableBorder).lineWidth(themeName === "minimal" ? 0.3 : 0.5).stroke();
        y += 14;
        doc.fontSize(10).fillColor(theme.footerText).font("Helvetica");
        doc.text("Thank you for your business.", 50, y, { align: "center", width: 512 });
        y += 16;
        if (payOnlineText) {
          doc.fontSize(9).text(payOnlineText, 50, y, { align: "center", width: 512 });
          y += 14;
        }
        doc.fontSize(9).text(orgName, 50, y, { align: "center", width: 512 });
      }
    }

    doc.end();
  });
}

interface EstimateWithDetails {
  id: string;
  number: string;
  status: string;
  issuedDate: string;
  expiryDate: string | null;
  subtotal: string;
  discountType: string;
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  notes: string | null;
  clientName: string;
  clientEmail: string;
  lines: { description: string; quantity: string; unitRate: string; amount: string }[];
}

export async function generateEstimatePdf(
  estimate: EstimateWithDetails,
  org?: OrgBranding,
): Promise<Buffer> {
  if (estimate.lines && estimate.lines.length > MAX_PDF_LINE_ITEMS) {
    throw new Error(`Estimate has ${estimate.lines.length} line items, exceeding the maximum of ${MAX_PDF_LINE_ITEMS}. Please split this estimate into smaller estimates.`);
  }
  // Resolve the logo bytes BEFORE the synchronous PDFKit draw loop.
  const logoBytes = await loadLogoBytes(org?.logoUrl);
  return new Promise((resolve, reject) => {
    const themeName = org?.invoiceTheme || "luxury";
    const theme = getTheme(themeName);
    const luxury = isLuxury(themeName);
    const margin = luxury ? LX.ml : 50;
    const doc = new PDFDocument({ size: "LETTER", margin });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pdfCurrency = validateCurrency((estimate as any).currency || (org as any)?.baseCurrency);
    const fmt = (n: number | string) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency: pdfCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

    const orgName = org?.name || "CherryWorks Pro";
    const orgAddress = org?.address || "";
    const orgPhone = org?.phone || "";
    const orgEmail = org?.email || "";
    const orgWebsite = org?.website || "";
    const dateFmt = org?.dateFormat || null;
    const issuedFormatted = fmtDate(estimate.issuedDate, dateFmt);
    const expiryFormatted = estimate.expiryDate ? fmtDate(estimate.expiryDate, dateFmt) : null;

    let y: number;
    let pageNum = 1;
    const contentLeft = luxury ? LX.ml : 50;
    const contentRight = luxury ? LX_RIGHT : 562;

    if (luxury) {
      y = drawLuxuryHeader(doc, orgName, orgAddress, orgPhone, orgEmail, orgWebsite, "ESTIMATE", logoBytes);

      const metaRows: [string, string][] = [
        ["ESTIMATE NO", estimate.number],
        ["STATUS", estimate.status],
        ["ISSUED", issuedFormatted],
      ];
      if (expiryFormatted) metaRows.push(["EXPIRES", expiryFormatted]);
      drawLuxuryMetaBlock(doc, y, metaRows);

      y = drawLuxuryBillTo(doc, y, "PREPARED FOR", estimate.clientName, estimate.clientEmail);

      y += 20;
      const colX = [contentLeft, 310, 390, 470];
      const colW = [250, 75, 75, contentRight - 470];

      const drawTableHeader = (atY: number) => {
        doc.fontSize(8).fillColor("#94a3b8").font("Helvetica");
        doc.text("DESCRIPTION", colX[0], atY, { characterSpacing: 2 });
        doc.text("QTY", colX[1], atY, { width: colW[1], align: "right", characterSpacing: 2 });
        doc.text("RATE", colX[2], atY, { width: colW[2], align: "right", characterSpacing: 2 });
        doc.text("AMOUNT", colX[3], atY, { width: colW[3], align: "right", characterSpacing: 2 });
        atY += 14;
        doc.moveTo(contentLeft, atY).lineTo(contentRight, atY)
          .strokeColor("#e5e7eb").lineWidth(0.75).stroke();
        return atY + 10;
      };

      y = drawTableHeader(y);
      doc.font("Helvetica").fontSize(10).fillColor(theme.text);
      const lines = estimate.lines || [];
      for (const line of lines) {
        if (y > 680) {
          drawLuxuryFooter(doc, 700, orgName, pageNum);
          pageNum++;
          doc.addPage({ size: "LETTER", margin: LX.ml });
          y = drawTableHeader(LX.mt);
          doc.font("Helvetica").fontSize(10).fillColor(theme.text);
        }
        const lineHeight = doc.heightOfString(line.description, { width: colW[0] });
        const rowHeight = Math.max(lineHeight, 14);
        doc.fillColor(theme.text).text(line.description, colX[0], y, { width: colW[0] });
        doc.text(Number(line.quantity).toFixed(2), colX[1], y, { width: colW[1], align: "right" });
        doc.text(fmt(line.unitRate), colX[2], y, { width: colW[2], align: "right" });
        const amt = Number(line.amount);
        doc.font("Helvetica-Bold").fillColor(amt < 0 ? theme.negativeColor : theme.text)
          .text(fmt(amt), colX[3], y, { width: colW[3], align: "right" });
        doc.font("Helvetica").fillColor(theme.text);
        y += rowHeight + 14;
        doc.moveTo(contentLeft, y - 6).lineTo(contentRight, y - 6)
          .strokeColor("#f1f5f9").lineWidth(0.5).stroke();
      }

      y += 14;
      if (y + 120 > 720) {
        drawLuxuryFooter(doc, 700, orgName, pageNum);
        pageNum++;
        doc.addPage({ size: "LETTER", margin: LX.ml });
        y = LX.mt;
      }

      const subtotal = Number(estimate.subtotal || 0);
      const discountAmt = Number(estimate.discountAmount || 0);
      const taxAmt = Number(estimate.taxAmount || 0);
      const total = Number(estimate.total || 0);

      const totLabelX = 370;
      const totValX = 462;
      const totValW = contentRight - totValX;

      doc.fontSize(10).fillColor("#64748b").font("Helvetica");
      doc.text("Subtotal", totLabelX, y, { width: 88, align: "right" });
      doc.fillColor(theme.text).text(fmt(subtotal), totValX, y, { width: totValW, align: "right" });
      y += 18;

      if (discountAmt > 0) {
        const dType = estimate.discountType || "NONE";
        const dVal = Number(estimate.discountValue || 0);
        const dLabel = dType === "PERCENT" ? `Discount (${dVal}%)` : "Discount";
        doc.fillColor("#64748b").text(dLabel, totLabelX - 10, y, { width: 98, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.negativeColor)
          .text(`-${fmt(discountAmt)}`, totValX, y, { width: totValW, align: "right" });
        doc.font("Helvetica");
        y += 18;
      }

      if (taxAmt > 0) {
        const taxRate = Number(estimate.taxRate || 0);
        doc.fillColor("#64748b").text(`Tax (${taxRate}%)`, totLabelX, y, { width: 88, align: "right" });
        doc.fillColor(theme.text).text(fmt(taxAmt), totValX, y, { width: totValW, align: "right" });
        y += 18;
      }

      doc.moveTo(totLabelX, y).lineTo(contentRight, y)
        .strokeColor("#e5e7eb").lineWidth(0.75).stroke();
      y += 10;
      doc.fontSize(13).font("Helvetica-Bold").fillColor(theme.text)
        .text("TOTAL", totLabelX, y, { width: 88, align: "right", characterSpacing: 1.5 });
      doc.text(fmt(total), totValX, y, { width: totValW, align: "right" });
      y += 20;
      doc.moveTo(totValX + totValW - 80, y - 4).lineTo(totValX + totValW, y - 4)
        .strokeColor("#c9a44a").lineWidth(2).stroke();

      if (estimate.notes) {
        y = drawLuxuryNotes(doc, y, estimate.notes, MAX_MEMO_LENGTH, `Estimate ${estimate.number}`);
      }

      drawLuxuryFooter(doc, y, orgName, pageNum);

    } else {
      // Task #475: same width-bounded, measured-height stacking the
      // invoice generator now uses for non-luxury themes. Multi-line
      // org address no longer overlaps phone / email / right meta.
      const logoW = embedLogo(doc, logoBytes, 50, 44, 50, 50);
      const textX = 50 + logoW;
      const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
      const rightW = HEADER_RIGHT_META_W;
      const rightX = HEADER_RIGHT_META_X;

      doc.font("Helvetica-Bold").fontSize(22).fillColor(theme.headerText)
        .text(orgName, textX, 50, {
          width: leftMaxW, ellipsis: true, lineBreak: false,
        });
      const nameH = doc.heightOfString(orgName, { width: leftMaxW, lineBreak: false });
      const leftEndY = drawHeaderInfoLines(
        doc, textX, 50 + nameH + 6, leftMaxW, 10, theme.textMuted,
        [orgAddress, orgPhone, orgEmail, orgWebsite], 2,
      );

      doc.font("Helvetica-Bold").fontSize(24).fillColor(theme.text)
        .text(estimate.number, rightX, 50, { align: "right", width: rightW });
      const numH = doc.heightOfString(estimate.number, { width: rightW });
      const metaRows: HeaderMetaRow[] = [
        { text: "ESTIMATE", size: 11, color: theme.textMuted },
        { text: `Status: ${estimate.status}`, size: 11, color: theme.textMuted },
        { text: `Issued: ${issuedFormatted}`, size: 11, color: theme.textMuted },
      ];
      if (expiryFormatted) {
        metaRows.push({ text: `Expires: ${expiryFormatted}`, size: 11, color: theme.textMuted });
      }
      const rightEndY = drawHeaderMetaRows(doc, rightX, 50 + numH + 6, rightW, metaRows);

      y = Math.max(leftEndY, rightEndY, 140) + 16;
      doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica-Bold").text("PREPARED FOR", 50, y, { characterSpacing: 1 });
      y += 16;
      doc.fontSize(13).fillColor(theme.text).font("Helvetica-Bold").text(estimate.clientName, 50, y);
      y += 18;
      if (estimate.clientEmail) {
        doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica").text(estimate.clientEmail, 50, y);
        y += 16;
      }

      y += 16;
      const colX = [50, 310, 380, 470];
      const colW = [256, 65, 85, 92];

      const drawTableHeader = (atY: number) => {
        doc.rect(50, atY, 512, 24).fill(theme.tableBg);
        doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica-Bold");
        const hdrY = atY + 7;
        doc.text("DESCRIPTION", colX[0] + 6, hdrY);
        doc.text("QTY", colX[1] + 6, hdrY, { width: colW[1], align: "right" });
        doc.text("RATE", colX[2] + 6, hdrY, { width: colW[2], align: "right" });
        doc.text("AMOUNT", colX[3] + 6, hdrY, { width: colW[3], align: "right" });
        return atY + 28;
      };

      y = drawTableHeader(y);
      doc.font("Helvetica").fontSize(11).fillColor(theme.text);
      const lines = estimate.lines || [];
      for (const line of lines) {
        if (y > 680) { doc.addPage(); y = drawTableHeader(50); doc.font("Helvetica").fontSize(11).fillColor(theme.text); }
        const lineHeight = doc.heightOfString(line.description, { width: colW[0] });
        const rowHeight = Math.max(lineHeight, 16);
        doc.text(line.description, colX[0] + 6, y, { width: colW[0] });
        doc.text(Number(line.quantity).toFixed(2), colX[1] + 6, y, { width: colW[1], align: "right" });
        doc.text(fmt(line.unitRate), colX[2] + 6, y, { width: colW[2], align: "right" });
        const lineAmt = Number(line.amount);
        doc.font("Helvetica-Bold").fillColor(lineAmt < 0 ? theme.negativeColor : theme.accent)
          .text(fmt(lineAmt), colX[3] + 6, y, { width: colW[3], align: "right" });
        doc.font("Helvetica").fillColor(theme.text);
        y += rowHeight + 8;
        doc.moveTo(50, y).lineTo(562, y).strokeColor(theme.tableBorder).lineWidth(0.5).stroke();
        y += 6;
      }

      y += 16;
      if (y + 120 > 720) { doc.addPage(); y = 50; }

      const subtotal = Number(estimate.subtotal || 0);
      const discountAmt = Number(estimate.discountAmount || 0);
      const taxAmt = Number(estimate.taxAmount || 0);
      const total = Number(estimate.total || 0);

      doc.fontSize(11).fillColor(theme.textMuted).font("Helvetica");
      doc.text("Subtotal", 380, y, { width: 80, align: "right" });
      doc.font("Helvetica-Bold").fillColor(theme.text).text(fmt(subtotal), 465, y, { width: 97, align: "right" });
      y += 20;

      if (discountAmt > 0) {
        const dType = estimate.discountType || "NONE";
        const dVal = Number(estimate.discountValue || 0);
        const dLabel = dType === "PERCENT" ? `Discount (${dVal}%)` : "Discount";
        doc.font("Helvetica").fillColor(theme.textMuted).text(dLabel, 360, y, { width: 100, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.negativeColor).text(`-${fmt(discountAmt)}`, 465, y, { width: 97, align: "right" });
        y += 20;
      }

      if (taxAmt > 0) {
        const taxRate = Number(estimate.taxRate || 0);
        doc.font("Helvetica").fillColor(theme.textMuted).text(`Tax (${taxRate}%)`, 380, y, { width: 80, align: "right" });
        doc.font("Helvetica-Bold").fillColor(theme.text).text(fmt(taxAmt), 465, y, { width: 97, align: "right" });
        y += 20;
      }

      doc.moveTo(380, y).lineTo(562, y).strokeColor(theme.accent).lineWidth(1.5).stroke();
      y += 8;
      doc.fontSize(16).font("Helvetica-Bold").fillColor(theme.text).text("Total", 380, y, { width: 80, align: "right" });
      doc.fillColor(theme.totalColor).text(fmt(total), 465, y, { width: 97, align: "right" });
      y += 28;

      if (estimate.notes) {
        const safeMemo = estimate.notes.slice(0, MAX_MEMO_LENGTH);
        if (estimate.notes.length > MAX_MEMO_LENGTH) {
          console.warn(`[pdf] Estimate ${estimate.number} memo truncated from ${estimate.notes.length} to ${MAX_MEMO_LENGTH} chars`);
        }
        y += 8;
        if (y > 640) { doc.addPage(); y = 50; }
        doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica-Bold").text("NOTES", 50, y, { characterSpacing: 1 });
        y += 14;
        doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica").text(safeMemo, 50, y, { width: 400 });
        y += doc.heightOfString(safeMemo, { width: 400 }) + 16;
      }

      y = Math.max(y + 20, 670);
      if (y > 710) { doc.addPage(); y = 690; }
      doc.moveTo(50, y).lineTo(562, y).strokeColor(theme.tableBorder).lineWidth(0.5).stroke();
      y += 14;
      doc.fontSize(10).fillColor(theme.footerText).font("Helvetica").text("Thank you for considering our services.", 50, y, { align: "center", width: 512 });
      y += 16;
      doc.fontSize(9).text(orgName, 50, y, { align: "center", width: 512 });
    }

    doc.end();
  });
}

export interface ExpenseReceiptData {
  id: string;
  amount: number;
  date: string;
  vendor: string | null;
  description: string | null;
  categoryName: string | null;
  projectName: string | null;
  clientName: string | null;
  userName: string | null;
  status: string;
  billable: boolean;
  reimbursable: boolean;
  notes: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  currency?: string;
}

export async function generateExpenseReceiptPdf(
  expense: ExpenseReceiptData,
  org?: OrgBranding,
): Promise<Buffer> {
  // Resolve the logo bytes BEFORE the synchronous PDFKit draw loop.
  const logoBytes = await loadLogoBytes(org?.logoUrl);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const receiptCurrency = validateCurrency(expense?.currency);
    const fmt = (n: number | string) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency: receiptCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

    const orgName = org?.name || "CherryWorks Pro";
    const orgAddress = org?.address || "";
    const orgPhone = org?.phone || "";
    const orgEmail = org?.email || "";

    // Task #475: width-bounded, measured-height stacking so multi-line
    // org address can't collide with the right-side EXPENSE RECEIPT
    // / status / date / ID column.
    const logoW = embedLogo(doc, logoBytes, 50, 44, 50, 50);
    const textX = 50 + logoW;
    const leftMaxW = Math.max(120, HEADER_RIGHT_META_X - HEADER_LEFT_GUTTER - textX);
    const rightW = HEADER_RIGHT_META_W;
    const rightX = HEADER_RIGHT_META_X;

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#0f172a")
      .text(orgName, textX, 50, { width: leftMaxW, ellipsis: true, lineBreak: false });
    const nameH = doc.heightOfString(orgName, { width: leftMaxW, lineBreak: false });
    const leftEndY = drawHeaderInfoLines(
      doc, textX, 50 + nameH + 6, leftMaxW, 10, "#94a3b8",
      [orgAddress, orgPhone, orgEmail], 2,
    );

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a")
      .text("EXPENSE RECEIPT", rightX, 50, { align: "right", width: rightW });
    const labelH = doc.heightOfString("EXPENSE RECEIPT", { width: rightW });
    const statusColors: Record<string, string> = {
      DRAFT: "#6b7280", SUBMITTED: "#3b82f6", APPROVED: "#22c55e", REJECTED: "#b91c1c", REIMBURSED: "#a855f7",
    };
    const rightEndY = drawHeaderMetaRows(
      doc, rightX, 50 + labelH + 6, rightW,
      [
        { text: expense.status, font: "Helvetica-Bold", size: 12, color: statusColors[expense.status] || "#6b7280" },
        { text: `Date: ${expense.date}`, size: 10, color: "#64748b", gap: 4 },
        { text: `ID: ${expense.id.slice(0, 8)}...`, size: 10, color: "#64748b" },
      ],
    );

    let y = Math.max(leftEndY, rightEndY);

    if (expense.status === "APPROVED" || expense.status === "REIMBURSED") {
      doc.save();
      doc.translate(300, 380).rotate(-35);
      doc.fontSize(60).fillColor("#0f172a").opacity(0.04).font("Helvetica-Bold")
        .text(expense.status, -120, -30, { align: "center" });
      doc.restore().opacity(1);
    }

    y = Math.max(y, 130) + 30;
    doc.fontSize(9).fillColor("#94a3b8").font("Helvetica-Bold").text("AMOUNT", 50, y);
    y += 16;
    doc.fontSize(28).fillColor("#0f172a").font("Helvetica-Bold").text(fmt(expense.amount), 50, y);
    y += 40;

    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 8;

    const rows: [string, string][] = [];
    if (expense.vendor) rows.push(["Vendor", expense.vendor]);
    if (expense.description) rows.push(["Description", expense.description]);
    if (expense.categoryName) rows.push(["Category", expense.categoryName]);
    if (expense.projectName) rows.push(["Project", expense.projectName]);
    if (expense.clientName) rows.push(["Client", expense.clientName]);
    if (expense.userName) rows.push(["Submitted By", expense.userName]);
    rows.push(["Date", expense.date]);

    const flags: string[] = [];
    if (expense.billable) flags.push("Billable to Client");
    if (expense.reimbursable) flags.push("Reimbursable");
    if (flags.length > 0) rows.push(["Classification", flags.join(" · ")]);

    for (const [label, value] of rows) {
      doc.fontSize(10).fillColor("#64748b").font("Helvetica-Bold").text(label, 50, y, { width: 130 });
      doc.fontSize(10).fillColor("#0f172a").font("Helvetica").text(value, 185, y, { width: 377 });
      y += 20;
      if (y > 680) { doc.addPage(); y = 50; }
    }

    if (expense.approvedByName || expense.rejectionReason) {
      y += 10;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      y += 12;
      doc.fontSize(9).fillColor("#94a3b8").font("Helvetica-Bold").text("APPROVAL", 50, y);
      y += 16;
      if (expense.approvedByName) {
        doc.fontSize(10).fillColor("#64748b").font("Helvetica-Bold").text("Reviewed By", 50, y, { width: 130 });
        doc.fontSize(10).fillColor("#0f172a").font("Helvetica").text(expense.approvedByName, 185, y);
        y += 20;
      }
      if (expense.approvedAt) {
        doc.fontSize(10).fillColor("#64748b").font("Helvetica-Bold").text("Reviewed On", 50, y, { width: 130 });
        doc.fontSize(10).fillColor("#0f172a").font("Helvetica").text(new Date(expense.approvedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), 185, y);
        y += 20;
      }
      if (expense.rejectionReason) {
        doc.fontSize(10).fillColor("#b91c1c").font("Helvetica-Bold").text("Rejection Reason", 50, y, { width: 130 });
        doc.fontSize(10).fillColor("#b91c1c").font("Helvetica").text(expense.rejectionReason, 185, y, { width: 377 });
        y += 20;
      }
    }

    if (expense.notes) {
      y += 10;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      y += 12;
      doc.fontSize(9).fillColor("#94a3b8").font("Helvetica-Bold").text("NOTES", 50, y);
      y += 16;
      doc.fontSize(10).fillColor("#64748b").font("Helvetica").text(expense.notes, 50, y, { width: 512 });
      y += 30;
    }

    y = Math.max(y + 20, 680);
    if (y > 700) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 10;
    doc.fontSize(9).fillColor("#94a3b8").font("Helvetica")
      .text(`Generated by ${orgName}  |  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 50, y, { align: "center", width: 512 });

    doc.end();
  });
}
