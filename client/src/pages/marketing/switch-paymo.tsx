import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// Paymo facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "Paymo",
  seoPath: "/switch-from-paymo",
  h1: "From project tracking to closed books",
  lede: (
    <>
      Paymo handles tasks, time and invoices for project teams, and syncs to QuickBooks Online or Xero for the books. CherryWorks
      Pro keeps time, invoicing, the general ledger, contractor payouts and client support together, at one price per firm.
    </>
  ),
  screen: SCREENS.time,
  painHeading: "Why firms look beyond Paymo",
  painIntro: "Paymo is a capable project tool. The gaps show up in the money that moves after the work is done.",
  painPoints: [
    {
      title: "Priced per user",
      body: <>Plus is $15.90 and Pro $23.90 per user a month, billed monthly at list price, after a lower introductory rate for new accounts.</>,
    },
    {
      title: "The books live in a second system",
      body: <>Paymo syncs with QuickBooks Online and Xero rather than keeping a general ledger of its own.</>,
    },
    {
      title: "Contractors are paid elsewhere",
      body: <>Paymo doesn’t pay contractors, so payouts run through payroll, your bank or another tool.</>,
    },
    {
      title: "No place for client support",
      body: <>Paymo doesn’t include a help desk, so client requests and the hours spent on them are tracked somewhere else.</>,
    },
  ],
  them: {
    pricing: <>Free for one user; Solo $9.90 a month; Plus $15.90 and Pro $23.90 per user a month, billed monthly. Annual billing saves up to 40%.</>,
    tenPeople: <>$159 a month on Plus, or $239 on Pro, billed monthly</>,
    time: <>Yes; timesheet approvals on Pro</>,
    invoicing: <>Yes, from timesheets</>,
    payments: <>PM Payments in the US: card 2.95%, ACH 1.1%, plus $20 a month</>,
    payouts: <>—</>,
    support: <>—</>,
    ledger: <>— Syncs with QuickBooks Online and Xero</>,
  },
  strengths: [
    "Tasks, Kanban boards and time tracking in one app",
    "Gantt charts, scheduling and timesheet approvals on Pro",
    "Invoices built from timesheets",
    "A free plan for one user",
  ],
  exportHow: <>Export clients and invoices from Table View → Export CSV, and time from Reports → Detailed Time → Export CSV.</>,
  brings: "clients, time entries, and invoices with their payments. Projects are created from your time entries.",
  sources: [
    { label: "Paymo pricing", href: "https://www.paymoapp.com/pricing/" },
    { label: "Paymo invoicing", href: "https://www.paymoapp.com/invoicing-software/" },
    { label: "PM Payments", href: "https://help.paymoapp.com/en/invoices/how-to-use-pm-payments" },
    { label: "Paymo and QuickBooks Online", href: "https://help.paymoapp.com/en/articles/11809-quickbooks-online-integration" },
  ],
};

export default function SwitchPaymoPage() {
  return <SwitchPage data={data} />;
}
