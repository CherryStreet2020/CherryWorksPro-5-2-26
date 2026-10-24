import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// FreshBooks (US) facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "FreshBooks",
  seoPath: "/switch-from-freshbooks",
  h1: "Invoicing for the whole team, priced per firm",
  lede: (
    <>
      FreshBooks is polished invoicing and accounting with time tracking on every plan. CherryWorks Pro covers that ground with
      unlimited users, and adds contractor payouts from tracked hours and client support cases.
    </>
  ),
  screen: SCREENS.invoices,
  painHeading: "Why growing firms look beyond FreshBooks",
  painIntro: "FreshBooks is easy to start with. The costs and gaps tend to show up as the team grows.",
  painPoints: [
    {
      title: "Each team member adds to the bill",
      body: <>Team members are $11 a month each on top of the plan, at list price. Only Select includes two.</>,
    },
    {
      title: "Double-entry starts on Plus",
      body: <>Double-entry accounting reports come with Plus and up. Lite doesn’t include them.</>,
    },
    {
      title: "Paying contractors runs through payroll",
      body: <>FreshBooks Payroll, powered by Gusto, is $40 a month plus $6 per person at list price.</>,
    },
    {
      title: "No place for client support",
      body: <>FreshBooks doesn’t include a help desk, so client requests and the hours spent on them are tracked somewhere else.</>,
    },
  ],
  them: {
    pricing: <>Per plan, plus $11 a month per team member: Lite $23 (5 billable clients), Plus $43 (50) and Premium $70 (unlimited) a month; Select is quoted</>,
    tenPeople: <>$142 a month on Plus: the plan plus nine team members</>,
    time: <>Yes, on every plan</>,
    invoicing: <>Yes, from tracked time</>,
    payments: <>FreshBooks Payments, powered by Stripe: card and ACH</>,
    payouts: <>FreshBooks Payroll (Gusto): $40 a month plus $6 per person</>,
    support: <>—</>,
    ledger: <>Double-entry accounting on Plus and up</>,
  },
  strengths: [
    "Clean, easy invoicing, with time tracking on every plan",
    "Estimates on every plan and proposals on Plus and up",
    "Double-entry accounting reports on Plus and up",
    "Payroll for employees and contractors through FreshBooks Payroll",
  ],
  exportHow: (
    <>
      Export clients, vendors, services, invoices and expenses as CSV from each section, and time from Reports → Time Entry Details.
    </>
  ),
  brings: "clients, services, time entries, invoices and their payments, and past contractor payments from an expense export, using your vendor list to tell which payees are contractors. Projects are created from your time entries.",
  sources: [
    { label: "FreshBooks pricing", href: "https://www.freshbooks.com/pricing" },
    { label: "FreshBooks Payments", href: "https://support.freshbooks.com/hc/en-us/articles/24999759052429-How-do-I-accept-online-payments-with-FreshBooks-Payments-powered-by-Stripe" },
    { label: "FreshBooks Payroll", href: "https://www.freshbooks.com/hub/payroll/freshbooks-payroll" },
    { label: "FreshBooks chart of accounts", href: "https://support.freshbooks.com/hc/en-us/articles/360006976571-What-is-the-Chart-of-Accounts" },
  ],
};

export default function SwitchFreshBooksDetailPage() {
  return <SwitchPage data={data} />;
}
