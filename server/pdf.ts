import type { InvoiceLine } from "@shared/schema";
import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";
import type { DetailItem } from "./invoice-details";
import { formatHM } from "./invoice-details";

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
      ensureSpace(1);
      const timeText = it.startTime && it.endTime
        ? `${it.startTime}–${it.endTime}`
        : "—";
      doc.fontSize(8).font("Helvetica").fillColor(mutedColor)
        .text(timeText, cTime, y, { width: cTimeW });
      doc.font("Helvetica").fillColor(textColor)
        .text(it.project, cProject, y, { width: cProjectW, ellipsis: true, height: 11 });
      doc.font("Helvetica-Bold").fillColor(textColor)
        .text(it.ticket || "", cTicket, y, { width: cTicketW });
      doc.font("Helvetica").fillColor(mutedColor)
        .text(it.description || "", cDesc, y, { width: cDescW, lineGap: 1, ellipsis: true, height: 11 });
      doc.font("Helvetica").fillColor(textColor)
        .text(formatHM(it.hours), cHrs, y, { width: cHrsW, align: "right" });
      doc.fontSize(7).fillColor(it.billable ? accentColor : "#94a3b8")
        .text(it.billable ? "BILLABLE" : "UNBILLED", cTag, y, { width: cTagW, align: "right", characterSpacing: 0.5 });
      y += 12;
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

function resolveLogoPath(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  try {
    const filename = path.basename(logoUrl);
    const fp = path.join(logoBaseDir, filename);
    if (fs.existsSync(fp)) return fp;
  } catch {}
  return null;
}

function embedLogo(
  doc: InstanceType<typeof PDFDocument>,
  logoPath: string | null,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): number {
  if (!logoPath) return 0;
  try {
    const img = (doc as any).openImage(logoPath);
    const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * ratio;
    const h = img.height * ratio;
    doc.image(logoPath, x, y, { width: w, height: h });
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

function drawLuxuryHeader(
  doc: InstanceType<typeof PDFDocument>,
  orgName: string,
  orgAddress: string,
  orgPhone: string,
  orgEmail: string,
  orgWebsite: string,
  docTypeLabel: string,
  logoFile: string | null,
): number {
  const theme = getTheme("luxury");
  const y = LX.mt;
  const logoW = embedLogo(doc, logoFile, LX.ml, y, 48, 48);
  const nameX = LX.ml + logoW;
  doc.fontSize(28).fillColor(theme.headerText).font("Helvetica-Bold")
    .text(orgName, nameX, y, { characterSpacing: 1.5 });
  const nameH = doc.heightOfString(orgName, { width: 300, characterSpacing: 1.5 });
  const accentY = y + nameH + 4;
  doc.moveTo(nameX, accentY).lineTo(nameX + 60, accentY)
    .strokeColor(theme.accent).lineWidth(2).stroke();

  let infoY = y + nameH + 14;
  doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica");
  if (orgAddress) { doc.text(orgAddress, nameX, infoY); infoY += 13; }
  if (orgPhone) { doc.text(orgPhone, nameX, infoY); infoY += 13; }
  if (orgEmail) { doc.text(orgEmail, nameX, infoY); infoY += 13; }
  if (orgWebsite) { doc.text(orgWebsite, nameX, infoY); infoY += 13; }

  doc.fontSize(9).fillColor("#94a3b8").font("Helvetica")
    .text(docTypeLabel, LX.ml, y, { align: "right", width: LX_CONTENT_W, characterSpacing: 3 });

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
    const logoFile = resolveLogoPath(org?.logoUrl);

    let y: number;
    let pageNum = 1;
    const contentLeft = luxury ? LX.ml : 50;
    const contentRight = luxury ? LX_RIGHT : 562;
    const contentW = contentRight - contentLeft;

    if (luxury) {
      y = drawLuxuryHeader(doc, orgName, orgAddress, orgPhone, orgEmail, orgWebsite, "INVOICE", logoFile);

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
      if (themeName === "modern") {
        doc.rect(0, 0, 612, 100).fill(theme.headerBg);
        const logoW = embedLogo(doc, logoFile, 50, 22, 50, 50);
        doc.fontSize(22).fillColor(theme.headerText).font("Helvetica-Bold").text(orgName, 50 + logoW, 30);
        doc.fontSize(10).fillColor("#94a3b8").font("Helvetica");
        if (orgPhone) doc.text(orgPhone, 50 + logoW, 56);
        if (orgEmail) doc.text(orgEmail, 50 + logoW, 70);
        doc.rect(0, 100, 612, 3).fill(theme.accent);
        doc.fontSize(11).fillColor("#94a3b8").font("Helvetica").text("INVOICE", 400, 30, { align: "right", width: 162 });
        doc.fontSize(22).fillColor(theme.headerText).font("Helvetica-Bold").text(invoice.number, 400, 46, { align: "right", width: 162 });
        doc.fontSize(10).fillColor("#94a3b8").font("Helvetica").text(`${invoice.status}`, 400, 74, { align: "right", width: 162 });
        y = 120;
      } else if (themeName === "bold") {
        doc.rect(0, 0, 612, 120).fill(theme.headerBg);
        const logoW = embedLogo(doc, logoFile, 50, 20, 50, 50);
        doc.fontSize(26).fillColor(theme.headerText).font("Helvetica-Bold").text(orgName, 50 + logoW, 28);
        doc.fontSize(10).fillColor("rgba(255,255,255,0.7)").font("Helvetica");
        let hy = 58;
        if (orgAddress) { doc.text(orgAddress, 50 + logoW, hy); hy += 14; }
        if (orgPhone) { doc.text(orgPhone, 50 + logoW, hy); hy += 14; }
        if (orgEmail) { doc.text(orgEmail, 50 + logoW, hy); }
        doc.fontSize(32).fillColor(theme.headerText).font("Helvetica-Bold").text(invoice.number, 350, 30, { align: "right", width: 212 });
        doc.fontSize(12).fillColor("rgba(255,255,255,0.8)").font("Helvetica").text(invoice.status, 350, 70, { align: "right", width: 212 });
        doc.fontSize(10).text(`Issued: ${issuedFormatted}`, 350, 88, { align: "right", width: 212 });
        doc.text(`Due: ${dueFormatted}`, 350, 102, { align: "right", width: 212 });
        y = 140;
      } else if (themeName === "minimal") {
        const logoW = embedLogo(doc, logoFile, 50, 44, 40, 40);
        doc.fontSize(11).fillColor(theme.textMuted).font("Helvetica").text(orgName.toUpperCase(), 50 + logoW, 50, { characterSpacing: 3 });
        y = 68;
        doc.fontSize(9).fillColor("#cbd5e1").font("Helvetica");
        if (orgAddress) { doc.text(orgAddress, 50 + logoW, y); y += 12; }
        if (orgPhone) { doc.text(orgPhone, 50 + logoW, y); y += 12; }
        doc.moveTo(50, y + 4).lineTo(562, y + 4).strokeColor("#e2e8f0").lineWidth(0.3).stroke();
        y += 14;
        doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica").text("INVOICE", 450, 50, { align: "right", width: 112 });
        doc.fontSize(16).fillColor(theme.text).font("Helvetica-Bold").text(invoice.number, 400, 64, { align: "right", width: 162 });
        doc.fontSize(9).fillColor(theme.textMuted).font("Helvetica").text(`${issuedFormatted}  ·  Due ${dueFormatted}`, 350, 84, { align: "right", width: 212 });
      } else {
        const logoW = embedLogo(doc, logoFile, 50, 44, 50, 50);
        doc.fontSize(22).fillColor(theme.headerText).font("Helvetica-Bold").text(orgName, 50 + logoW, 50);
        doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica");
        y = 78;
        if (orgAddress) { doc.text(orgAddress, 50 + logoW, y); y += 14; }
        if (orgPhone) { doc.text(orgPhone, 50 + logoW, y); y += 14; }
        if (orgEmail) { doc.text(orgEmail, 50 + logoW, y); y += 14; }
        if (orgWebsite) { doc.text(orgWebsite, 50 + logoW, y); y += 14; }
        doc.fontSize(24).fillColor(theme.text).font("Helvetica-Bold").text(invoice.number, 350, 50, { align: "right" });
        doc.fontSize(11).fillColor(theme.textMuted).font("Helvetica");
        doc.text(`Status: ${invoice.status}`, 350, 80, { align: "right" });
        doc.text(`Issued: ${issuedFormatted}`, 350, 96, { align: "right" });
        doc.text(`Due: ${dueFormatted}`, 350, 112, { align: "right" });
      }

      if (themeName !== "bold") {
        if (themeName === "modern") {
          doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica");
          doc.text(`Issued: ${issuedFormatted}`, 50, y);
          doc.text(`Due: ${dueFormatted}`, 200, y);
          y += 20;
        }
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
    const logoFile = resolveLogoPath(org?.logoUrl);

    let y: number;
    let pageNum = 1;
    const contentLeft = luxury ? LX.ml : 50;
    const contentRight = luxury ? LX_RIGHT : 562;

    if (luxury) {
      y = drawLuxuryHeader(doc, orgName, orgAddress, orgPhone, orgEmail, orgWebsite, "ESTIMATE", logoFile);

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
      const logoW = embedLogo(doc, logoFile, 50, 44, 50, 50);
      doc.fontSize(22).fillColor(theme.headerText).font("Helvetica-Bold").text(orgName, 50 + logoW, 50);
      doc.fontSize(10).fillColor(theme.textMuted).font("Helvetica");
      y = 78;
      if (orgAddress) { doc.text(orgAddress, 50 + logoW, y); y += 14; }
      if (orgPhone) { doc.text(orgPhone, 50 + logoW, y); y += 14; }
      if (orgEmail) { doc.text(orgEmail, 50 + logoW, y); y += 14; }

      doc.fontSize(24).fillColor(theme.text).font("Helvetica-Bold").text(estimate.number, 350, 50, { align: "right" });
      doc.fontSize(11).fillColor(theme.textMuted).font("Helvetica");
      doc.text(`ESTIMATE`, 350, 80, { align: "right" });
      doc.text(`Status: ${estimate.status}`, 350, 96, { align: "right" });
      doc.text(`Issued: ${issuedFormatted}`, 350, 112, { align: "right" });
      if (expiryFormatted) doc.text(`Expires: ${expiryFormatted}`, 350, 128, { align: "right" });

      y = Math.max(y, 140) + 16;
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
    const logoFile = resolveLogoPath(org?.logoUrl);

    const logoW = embedLogo(doc, logoFile, 50, 44, 50, 50);
    doc.fontSize(22).fillColor("#0f172a").font("Helvetica-Bold").text(orgName, 50 + logoW, 50);
    doc.fontSize(10).fillColor("#94a3b8").font("Helvetica");
    let y = 78;
    if (orgAddress) { doc.text(orgAddress, 50 + logoW, y); y += 14; }
    if (orgPhone) { doc.text(orgPhone, 50 + logoW, y); y += 14; }
    if (orgEmail) { doc.text(orgEmail, 50 + logoW, y); y += 14; }

    doc.fontSize(20).fillColor("#0f172a").font("Helvetica-Bold").text("EXPENSE RECEIPT", 350, 50, { align: "right" });
    const statusColors: Record<string, string> = {
      DRAFT: "#6b7280", SUBMITTED: "#3b82f6", APPROVED: "#22c55e", REJECTED: "#b91c1c", REIMBURSED: "#a855f7",
    };
    doc.fontSize(12).fillColor(statusColors[expense.status] || "#6b7280").font("Helvetica-Bold")
      .text(expense.status, 350, 76, { align: "right" });
    doc.fontSize(10).fillColor("#64748b").font("Helvetica")
      .text(`Date: ${expense.date}`, 350, 96, { align: "right" });
    doc.text(`ID: ${expense.id.slice(0, 8)}...`, 350, 112, { align: "right" });

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
