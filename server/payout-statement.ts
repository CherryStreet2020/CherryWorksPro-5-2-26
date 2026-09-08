/**
 * Payout statement for one team member: the exact timesheet lines behind the
 * outstanding balance and behind every recorded payout, as JSON, Excel or PDF.
 *
 * Truth sources, deliberately reused rather than re-derived:
 *   • outstanding lines — storage.getUnpaidTimeEntriesForTeamMember: the same
 *     per-entry value the admin's Record Payment dialog pays from and the member's
 *     earnings view reads (#40: one computation);
 *   • paid lines — payout_time_entries.amount: the amount recorded for that entry
 *     when the payout was booked, not today's rate.
 */
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { clients, projects, timeEntries, users } from "@shared/schema";

export interface StatementLine {
  entryId: string;
  date: string;
  project: string;
  client: string;
  hours: number;
  rate: number;
  amount: number;
  billable: boolean;
  invoiced: boolean;
  notes: string | null;
}

export interface StatementPayout {
  id: string;
  payoutDate: string;
  amount: number;
  status: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
  lines: StatementLine[];
  /** amount − Σ lines: non-zero when the payout was booked ad hoc or partly against time. */
  unlinkedAmount: number;
}

export interface PayoutStatement {
  generatedAt: string;
  /** The organisation's base currency (ISO 4217) — every amount below is in it. */
  currency: string;
  member: { id: string; name: string; email: string | null };
  outstanding: { total: number; hours: number; lines: StatementLine[] };
  payouts: StatementPayout[];
  paidTotal: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hoursOf = (minutes: number) => r2(minutes / 60);

export async function buildPayoutStatement(orgId: string, teamMemberId: string): Promise<PayoutStatement | null> {
  const member = await storage.getUserById(teamMemberId);
  if (!member || member.orgId !== orgId) return null;
  const org = await storage.getOrg(orgId);
  const currency = org?.baseCurrency || "USD";
  const name = (member as any).name || [ (member as any).firstName, (member as any).lastName ].filter(Boolean).join(" ") || member.email;

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.orgId, orgId));
  const project = new Map(projectRows.map((p) => [p.id, { name: p.name, client: p.clientName ?? "" }]));
  const named = (projectId: string) => project.get(projectId) ?? { name: "(deleted project)", client: "" };

  const unpaid = await storage.getUnpaidTimeEntriesForTeamMember(orgId, teamMemberId);
  const outstandingLines: StatementLine[] = unpaid
    .map((e) => ({
      entryId: e.id,
      date: e.date,
      project: named(e.projectId).name,
      client: named(e.projectId).client,
      hours: hoursOf(e.minutes),
      rate: e.minutes > 0 ? r2(e.value / (e.minutes / 60)) : 0,
      amount: r2(e.value),
      billable: e.billable,
      invoiced: e.invoiced,
      notes: e.notes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const outstandingTotal = r2(outstandingLines.reduce((s, l) => s + l.amount, 0));
  const outstandingHours = r2(outstandingLines.reduce((s, l) => s + l.hours, 0));

  const payoutRows = await storage.getTeamMemberPayouts(orgId, { teamMemberId });
  const payouts: StatementPayout[] = [];
  for (const p of payoutRows) {
    const links = await storage.getPayoutTimeEntries(p.id, orgId);
    const entryIds = links.map((l) => l.timeEntryId);
    const entries = entryIds.length
      ? await db.select().from(timeEntries).where(and(eq(timeEntries.orgId, orgId), inArray(timeEntries.id, entryIds)))
      : [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    const lines: StatementLine[] = links
      .map((l) => {
        const e = byId.get(l.timeEntryId);
        const amount = r2(Number(l.amount) || 0);
        const minutes = e?.minutes ?? 0;
        return {
          entryId: l.timeEntryId,
          date: e?.date ?? "",
          project: e ? named(e.projectId).name : "(deleted entry)",
          client: e ? named(e.projectId).client : "",
          hours: hoursOf(minutes),
          rate: minutes > 0 ? r2(amount / (minutes / 60)) : 0,
          amount,
          billable: e?.billable ?? false,
          invoiced: e?.invoiced ?? false,
          notes: e?.notes ?? null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const amount = r2(Number(p.amount) || 0);
    payouts.push({
      id: p.id,
      payoutDate: String(p.payoutDate),
      amount,
      status: p.status,
      paymentMethod: p.paymentMethod ?? null,
      referenceNumber: p.referenceNumber ?? null,
      periodStart: p.periodStart ? String(p.periodStart) : null,
      periodEnd: p.periodEnd ? String(p.periodEnd) : null,
      notes: p.notes ?? null,
      lines,
      unlinkedAmount: r2(amount - lines.reduce((s, l) => s + l.amount, 0)),
    });
  }
  payouts.sort((a, b) => b.payoutDate.localeCompare(a.payoutDate));
  const paidTotal = r2(payouts.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + p.amount, 0));

  return {
    generatedAt: new Date().toISOString(),
    currency,
    member: { id: member.id, name, email: member.email ?? null },
    outstanding: { total: outstandingTotal, hours: outstandingHours, lines: outstandingLines },
    payouts,
    paidTotal,
  };
}

const LINE_HEADER = ["Date", "Client", "Project", "Hours", "Rate", "Amount", "Billable", "Invoiced", "Notes"];
const lineRow = (l: StatementLine) => [l.date, l.client, l.project, l.hours, l.rate, l.amount, l.billable ? "yes" : "no", l.invoiced ? "yes" : "no", l.notes ?? ""];

export function statementToXlsx(s: PayoutStatement): Buffer {
  const wb = XLSX.utils.book_new();
  const summary = [
    ["Team member", s.member.name],
    ["Email", s.member.email ?? ""],
    ["Generated", s.generatedAt],
    ["Currency", s.currency],
    [],
    ["Outstanding (unpaid time)", s.outstanding.total],
    ["Outstanding hours", s.outstanding.hours],
    ["Paid to date (completed payouts)", s.paidTotal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([LINE_HEADER, ...s.outstanding.lines.map(lineRow), [], ["", "", "Total", s.outstanding.hours, "", s.outstanding.total]]), "Outstanding");
  const paid: (string | number)[][] = [["Payout date", "Status", "Method", "Reference", "Payout amount", ...LINE_HEADER]];
  for (const p of s.payouts) {
    if (p.lines.length === 0) paid.push([p.payoutDate, p.status, p.paymentMethod ?? "", p.referenceNumber ?? "", p.amount, "(no linked time entries)"]);
    for (const l of p.lines) paid.push([p.payoutDate, p.status, p.paymentMethod ?? "", p.referenceNumber ?? "", p.amount, ...lineRow(l)]);
    if (p.unlinkedAmount !== 0 && p.lines.length > 0) paid.push([p.payoutDate, p.status, "", "", p.amount, "", "", "amount not linked to time", "", "", p.unlinkedAmount]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paid), "Paid");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function statementToPdf(s: PayoutStatement, orgName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const money = (n: number) => {
      try { return n.toLocaleString("en-US", { style: "currency", currency: s.currency }); }
      catch { return `${s.currency} ${n.toFixed(2)}`; }
    };
    type CellKey = "date" | "client" | "project" | "hours" | "rate" | "amount" | "invoiced" | "notes";
    type Col = { key: CellKey; label: string; w: number; right?: boolean };
    const cols: Col[] = [
      { key: "date", label: "Date", w: 62 },
      { key: "client", label: "Client", w: 90 },
      { key: "project", label: "Project", w: 120 },
      { key: "hours", label: "Hours", w: 44, right: true },
      { key: "rate", label: "Rate", w: 56, right: true },
      { key: "amount", label: "Amount", w: 64, right: true },
      { key: "invoiced", label: "Inv.", w: 30 },
      { key: "notes", label: "Notes", w: 66 },
    ];
    const left = doc.page.margins.left;
    const xs = cols.map((_, i) => left + cols.slice(0, i).reduce((sum, c) => sum + c.w, 0));
    const tableWidth = cols.reduce((sum, c) => sum + c.w, 0);
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
    const tableHeader = () => {
      ensure(18);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#444");
      cols.forEach((c, i) => doc.text(c.label, xs[i], y, { width: c.w, align: c.right ? "right" : "left" }));
      doc.x = left; doc.y = y + 12;
      doc.moveTo(left, doc.y).lineTo(left + tableWidth, doc.y).strokeColor("#bbb").stroke();
      doc.moveDown(0.3);
    };
    const tableRow = (l: StatementLine) => {
      const cells: Record<CellKey, string> = {
        date: l.date, client: l.client, project: l.project, hours: l.hours.toFixed(2), rate: money(l.rate), amount: money(l.amount), invoiced: l.invoiced ? "yes" : "no", notes: (l.notes ?? "").slice(0, 40),
      };
      const h = Math.max(...cols.map((c) => doc.heightOfString(cells[c.key], { width: c.w - 4 })), 12);
      ensure(h + 4);
      const y = doc.y;
      doc.font("Helvetica").fontSize(8).fillColor("#111");
      cols.forEach((c, i) => doc.text(cells[c.key], xs[i], y, { width: c.w - 4, align: c.right ? "right" : "left" }));
      doc.x = left; doc.y = y + h + 3;
    };

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(`${orgName} — Payout statement`);
    doc.font("Helvetica").fontSize(10).fillColor("#333").text(`${s.member.name}${s.member.email ? ` · ${s.member.email}` : ""}`);
    doc.fontSize(8).fillColor("#777").text(`Generated ${s.generatedAt.replace("T", " ").slice(0, 16)} UTC`);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(`Outstanding: ${money(s.outstanding.total)}  ·  ${s.outstanding.hours.toFixed(2)} h unpaid`);
    doc.moveDown(0.5);
    if (s.outstanding.lines.length === 0) doc.font("Helvetica").fontSize(9).fillColor("#555").text("No unpaid time.");
    else { tableHeader(); for (const l of s.outstanding.lines) tableRow(l); }
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(`Paid to date: ${money(s.paidTotal)}  ·  ${s.payouts.length} payout(s)`);
    for (const p of s.payouts) {
      doc.moveDown(0.6); ensure(40);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(`${p.payoutDate}  ${money(p.amount)}  ${p.status}${p.paymentMethod ? `  via ${p.paymentMethod}` : ""}${p.referenceNumber ? `  ref ${p.referenceNumber}` : ""}`);
      if (p.periodStart || p.periodEnd) doc.font("Helvetica").fontSize(8).fillColor("#555").text(`Period ${p.periodStart ?? "?"} – ${p.periodEnd ?? "?"}`);
      if (p.notes) doc.font("Helvetica").fontSize(8).fillColor("#555").text(p.notes.slice(0, 200));
      doc.moveDown(0.3);
      if (p.lines.length === 0) doc.font("Helvetica").fontSize(8).fillColor("#555").text("Recorded without linked time entries.");
      else { tableHeader(); for (const l of p.lines) tableRow(l); }
      if (p.lines.length > 0 && p.unlinkedAmount !== 0) doc.font("Helvetica").fontSize(8).fillColor("#555").text(`Amount not linked to time: ${money(p.unlinkedAmount)}`);
    }
    doc.end();
  });
}
