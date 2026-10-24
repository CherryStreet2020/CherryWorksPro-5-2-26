import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// Wave (US) facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "Wave",
  seoPath: "/switch-from-wave",
  h1: "Wave covers the books. Add the hours behind them.",
  lede: (
    <>
      Wave gives small businesses free invoicing and double-entry bookkeeping, but it doesn’t track time. CherryWorks Pro puts
      timesheets, invoices built from billable hours, contractor payouts and client support on top of a full general ledger.
    </>
  ),
  screen: SCREENS.time,
  painHeading: "Why firms outgrow Wave",
  painIntro: "Wave is a good free start. Firms that bill by the hour tend to hit the same few gaps.",
  painPoints: [
    {
      title: "No time tracking",
      body: <>Wave doesn’t track time, so billable hours live in a separate tool or a spreadsheet before they reach an invoice.</>,
    },
    {
      title: "Paying contractors costs extra",
      body: <>Wave Payroll is $40 a month plus $6 per employee and $6 per contractor paid, at US list price.</>,
    },
    {
      title: "No place for client support",
      body: <>Wave doesn’t include a help desk, so client requests and the hours spent on them are tracked somewhere else.</>,
    },
  ],
  them: {
    pricing: <>Starter is free; Pro is $19 a month ($190 a year)</>,
    time: <>—</>,
    invoicing: <>— No tracked time to invoice from; invoices and estimates are unlimited</>,
    payments: <>Card 2.9% + $0.60 (Visa, Mastercard, Discover); bank payments 1%, $1 minimum</>,
    payouts: <>Wave Payroll: $40 a month plus $6 per employee and $6 per contractor paid</>,
    support: <>—</>,
    ledger: <>Yes, double-entry, with journal entries</>,
  },
  strengths: [
    "A free Starter plan with unlimited invoices, estimates and bookkeeping records",
    "Double-entry accounting with journal entries",
    "Pro at $19 a month, list price",
    "Payroll that pays employees and contractors and prepares 1099s",
  ],
  exportHow: (
    <>
      Use Settings → Data Export → Download all data for a ZIP of CSV files, or export customers from Sales → Customers → Export
      CSV.
    </>
  ),
  brings: "clients, invoices and their payments, and past contractor payments from an expense export. Wave doesn’t track time, so there are no time entries to bring.",
  sources: [
    { label: "Wave pricing", href: "https://www.waveapps.com/pricing" },
    { label: "Wave payments", href: "https://www.waveapps.com/payments" },
    { label: "Wave Payroll", href: "https://www.waveapps.com/payroll" },
    { label: "Paying contractors in Wave", href: "https://support.waveapps.com/hc/en-us/articles/19206812719508-Pay-independent-contractors" },
    { label: "Journal transactions in Wave", href: "https://support.waveapps.com/hc/en-us/articles/360039436812-What-are-journal-transactions-and-how-to-enter-them-in-Wave" },
  ],
};

export default function SwitchWavePage() {
  return <SwitchPage data={data} />;
}
