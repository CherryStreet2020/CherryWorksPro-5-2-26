import { SwitchPage, SCREENS, type SwitchPageData } from "@/components/marketing/switch-page";

// Scoro facts checked October 2026 against the sources listed below.
const data: SwitchPageData = {
  name: "Scoro",
  seoPath: "/switch-from-scoro",
  h1: "Time, billing and books, priced per firm",
  lede: (
    <>
      Scoro brings CRM, quoting, resource planning and time billing together, and leaves the books to your accounting software.
      CherryWorks Pro keeps time, invoicing, the general ledger, contractor payouts and client support in one place, with
      unlimited users.
    </>
  ),
  screen: SCREENS.time,
  painHeading: "Why firms look beyond Scoro",
  painIntro: "Scoro covers a lot of ground. Firms usually look elsewhere over seat costs and the accounting that sits outside it.",
  painPoints: [
    {
      title: "Per-user pricing with a minimum",
      body: <>Plans run from $17 to $57 per user a month at list price, with at least 5 users on every plan.</>,
    },
    {
      title: "The books stay somewhere else",
      body: <>Scoro is clear that your accounting software stays the books. It syncs with Xero, QuickBooks and others.</>,
    },
    {
      title: "Invoicing depends on the plan",
      body: <>Invoicing uses Scoro’s Invoice app, which isn’t part of the Projects & Resources plan.</>,
    },
    {
      title: "Contractors are paid elsewhere",
      body: <>Scoro doesn’t pay contractors, so payouts run through payroll, your bank or another tool.</>,
    },
  ],
  them: {
    pricing: <>Per user, 5-user minimum: Time-billing $17, Projects & Resources $29, Quote to Cash $29 and End-to-end $57 a month. Annual billing is 13–17% less.</>,
    tenPeople: <>$170 to $570 a month, depending on plan</>,
    time: <>Yes</>,
    invoicing: <>Yes, through the Invoice app (not in Projects & Resources)</>,
    payments: <>Stripe payment links on invoices</>,
    payouts: <>—</>,
    support: <>— Has a customer portal; no help desk</>,
    ledger: <>— Syncs with Xero, QuickBooks and other accounting software</>,
  },
  strengths: [
    "CRM, quotes and resource planning alongside time billing",
    "Project planning and resource scheduling in the same workspace",
    "A customer portal for sharing work with clients",
    "Integrations with Xero, QuickBooks and other accounting systems",
  ],
  exportHow: <>From any Scoro list view, choose Export displayed columns with a comma separator. Export clients, time, invoices and expenses.</>,
  brings: "clients, time entries, invoices and their payments, and past contractor payments from an expense export. Projects are created from your time entries.",
  sources: [
    { label: "Scoro pricing", href: "https://www.scoro.com/pricing/" },
    { label: "Scoro project accounting", href: "https://www.scoro.com/use-case/project-accounting/" },
    { label: "Scoro customer portal", href: "https://support.scoro.com/hc/en-us/articles/12404614068109-Customer-portal-as-a-user" },
  ],
};

export default function SwitchScoroPage() {
  return <SwitchPage data={data} />;
}
