import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// Harvest facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "Harvest",
  seoPath: "/switch-from-harvest",
  h1: "Keep the timesheets. Add the books.",
  lede: (
    <>
      Harvest tracks time and invoices it well. CherryWorks Pro does that too, and keeps the general ledger, contractor payouts
      and client support cases in the same place, at one price per firm with unlimited users.
    </>
  ),
  screen: SCREENS.time,
  painHeading: "Why firms look beyond Harvest",
  painIntro: "None of this is a knock on Harvest’s time tracking. It’s what changes as a firm grows around it.",
  painPoints: [
    {
      title: "Renewal prices moved",
      body: (
        <>
          Harvest is owned by Bending Spoons. Paid plans charge per seat, and additional invoices, projects, clients and tasks are
          billed by usage. In August 2026, trade press reported some renewals rising by as much as 1,500 percent.
        </>
      ),
    },
    {
      title: "The books live in a second system",
      body: <>Harvest syncs invoices and payments to QuickBooks Online or Xero, so the ledger, reconciliation and month-end close happen somewhere else.</>,
    },
    {
      title: "Contractors are paid elsewhere",
      body: <>Harvest doesn’t pay people itself. It connects to Deel for that, which is another account and another bill.</>,
    },
    {
      title: "Client requests sit in email",
      body: <>Harvest doesn’t include a help desk, so support requests, and the hours spent on them, are tracked by hand or in another tool.</>,
    },
  ],
  them: {
    pricing: <>Per seat: Teams $11 a month ($9 billed annually), Enterprise $17.50 ($14 annually), plus usage charges for additional invoices, projects, clients and tasks. A free plan covers one seat and two projects.</>,
    tenPeople: <>$110 a month on Teams billed monthly ($90 billed annually), before usage charges</>,
    time: <>Yes, with timers and timesheets</>,
    invoicing: <>Yes, from tracked time and expenses</>,
    payments: <>Stripe (card, and ACH for US clients) or PayPal</>,
    payouts: <>Through a Deel integration</>,
    support: <>—</>,
    ledger: <>— Syncs to QuickBooks Online or Xero</>,
  },
  strengths: [
    "Time tracking with timers, plus Mac and iOS apps",
    "Invoices built straight from tracked time and expenses",
    "A free plan for one person and two projects",
    "Integrations with QuickBooks Online, Xero and Deel",
  ],
  exportHow: (
    <>
      Export all time from Settings → Import/Export, clients from Manage → Clients → Export, and invoices from Invoices → Report →
      Export.
    </>
  ),
  brings: "clients, services, time entries, invoices and their payments, and past contractor payments from an expense export. Projects are created from your time entries.",
  sources: [
    { label: "Harvest pricing", href: "https://www.getharvest.com/pricing" },
    { label: "Harvest invoicing and payments", href: "https://www.getharvest.com/features/invoicing-and-payments" },
    { label: "Harvest online payment options", href: "https://support.getharvest.com/hc/en-us/articles/360048181232-Picking-an-online-payment-integration" },
    { label: "Harvest and Deel", href: "https://support.getharvest.com/hc/en-us/articles/16961146056589-Deel-Enabling-and-managing-the-Deel-connection" },
    { label: "Subscription Insider, Aug 22, 2026", href: "https://www.subscriptioninsider.com/blog/harvest-pricing-change-sends-some-renewals-up-1-500" },
    { label: "Silicon UK, Aug 31, 2026", href: "https://www.silicon.co.uk/e-enterprise/merger-acquisition/harvest-price-shock-631249" },
  ],
};

export default function SwitchHarvestPage() {
  return <SwitchPage data={data} />;
}
