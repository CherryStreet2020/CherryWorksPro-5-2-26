import { Fragment, useState } from "react";
import { Link } from "wouter";
import { Check, Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink, TextLink,
} from "@/components/marketing/kit";
import { PLAN_PRICING, type PlanId } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";

// Every row below is gated in the server exactly as shown (server/routes/*: requirePlanTier / requireTier)
// and has a screen in the app. Endpoints with no UI are deliberately left off.
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
      "Time, expenses, invoices and online payments",
      `Full general ledger and ${REPORT_COUNT} reports`,
      "Invoices sent from your own mailbox",
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
      "Support cases and a Help Center for clients",
      "Timesheet and expense approvals",
      "Contractor payouts through Stripe Connect",
      "Bank feeds, the import wizard and API keys",
    ],
  },
  {
    id: "BUSINESS",
    name: "Business",
    slug: "business",
    fit: "For firms that also want to find and win new clients.",
    lead: "Everything in Professional, plus",
    points: [
      "Marketing Hub for prospects and campaigns",
      "Follow-up email sequences",
      "Prospects kept apart from your billing clients",
      "Period closes that lock the books",
    ],
  },
];

type Cell = boolean | string;
const MATRIX: { group: string; rows: { label: string; cells: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "Team and limits",
    rows: [
      { label: "Users", cells: ["Unlimited", "Unlimited", "Unlimited"] },
      { label: "Clients", cells: ["Up to 5", "Unlimited", "Unlimited"] },
      { label: "Projects", cells: ["Up to 3", "Unlimited", "Unlimited"] },
    ],
  },
  {
    group: "Time and expenses",
    rows: [
      { label: "Time tracking and weekly timesheets", cells: [true, true, true] },
      { label: "Expenses with receipts", cells: [true, true, true] },
      { label: "Timesheet and expense approvals", cells: [false, true, true] },
    ],
  },
  {
    group: "Billing and payments",
    rows: [
      { label: "Invoices built from tracked time", cells: [true, true, true] },
      { label: "Recurring invoices", cells: [true, true, true] },
      { label: "Send from Microsoft 365, Google or SMTP", cells: [true, true, true] },
      { label: "Client payments by card or ACH", cells: [true, true, true] },
      { label: "Bank feeds", cells: [false, true, true] },
    ],
  },
  {
    group: "Paying your team",
    rows: [
      { label: "What you owe each person, at their cost rate", cells: [true, true, true] },
      { label: "Contractor payouts through Stripe Connect", cells: [false, true, true] },
    ],
  },
  {
    group: "Books and reports",
    rows: [
      { label: "General ledger, journal entries and trial balance", cells: [true, true, true] },
      { label: `${REPORT_COUNT} built-in reports`, cells: [true, true, true] },
      { label: "Period closes", cells: [false, false, true] },
    ],
  },
  {
    group: "Client support",
    rows: [
      { label: "Support cases with hours that bill", cells: [false, true, true] },
      { label: "Help Center with one-time sign-in links", cells: [false, true, true] },
      { label: "Email-to-case from a Microsoft 365 mailbox", cells: [false, true, true] },
      { label: "SLA targets per client", cells: [false, true, true] },
      { label: "Jira Service Management import", cells: [false, true, true] },
    ],
  },
  {
    group: "Moving in and growing",
    rows: [
      { label: "Import from 8 platforms, with a preview first", cells: [false, true, true] },
      { label: "API keys and webhooks", cells: [false, true, true] },
      { label: "Marketing Hub", cells: [false, false, true] },
    ],
  },
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
    q: "Which plans include support cases?",
    a: "Professional and Business. That covers support cases, the Help Center for your clients, email-to-case from a Microsoft 365 mailbox, SLA targets per client and the Jira Service Management import.",
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
    a: "A prospecting layer on the Business plan: contacts, companies, tags and segments, email campaigns and follow-up sequences. Prospects are kept apart from your billing clients, so outreach never touches your invoices or reports.",
  },
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function CellMark({ value }: { value: Cell }) {
  if (typeof value === "string") return <span className="text-[12px] font-medium text-[#15171C] sm:text-sm">{value}</span>;
  return value ? (
    <>
      <Check className="mx-auto h-[18px] w-[18px] text-[#15171C]" aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <span className="text-[#B9B3A8]" aria-hidden="true">–</span>
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

      <PageHero className="!pb-12 md:!pb-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Pricing</Eyebrow>
            <Display testId="pricing-heading" className="mt-5">One flat price for your whole firm.</Display>
            <Lede className="mt-6 max-w-2xl">
              Every plan includes unlimited users and the full general ledger. Choose by how many clients you bill and what
              else you need to run.
            </Lede>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4" data-testid="billing-toggle">
            <span className={`text-[15px] font-medium ${annual ? "text-[#5F6672]" : "text-[#15171C]"}`}>Monthly</span>
            <button
              type="button"
              role="switch"
              aria-checked={annual}
              aria-label="Bill annually"
              onClick={() => setAnnual(!annual)}
              data-testid="button-toggle-billing"
              className="-mx-1 inline-flex h-11 w-14 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339]"
            >
              <span className={`relative block h-7 w-12 rounded-full transition-colors ${annual ? "bg-[#15171C]" : "bg-[#D9D4CB]"}`}>
                <span
                  className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${annual ? "translate-x-6" : "translate-x-1"}`}
                />
              </span>
            </button>
            <span className={`text-[15px] font-medium ${annual ? "text-[#15171C]" : "text-[#5F6672]"}`}>Annual</span>
            <span
              data-testid="badge-save-20"
              className="rounded-full border border-[#E6E2DA] bg-white px-3 py-1 text-[13px] font-semibold text-[#B32A30]"
            >
              Save about 20%
            </span>
          </div>
        </Container>
      </PageHero>

      <section className="pb-16 md:pb-20">
        <Container>
          <div className="grid gap-5 lg:grid-cols-3">
            {PLANS.map((plan) => {
              const price = PLAN_PRICING[plan.id];
              const featured = plan.id === "PROFESSIONAL";
              const perMonth = annual ? (price.annual / 12).toFixed(2) : String(price.monthly);
              return (
                <div
                  key={plan.id}
                  data-testid={`tier-card-${plan.slug}`}
                  className={`relative flex flex-col rounded-2xl bg-white p-7 md:p-8 ${featured ? "border-2 border-[#15171C]" : "border border-[#E6E2DA]"}`}
                >
                  {featured && (
                    <p className="absolute -top-3 left-7 rounded-full bg-[#15171C] px-3 py-1 text-xs font-semibold text-white">
                      Your trial runs on this plan
                    </p>
                  )}
                  <h2 className="font-display text-2xl font-semibold text-[#15171C]">{plan.name}</h2>
                  <p className="mt-2 min-h-[3rem] text-[15px] leading-relaxed text-[#5F6672]">{plan.fit}</p>

                  <div className="mt-6 flex items-baseline gap-1.5">
                    <span className="font-display text-5xl font-semibold tracking-tight text-[#15171C]">${perMonth}</span>
                    <span className="text-[15px] text-[#5F6672]">/mo</span>
                  </div>
                  <p className="mt-2 text-sm text-[#5F6672]">
                    {annual
                      ? `Billed ${usd(price.annual)}/yr · you save ${usd(price.monthly * 12 - price.annual)}`
                      : "Billed monthly · unlimited users"}
                  </p>

                  <Link
                    href={`/signup?plan=${plan.slug}${annual ? "&annual=true" : ""}`}
                    className={`mt-7 inline-flex h-12 items-center justify-center rounded-lg text-[15px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] ${featured ? "bg-[#CF3339] text-white hover:bg-[#B32A30]" : "border border-[#D9D4CB] bg-white text-[#15171C] hover:border-[#15171C]"}`}
                  >
                    <span data-testid={`button-signup-${plan.slug}`}>Start free trial</span>
                  </Link>

                  <div className="mt-8 border-t border-[#E6E2DA] pt-6">
                    {plan.lead && <p className="text-sm font-semibold text-[#15171C]">{plan.lead}</p>}
                    <ul className={`space-y-3 ${plan.lead ? "mt-4" : ""}`}>
                      {plan.points.map((pt, i) => (
                        <li
                          key={pt}
                          className="flex gap-3 text-[15px] leading-snug text-[#3D4350]"
                          data-testid={plan.id === "BUSINESS" && i === 0 ? "text-business-marketing-included" : undefined}
                        >
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#CF3339]" aria-hidden="true" />
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
            className="mt-5 flex flex-col gap-5 rounded-2xl border border-[#E6E2DA] bg-[#F4F1EB] p-7 md:flex-row md:items-center md:justify-between md:p-8"
          >
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl font-semibold text-[#15171C]">Enterprise</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                For larger firms that need custom terms, a security review or help planning the move. Tell us what you need
                and we’ll put together a quote.
              </p>
            </div>
            <ButtonLink href="/contact" variant="secondary" size="lg" className="shrink-0">Contact sales</ButtonLink>
          </div>

          <p className="mt-8 text-center text-sm text-[#5F6672]">
            14-day trial on Professional · You won’t be charged until day 15 · Cancel anytime
          </p>
        </Container>
      </section>

      <Section tone="white" testId="section-pricing-flat">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Eyebrow>Why flat pricing</Eyebrow>
              <Heading className="mt-4">Your bill doesn’t grow with your bench.</Heading>
            </div>
            <div className="space-y-5 text-[17px] leading-relaxed text-[#3D4350] lg:col-span-7">
              <p>
                Consulting teams change shape constantly. A contractor joins for one project, a partner firm lends two people
                for a quarter, someone part-time logs a few hours a month. Per-seat pricing charges you for every one of them.
              </p>
              <p>
                On CherryWorks Pro the price is set by the plan, not the headcount. A firm on Professional pays {usd(trial)} a
                month whether it has 4 people or 40, and adding five contractors for a project doesn’t change the bill.
              </p>
              <TextLink href="/compare" testId="link-pricing-compare">Compare CherryWorks Pro with other tools</TextLink>
            </div>
          </div>
        </Container>
      </Section>

      <Section testId="section-pricing-matrix">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Compare plans</Eyebrow>
            <Heading className="mt-4">What each plan includes</Heading>
          </div>

          <div className="mt-12 overflow-hidden rounded-2xl border border-[#E6E2DA] bg-white">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">Features included in each plan</caption>
              <colgroup>
                <col />
                <col className="w-[19%] sm:w-[18%]" />
                <col className="w-[19%] sm:w-[18%]" />
                <col className="w-[19%] sm:w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#E6E2DA]">
                  <th scope="col" className="px-4 py-4 text-sm font-semibold text-[#5F6672] sm:px-6">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col" className="px-1 py-4 text-center text-[13px] font-semibold text-[#15171C] sm:text-[15px]">
                      <span className="sm:hidden">{p.id === "PROFESSIONAL" ? "Pro" : p.name}</span>
                      <span className="hidden sm:inline">{p.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((g) => (
                  <Fragment key={g.group}>
                    <tr className="bg-[#FBFAF7]">
                      <th colSpan={4} scope="colgroup" className="border-y border-[#E6E2DA] px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#B32A30] sm:px-6">
                        {g.group}
                      </th>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.label} className="border-t border-[#EFEBE4] first:border-t-0">
                        <th scope="row" className="py-3.5 pl-3.5 pr-2 text-[14px] font-normal leading-snug text-[#3D4350] sm:px-6 sm:text-[15px]">
                          {r.label}
                        </th>
                        {r.cells.map((c, i) => (
                          <td key={i} className="px-1 py-3.5 text-center">
                            <CellMark value={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-faq">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <Eyebrow>Questions</Eyebrow>
              <Heading testId="faq-heading" className="mt-4">Pricing questions</Heading>
              <p className="mt-5 text-[17px] leading-relaxed text-[#3D4350]">
                Something not covered here? <Link href="/contact" className="font-semibold text-[#15171C] underline decoration-[#CF3339]/40 underline-offset-4 hover:decoration-[#CF3339]">Ask us</Link>.
              </p>
            </div>
            <div className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
              {FAQS.map((f, i) => (
                <details key={f.q} className="group py-5" data-testid={`faq-item-${i}`}>
                  <summary
                    data-testid={`button-faq-${i}`}
                    className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold text-[#15171C] [&::-webkit-details-marker]:hidden"
                  >
                    {f.q}
                    <Plus className="mt-1 h-5 w-5 shrink-0 text-[#5F6672] transition-transform group-open:rotate-45" aria-hidden="true" />
                  </summary>
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#3D4350]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-cta">
        <Container>
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-white text-balance md:text-5xl">
              Try it on your own work for 14 days.
            </h2>
            <p className="mt-5 text-lg text-white/70">
              The trial runs on Professional. You won’t be charged until day 15 · Cancel anytime.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">Start free trial</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight" testId="cta-book-demo">Book a demo</ButtonLink>
            </div>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
