import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// BigTime facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "BigTime",
  seoPath: "/switch-from-bigtime",
  h1: "Time and billing, with the ledger built in",
  lede: (
    <>
      BigTime is time and billing software for professional services firms that connects to your accounting system. CherryWorks
      Pro covers time and billing too, and keeps the general ledger, contractor payouts and client support cases in the same
      place, with unlimited users.
    </>
  ),
  screen: SCREENS.time,
  painHeading: "Why firms look beyond BigTime",
  painIntro: "BigTime does time and billing thoroughly. Firms usually look elsewhere over seat costs and the systems around it.",
  painPoints: [
    {
      title: "Priced per user",
      body: <>BigTime Essentials starts at $20 per user a month at list price. Advanced and Premier are quoted, so cost rises with every person you add.</>,
    },
    {
      title: "The books live in a second system",
      body: <>BigTime connects to QuickBooks, and to Sage Intacct on Premier, rather than keeping a general ledger of its own.</>,
    },
    {
      title: "Contractors are paid elsewhere",
      body: <>BigTime doesn’t pay contractors, so payouts run through payroll, your bank or another tool.</>,
    },
    {
      title: "A portal, not a help desk",
      body: <>Advanced and up include a self-service client portal, but there’s no help desk for client support requests.</>,
    },
  ],
  them: {
    pricing: <>Per user: Essentials starts at $20 a month; Advanced, Premier and Enterprise are quoted</>,
    tenPeople: <>From $200 a month on Essentials</>,
    time: <>Yes, on every plan</>,
    invoicing: <>Yes, from approved time</>,
    payments: <>Card and ACH</>,
    payouts: <>—</>,
    support: <>— Self-service client portal on Advanced and up</>,
    ledger: <>— Connects to QuickBooks; Sage Intacct on Premier</>,
  },
  strengths: [
    "Time, expenses, invoicing and payments on every plan",
    "A self-service client portal on Advanced and up",
    "Resource management as a separate module",
    "Salesforce and Jira integrations on Advanced and up",
  ],
  exportHow: <>In BigTime, open Reports → Customize → Export Data and save clients, time, invoices and expenses as CSV.</>,
  brings: "clients, time entries, invoices and their payments, and past contractor payments from an expense export. Projects are created from your time entries.",
  sources: [
    { label: "BigTime pricing", href: "https://www.bigtime.net/pricing/" },
    { label: "BigTime billing and invoicing", href: "https://www.bigtime.net/features/billing-and-invoicing-software/" },
  ],
};

export default function SwitchBigTimePage() {
  return <SwitchPage data={data} />;
}
