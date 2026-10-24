import { Fragment, useState } from "react";
import { Link } from "wouter";
import { Check, Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink, Note, TextLink, Closing,
  TRIAL_NOTE,
} from "@/components/marketing/kit";
import { SeatCalculator } from "@/components/marketing/seat-calculator";
import { PLAN_PRICING, type PlanId } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";
import { CURRENCIES } from "@shared/currencies";

const PLANS: {
  id: PlanId;
  name: string;
  slug: string;
  fit: string;
  lead?: string;
  points: string[];
}[] = [
  {
    id: "STARTER",
    name: "Starter",
    slug: "starter",
    fit: "For a small firm getting time, invoices and the books into one place.",
    points: [
      "Unlimited users",
      "Up to 5 clients and 3 projects",
      "Time, expenses, invoices, estimates and online payments",
      `Full general ledger and ${REPORT_COUNT} reports`,
      "Receipt reading and CherryAssist",
    ],
  },
  {
    id: "PROFESSIONAL",
    name: "Professional",
    slug: "professional",
    fit: "For firms that bill many clients, support them and pay a team.",
    lead: "Everything in Starter, plus",
    points: [
      "Unlimited clients and projects",
      "Support desk, Help Center and client portal",
      "Timesheet and expense approvals",
      "Contractor payouts through Stripe Connect",
      "Bank feeds, imports, the API and webhooks",
    ],
  },
  {
    id: "BUSINESS",
    name: "Business",
    slug: "business",
    fit: "For firms that also want to find and win new clients.",
    lead: "Everything in Professional, plus",
    points: [
      "Marketing Hub: contacts, campaigns, sequences and website chat",
      "Month-end and year-end close, multi-entity",
      "Dunning, payment plans and a multi-jurisdiction tax engine",
      "Report builder, scheduled reports and role dashboards",
    ],
  },
];

type Cell = boolean | string;
type Row = { label: string; cells: [Cell, Cell, Cell, Cell] };
const ALL: [Cell, Cell, Cell, Cell] = [true, true, true, true];
const PRO_UP: [Cell, Cell, Cell, Cell] = [false, true, true, true];
const BIZ_UP: [Cell, Cell, Cell, Cell] = [false, false, true, true];
const ENT: [Cell, Cell, Cell, Cell] = [false, false, false, true];

const MATRIX: { group: string; rows: Row[] }[] = [
  {
    group: "Team and limits",
    rows: [
      { label: "Users", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Clients", cells: ["Up to 5", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Projects", cells: ["Up to 3", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Onboarding for W-2, 1099 and corp-to-corp people", cells: ALL },
    ],
  },
  {
    group: "Time and expenses",
    rows: [
      { label: "Time tracking by day, week or month, and a timer", cells: ALL },
      { label: "Expenses with receipts", cells: ALL },
      { label: "Receipts read by AI", cells: ALL },
      { label: "Expense reports that post to the ledger", cells: ALL },
      { label: "Expense analytics", cells: ALL },
      { label: "Timesheet and expense approvals", cells: PRO_UP },
      { label: "Batch expense reports", cells: PRO_UP },
      { label: "Project budgets", cells: PRO_UP },
    ],
  },
  {
    group: "Billing and payments",
    rows: [
      { label: "Invoices built from tracked time", cells: ALL },
      { label: `Invoices in ${CURRENCIES.length} currencies`, cells: ALL },
      { label: "PDF invoices sent from Microsoft 365, Google or SMTP", cells: ALL },
      { label: "Estimates and proposals clients approve online", cells: ALL },
      { label: "Recurring invoices", cells: ALL },
      { label: "Client payments by card or ACH", cells: ALL },
      { label: "Client portal with overdue alerts", cells: ALL },
      { label: "Your logo on invoices and the portal", cells: ALL },
      { label: "Recurring invoices that charge the card on file", cells: PRO_UP },
      { label: "Custom invoice themes", cells: PRO_UP },
      { label: "Dunning", cells: BIZ_UP },
      { label: "Payment plans", cells: BIZ_UP },
      { label: "Multi-jurisdiction tax engine", cells: BIZ_UP },
    ],
  },
  {
    group: "Paying your team",
    rows: [
      { label: "What you owe each person, at their cost rate", cells: ALL },
      { label: "Contractor payouts through Stripe Connect", cells: PRO_UP },
      { label: "Expense reimbursements paid out automatically", cells: PRO_UP },
      { label: "Vendor 1099 management", cells: PRO_UP },
    ],
  },
  {
    group: "Books and reports",
    rows: [
      { label: "General ledger, journal entries and trial balance", cells: ALL },
      { label: `${REPORT_COUNT} built-in reports`, cells: ALL },
      { label: "Multi-currency reporting", cells: ALL },
      { label: "Bank feeds", cells: PRO_UP },
      { label: "Month-end close that locks the period", cells: BIZ_UP },
      { label: "Year-end close", cells: BIZ_UP },
      { label: "Multiple entities", cells: BIZ_UP },
      { label: "Report builder", cells: BIZ_UP },
      { label: "Scheduled reports by email", cells: BIZ_UP },
      { label: "Dashboards for each role", cells: BIZ_UP },
    ],
  },
  {
    group: "Support desk",
    rows: [
      { label: "Support cases with hours that bill", cells: PRO_UP },
      { label: "Help Center with one-time sign-in links", cells: PRO_UP },
      { label: "Email-to-case from a Microsoft 365 mailbox", cells: PRO_UP },
      { label: "SLA targets per client", cells: PRO_UP },
      { label: "Jira Service Management import", cells: PRO_UP },
    ],
  },
  {
    group: "Marketing Hub",
    rows: [
      { label: "Contacts and companies", cells: BIZ_UP },
      { label: "Tags and segments", cells: BIZ_UP },
      { label: "Email campaigns", cells: BIZ_UP },
      { label: "Sequences that stop when someone replies", cells: BIZ_UP },
      { label: "Activity timeline", cells: BIZ_UP },
      { label: "AI chat for your own website", cells: BIZ_UP },
      { label: "Contact import from CSV", cells: BIZ_UP },
      { label: "Prospects kept apart from billing clients", cells: BIZ_UP },
    ],
  },
  {
    group: "Platform",
    rows: [
      { label: "CherryAssist for how-to questions", cells: ALL },
      { label: "Import from 8 platforms, with a preview first", cells: PRO_UP },
      { label: "API keys and webhooks", cells: PRO_UP },
      { label: "Bulk edits", cells: BIZ_UP },
      { label: "Audit log search", cells: BIZ_UP },
    ],
  },
  {
    group: "Security and service",
    rows: [
      { label: "Priority email support", cells: BIZ_UP },
      { label: "Onboarding call", cells: BIZ_UP },
      { label: "SSO and SAML", cells: ENT },
      { label: "MFA required across the firm", cells: ENT },
      { label: "Sign in as a user, for support and IT", cells: ENT },
      { label: "Advanced file scanning", cells: ENT },
      { label: "Backup and restore drills", cells: ENT },
      { label: "Account manager", cells: ENT },
      { label: "Custom contract, SLA and DPA", cells: ENT },
      { label: "Volume pricing and a white-label option", cells: ENT },
    ],
  },
];

const COLUMNS = [
  { name: "Starter", short: "Starter" },
  { name: "Professional", short: "Pro" },
  { name: "Business", short: "Business" },
  { name: "Enterprise", short: "Ent." },
];

const FAQS = [
  {
    q: "Is there a free trial?",
    a: "Yes. The trial lasts 14 days and runs on the Professional plan. We collect a card when you sign up and you won’t be charged until day 15. Cancel before then and you pay nothing.",
  },
  {
    q: "Are users really unlimited?",
    a: "Yes, on every plan. Add employees, 1099 contractors and corp-to-corp partners without changing your bill.",
  },
  {
    q: "What happens when I outgrow Starter?",
    a: "Starter covers up to 5 clients and 3 projects. When you need more, move to Professional. Your data stays where it is; only the plan changes.",
  },
  {
    q: "Is the general ledger included on every plan?",
    a: "Yes. The chart of accounts, journal entries, trial balance and general ledger are on every plan, including Starter.",
  },
  {
    q: "Which plans include the support desk?",
    a: "Professional and Business. That covers support cases, the Help Center and portal for your clients, email-to-case from a Microsoft 365 mailbox, SLA targets per client and the Jira Service Management import.",
  },
  {
    q: "Can I bring my data from another tool?",
    a: "Yes, on Professional and Business. The import wizard reads exports from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro and Paymo, and shows you a preview before anything is written.",
  },
  {
    q: "How do I change plans or cancel?",
    a: "From Billing in Settings, which opens Stripe’s customer portal. There’s no contract and no cancellation fee.",
  },
  {
    q: "How is the subscription billed?",
    a: "By card through Stripe, monthly or annually. Annual billing costs about 20% less than paying month to month.",
  },
  {
    q: "How is my data kept separate from other firms?",
    a: "Every record belongs to your firm’s organization and every query is scoped to it, so one firm can’t read another’s data. Traffic is encrypted in transit, and card details are handled by Stripe rather than stored by us.",
  },
  {
    q: "What is Marketing Hub?",
    a: "The front office on the Business plan: contacts and companies, tags and segments, email campaigns, sequences that stop when someone replies, and an AI chat for your own website. Prospects are kept apart from your billing clients, so outreach never touches your invoices or reports.",
  },
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function CellMark({ value }: { value: Cell }) {
  if (typeof value === "string") return <span className="text-[13px] font-medium text-[#15171C] md:text-[15px]">{value}</span>;
  return value ? (
    <>
      <Check className="mx-auto h-[18px] w-[18px] text-[#15171C]" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <span className="text-[#B9B5AD]" aria-hidden="true">–</span>
      <span className="sr-only">Not included</span>
    </>
  );
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const trial = PLAN_PRICING.PROFESSIONAL.monthly;

  return (
    <MarketingShell>
      <SEO path="/pricing" />
      <FAQStructuredData faqs={FAQS} />

      <PageHero>
        <Container>
          <Eyebrow>Pricing</Eyebrow>
          <Display testId="pricing-heading" className="mt-4">One flat price for your whole firm.</Display>
          <Lede size="hero" className="mt-5 md:mt-6">
            Every plan includes unlimited users and the full general ledger. Choose by how many clients you bill and how much
            of the business you want to run here.
          </Lede>

          <div className="mt-9 flex flex-wrap items-center gap-3" data-testid="billing-toggle">
            <span className={`text-[15px] font-medium ${annual ? "text-[#6E727B]" : "text-[#15171C]"}`}>Monthly</span>
            <button
              type="button"
              role="switch"
              aria-checked={annual}
              aria-label="Bill annually"
              onClick={() => setAnnual(!annual)}
              data-testid="button-toggle-billing"
              className="inline-flex h-11 w-14 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C]"
            >
              <span className={`relative block h-7 w-12 rounded-full transition-colors ${annual ? "bg-[#15171C]" : "bg-[#D5D2CB]"}`}>
                <span
                  className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${annual ? "translate-x-6" : "translate-x-1"}`}
                />
              </span>
            </button>
            <span className={`text-[15px] font-medium ${annual ? "text-[#15171C]" : "text-[#6E727B]"}`}>Annual</span>
            <span data-testid="badge-save-20" className="text-[14px] font-medium text-[#CF3339]">Save about 20%</span>
          </div>
        </Container>
      </PageHero>

      <section className="pt-12 md:pt-16">
        <Container>
          <div className="grid border-t border-[#15171C] lg:grid-cols-3">
            {PLANS.map((plan, i) => {
              const price = PLAN_PRICING[plan.id];
              const featured = plan.id === "PROFESSIONAL";
              const perMonth = annual ? (price.annual / 12).toFixed(2) : String(price.monthly);
              return (
                <div
                  key={plan.id}
                  data-testid={`tier-card-${plan.slug}`}
                  className={`flex flex-col py-8 lg:pb-4 lg:pr-10 ${i > 0 ? "border-t border-[#E6E3DD] lg:border-l lg:border-t-0 lg:pl-10" : ""}`}
                >
                  <h2 className="flex items-baseline justify-between gap-4 text-[22px] font-medium tracking-[-0.015em] text-[#15171C]">
                    {plan.name}
                    {featured && <span className="text-[14px] font-medium tracking-normal text-[#CF3339]">Your trial runs on this plan</span>}
                  </h2>
                  <p className="mt-2 text-[16px] leading-[1.5] text-[#5C606A] lg:min-h-[48px]">{plan.fit}</p>

                  <p className="mt-6 text-[52px] font-medium leading-none tracking-[-0.035em] text-[#15171C]">
                    ${perMonth}<span className="text-[16px] font-normal tracking-normal text-[#6E727B]"> /month</span>
                  </p>
                  <p className="mt-3 text-[14px] text-[#6E727B]">
                    {annual
                      ? `Billed ${usd(price.annual)}/yr · you save ${usd(price.monthly * 12 - price.annual)}`
                      : "Billed monthly · unlimited users"}
                  </p>

                  <Link
                    href={`/signup?plan=${plan.slug}${annual ? "&annual=true" : ""}`}
                    className={`mt-7 inline-flex h-11 items-center justify-center rounded-full px-[22px] text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C] lg:self-start ${featured ? "bg-[#15171C] text-white hover:bg-[#2A2D35]" : "border border-[#D5D2CB] bg-white text-[#15171C] hover:border-[#15171C]"}`}
                  >
                    <span data-testid={`button-signup-${plan.slug}`}>Start your trial</span>
                  </Link>

                  <div className="mt-8">
                    {plan.lead && <p className="text-[15px] font-medium text-[#15171C]">{plan.lead}</p>}
                    <ul className={plan.lead ? "mt-3" : ""}>
                      {plan.points.map((pt, j) => (
                        <li
                          key={pt}
                          className="border-t border-[#E6E3DD] py-3 text-[15px] leading-snug text-[#5C606A]"
                          data-testid={plan.id === "BUSINESS" && j === 0 ? "text-business-marketing-included" : undefined}
                        >
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            data-testid="tier-card-enterprise"
            className="mt-6 flex flex-col gap-5 border-t border-[#E6E3DD] pt-8 md:flex-row md:items-center md:justify-between"
          >
            <div className="max-w-[640px]">
              <h2 className="text-[22px] font-medium tracking-[-0.015em] text-[#15171C]">Enterprise</h2>
              <p className="mt-2 text-[16px] leading-[1.55] text-[#5C606A]">
                For larger firms that need SSO, custom terms, a security review or help planning the move. Tell us what you need
                and we’ll put together a quote.
              </p>
            </div>
            <ButtonLink href="/contact" variant="secondary" className="shrink-0">Contact sales</ButtonLink>
          </div>

          <Note className="mt-8">{TRIAL_NOTE}</Note>
        </Container>
      </section>

      <Section testId="section-pricing-flat">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <Heading>Your bill doesn’t grow with your team.</Heading>
            <div className="space-y-4 text-[17px] leading-[1.6] text-[#5C606A] md:text-[18px]">
              <p>
                Services teams change shape constantly. A contractor joins for one project, a partner firm lends two people for a
                quarter, someone part-time logs a few hours a month. Per-user pricing charges you for every one of them.
              </p>
              <p>
                Here the price is set by the plan, not the headcount. A firm on Professional pays {usd(trial)} a month whether it
                has 4 people or 40.
              </p>
              <p className="text-[15px]">
                <TextLink href="/compare" testId="link-pricing-compare">Compare CherryWorks Pro with other tools</TextLink>
              </p>
            </div>
          </div>
          <div className="mt-12 md:mt-16">
            <SeatCalculator />
          </div>
        </Container>
      </Section>

      <Section testId="section-pricing-matrix">
        <Container>
          <Heading>What each plan includes</Heading>

          <table className="mt-10 w-full table-fixed border-collapse text-left md:mt-14">
            <caption className="sr-only">Features included in each plan</caption>
            <colgroup>
              <col />
              {COLUMNS.map((c) => <col key={c.name} className="w-[15%] md:w-[14%]" />)}
            </colgroup>
            <thead className="sticky top-16 z-10 bg-[#FBFAF8]">
              <tr className="border-b border-[#15171C]">
                <th scope="col" className="pb-4 pt-2">
                  <span className="sr-only">Feature</span>
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.name} scope="col" className="px-1 pb-4 pt-2 text-center text-[13px] font-medium text-[#15171C] md:text-[15px]">
                    <span className="md:hidden">{c.short}</span>
                    <span className="hidden md:inline">{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((g) => (
                <Fragment key={g.group}>
                  <tr>
                    <th colSpan={5} scope="colgroup" className="pb-3 pt-10 text-[17px] font-medium text-[#15171C] md:text-[19px]">
                      {g.group}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-t border-[#E6E3DD]">
                      <th scope="row" className="py-3 pr-3 text-[14px] font-normal leading-snug text-[#5C606A] md:text-[15.5px]">
                        {r.label}
                      </th>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-1 py-3 text-center">
                          <CellMark value={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Container>
      </Section>

      <Section testId="section-faq">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Heading testId="faq-heading">Pricing questions</Heading>
              <p className="mt-5 text-[17px] leading-[1.6] text-[#5C606A]">
                Something not covered here? <TextLink href="/contact">Ask us</TextLink>.
              </p>
            </div>
            <div className="border-b border-[#E6E3DD]">
              {FAQS.map((f, i) => (
                <details key={f.q} className="group border-t border-[#E6E3DD] py-5" data-testid={`faq-item-${i}`}>
                  <summary
                    data-testid={`button-faq-${i}`}
                    className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-medium text-[#15171C] md:text-[18px] [&::-webkit-details-marker]:hidden"
                  >
                    {f.q}
                    <Plus className="mt-1 h-5 w-5 shrink-0 text-[#6E727B] transition-transform group-open:rotate-45" strokeWidth={1.75} aria-hidden="true" />
                  </summary>
                  <p className="mt-3 max-w-[620px] text-[16px] leading-[1.6] text-[#5C606A]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Closing
        heading="Try it on your own work for 14 days."
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
