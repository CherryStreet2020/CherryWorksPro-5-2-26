/**
 * Real product screens for the public site, captured at 2x from a demo firm
 * (Halcyon Advisory Group, fictional clients). Width and height are the files'
 * intrinsic pixels so the browser reserves the space before an image loads.
 * Alt text describes only what each capture shows.
 *
 * `supportCases` is the full app window with the navigation; the rest are
 * cropped to the page content beside it.
 */
export type ScreenSpec = { src: string; width: number; height: number; alt: string };

const crop = (name: string, alt: string): ScreenSpec => ({
  src: `/marketing/screens/${name}.webp`, width: 1640, height: 1281, alt,
});

export const SCREENS = {
  supportCases: {
    src: "/marketing/screens/support-cases.webp", width: 2560, height: 1600,
    alt: "CherryWorks Pro support cases screen with the full navigation: work, support, billing, management, accounting, reports, people, system and marketing",
  },
  caseDetail: crop("case-detail", "A support case from a dental group's front desk: the client's email, an internal note, a reply to the client, and 2h 45m logged on the case, all of it billable and not yet invoiced."),
  time: crop("time", "The weekly timesheet: hours per day across three projects, a 20:15 week total against a 40-hour target, and a button to submit the week for approval."),
  expenses: crop("expenses", "The Expenses page: totals for the month, pending approval and reimbursable, and a list of team expenses by vendor, category and project."),
  invoices: crop("invoices", "The Invoices page: $62,555 invoiced, $26,305 outstanding and $36,250 paid this month, with sent and paid invoices by client."),
  estimates: crop("estimates", "Estimates and proposals: pending and accepted value, the conversion rate, and estimates by client with their status."),
  payouts: crop("payouts", "The Payouts page: unpaid time value and the balance owed to each team member, with a Pay button per person."),
  dashboard: crop("dashboard", "The dashboard: revenue, collected, outstanding and net cash for the month, with revenue trend and cash flow charts."),
  ledger: crop("gl-ledger", "The general ledger: accounts grouped by type with debit, credit and period balances for the month."),
  journal: crop("gl-journal", "Journal entries posted automatically from invoices, payments, payouts and approved expenses."),
  trialBalance: crop("trial-balance", "The trial balance: debit and credit balances for each account, with subtotals by account type."),
  accounts: crop("gl-accounts", "The chart of accounts: cash, receivables, payables, accrued payouts, sales tax, equity and revenue accounts with balances."),
  contacts: crop("mkt-contacts", "Marketing Hub contacts: people with their email, lifecycle stage and tags, filterable by stage and lead status."),
  contact: crop("mkt-contact", "A Marketing Hub contact record: details, linked company, and an activity timeline of emails, tags and a discovery meeting."),
  campaigns: crop("mkt-campaigns", "Marketing Hub campaigns: three email campaigns with subject, sender, audience and send time."),
  sequences: crop("mkt-sequences", "Marketing Hub sequences: a three-touch follow-up for leads from the website chat."),
  companies: crop("mkt-companies", "Marketing Hub companies: prospect firms by industry, with search and filters."),
  reports: crop("reports", "Reports: 19 reports across financial, receivables, operations, team, tax and expenses, showing revenue by month, invoiced against paid."),
  projects: crop("projects", "Projects: each client project with its team and each person's hourly rate."),
} satisfies Record<string, ScreenSpec>;
