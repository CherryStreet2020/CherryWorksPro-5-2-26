import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// Xero (US) facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "Xero",
  seoPath: "/switch-from-xero",
  h1: "Your ledger and your timesheets, in one place",
  lede: (
    <>
      Xero is a mature double-entry ledger with no per-user fees. CherryWorks Pro keeps a ledger too, plus timesheets, invoices
      built from billable hours, contractor payouts and client support cases.
    </>
  ),
  screen: SCREENS.invoices,
  painHeading: "Why services firms look beyond Xero",
  painIntro: "Xero’s books are solid. The gaps show up around the hours a firm sells and the people it pays.",
  painPoints: [
    {
      title: "Time tracking is on the top plan",
      body: <>Xero Projects, which tracks time and invoices it, comes with Established, $97 a month at list price.</>,
    },
    {
      title: "Early has monthly limits",
      body: <>The Early plan allows 20 invoices and quotes and 5 bills a month. Past that, you move up a plan.</>,
    },
    {
      title: "Paying people runs through partners",
      body: <>Payroll is Xero Payroll powered by Gusto, $36 a month plus $6 per employee or contractor at list price. Bill pay runs through Melio.</>,
    },
    {
      title: "No place for client support",
      body: <>Xero doesn’t include a help desk, so client requests and the hours spent on them are tracked somewhere else.</>,
    },
  ],
  them: {
    pricing: <>Per plan, no per-user fees: Early $27 (20 invoices and quotes, 5 bills a month), Growing $59 and Established $97 a month</>,
    time: <>Through Xero Projects, on Established</>,
    invoicing: <>Through Xero Projects, on Established</>,
    payments: <>Stripe and GoCardless</>,
    payouts: <>Gusto payroll add-on ($36 a month plus $6 per person); bill pay through Melio</>,
    support: <>—</>,
    ledger: <>Yes, double-entry; multi-currency on Established</>,
  },
  strengths: [
    "No per-user license fees on any plan",
    "A mature double-entry ledger with bank feeds",
    "Multi-currency and Projects on Established",
    "Payroll for employees and contractors through Gusto",
  ],
  exportHow: (
    <>
      Export contacts from Contacts → All contacts → Export, and invoices from Business → Invoices → Export. Use YYYY-MM-DD dates in
      the files.
    </>
  ),
  brings: "clients, services, and invoices with their payments. Time entries don’t come across from Xero, so time tracking starts fresh in CherryWorks Pro.",
  sources: [
    { label: "Xero pricing (US)", href: "https://www.xero.com/us/pricing-plans/" },
    { label: "Xero Established plan", href: "https://www.xero.com/us/pricing-plans/established/" },
    { label: "Xero online payments", href: "https://www.xero.com/us/accounting-software/accept-payments/" },
    { label: "Xero bill pay fees", href: "https://www.xero.com/us/pricing-plans/pricing-and-fees-for-online-bill-payments/" },
  ],
};

export default function SwitchXeroPage() {
  return <SwitchPage data={data} />;
}
