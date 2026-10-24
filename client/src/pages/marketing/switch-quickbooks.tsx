import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// QuickBooks Online (US) facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "QuickBooks",
  seoPath: "/switch-from-quickbooks",
  h1: "Books built around the hours you bill",
  lede: (
    <>
      QuickBooks Online is a capable general ledger. CherryWorks Pro has one too, built around timesheets, invoices from billable
      hours, contractor payouts and client support, with unlimited users on every plan.
    </>
  ),
  screen: SCREENS.invoices,
  painHeading: "Why services firms look beyond QuickBooks",
  painIntro: "QuickBooks is built for every kind of small business. Firms that sell hours often end up adding tools around it.",
  painPoints: [
    {
      title: "Users are capped by plan",
      body: <>Full users are capped at 1 on Simple Start, 3 on Essentials, 5 on Plus and 25 on Advanced. Growing past a cap means moving up a plan.</>,
    },
    {
      title: "Fuller time tracking is a second product",
      body: <>Adding employee time to invoices starts on Essentials. For fuller time tracking, Intuit sells QuickBooks Time as a separate subscription.</>,
    },
    {
      title: "Paying contractors is an add-on",
      body: <>Direct deposit to contractors and 1099 e-filing come with the Contractor Payments add-on, $25 a month for up to 20 contractors at list price.</>,
    },
    {
      title: "No place for client support",
      body: <>QuickBooks doesn’t include a help desk, so client requests and the hours spent on them are tracked somewhere else.</>,
    },
  ],
  them: {
    pricing: <>Per plan: Simple Start $38, Essentials $85, Plus $140 and Advanced $340 a month, with 1, 3, 5 or 25 users</>,
    time: <>Employee time on Essentials and up; QuickBooks Time is sold separately</>,
    invoicing: <>Yes, on Essentials and up</>,
    payments: <>QuickBooks Payments: card 2.99%, ACH 1%</>,
    payouts: <>Contractor Payments add-on, $25 a month for up to 20 contractors, with 1099 e-filing</>,
    support: <>—</>,
    ledger: <>Yes, double-entry; bank connections on every plan</>,
  },
  strengths: [
    "A full double-entry ledger that accountants and bookkeepers widely use",
    "Bank connections on every plan",
    "Payroll for W-2 staff through QuickBooks Payroll",
    "Inventory tracking and project profitability on Plus and up",
  ],
  exportHow: (
    <>
      In QuickBooks Online, use the Settings gear → Export Data, or open a report and choose Export. Save customers, products and
      services, time, invoices and expenses as CSV.
    </>
  ),
  brings: "clients, services, time entries, invoices and their payments, and past contractor payments from an expense export. Projects are created from your time entries.",
  sources: [
    { label: "QuickBooks Online pricing", href: "https://quickbooks.intuit.com/pricing/" },
    { label: "QuickBooks Payments rates", href: "https://quickbooks.intuit.com/payments/payment-rates/" },
    { label: "QuickBooks Contractor Payments", href: "https://quickbooks.intuit.com/payroll/contractor-payments/" },
  ],
};

export default function SwitchQuickBooksPage() {
  return <SwitchPage data={data} />;
}
