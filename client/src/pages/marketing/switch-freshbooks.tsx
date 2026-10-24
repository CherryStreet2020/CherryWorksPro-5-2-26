import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink,
} from "@/components/marketing/kit";
import { MarketingHubBand, ClosingCta } from "@/components/marketing/switch-page";
import { PLAN_PRICING } from "@shared/plan-pricing";

/**
 * /compare — one comparison table across the eight products we have switch
 * guides for, plus a tile linking to each guide. Competitor cells are US list
 * prices and published features as of October 2026; every vendor's source is
 * listed under the table, and the detail (with more sources) lives on each
 * /switch-from-* page.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type RowKey = "price" | "model" | "time" | "invoicing" | "payments" | "payouts" | "support" | "ledger";

const ROWS: { key: RowKey; label: string }[] = [
  { key: "price", label: "List price, as of October 2026" },
  { key: "model", label: "How it’s priced" },
  { key: "time", label: "Time tracking" },
  { key: "invoicing", label: "Invoices from tracked time" },
  { key: "payments", label: "Online payments" },
  { key: "payouts", label: "Paying contractors" },
  { key: "support", label: "Client support" },
  { key: "ledger", label: "Double-entry ledger" },
];

type Product = {
  id: string;
  name: string;
  /** Full wording, for the two-product view. */
  cells: Record<RowKey, ReactNode>;
  /** Short wording, for the nine-column grid. */
  brief: Record<RowKey, ReactNode>;
};

const CHERRY: Product = {
  id: "cherryworks",
  name: "CherryWorks Pro",
  cells: {
    price: (
      <>
        {money(PLAN_PRICING.STARTER.monthly)}, {money(PLAN_PRICING.PROFESSIONAL.monthly)} or{" "}
        {money(PLAN_PRICING.BUSINESS.monthly)} a month
      </>
    ),
    model: <>Per firm, unlimited users on every plan</>,
    time: <>Timers and timesheets; approvals on Professional and up</>,
    invoicing: <>Yes</>,
    payments: <>Card and ACH</>,
    payouts: <>Hours × cost rate; Stripe Connect or a recorded payment, on Professional and up</>,
    support: <>Support cases and a client Help Center, on Professional and up</>,
    ledger: <>Yes, on every plan</>,
  },
  brief: {
    price: <>{money(PLAN_PRICING.STARTER.monthly)}, {money(PLAN_PRICING.PROFESSIONAL.monthly)} or {money(PLAN_PRICING.BUSINESS.monthly)} a month</>,
    model: <>Per firm, unlimited users</>,
    time: <>Yes</>,
    invoicing: <>Yes</>,
    payments: <>Card, ACH</>,
    payouts: <>Built in, Professional and up</>,
    support: <>Cases and a Help Center, Professional and up</>,
    ledger: <>Every plan</>,
  },
};

const COMPETITORS: Product[] = [
  {
    id: "freshbooks",
    name: "FreshBooks",
    cells: {
      price: <>$23, $43 or $70 a month; Select is quoted</>,
      model: <>Per plan, plus $11 a month per team member</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Card and ACH, through Stripe</>,
      payouts: <>FreshBooks Payroll add-on (Gusto)</>,
      support: <>—</>,
      ledger: <>Plus and up</>,
    },
    brief: {
      price: <>$23 to $70 a month; Select quoted</>,
      model: <>Per plan + $11 per team member</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Card, ACH</>,
      payouts: <>Payroll add-on</>,
      support: <>—</>,
      ledger: <>Plus and up</>,
    },
  },
  {
    id: "quickbooks",
    name: "QuickBooks Online",
    cells: {
      price: <>$38, $85, $140 or $340 a month</>,
      model: <>Per plan, with 1 to 25 users</>,
      time: <>Essentials and up; QuickBooks Time is sold separately</>,
      invoicing: <>Essentials and up</>,
      payments: <>Card 2.99%, ACH 1%</>,
      payouts: <>Contractor Payments add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
    brief: {
      price: <>$38 to $340 a month</>,
      model: <>Per plan, 1 to 25 users</>,
      time: <>Essentials and up</>,
      invoicing: <>Essentials and up</>,
      payments: <>Card, ACH</>,
      payouts: <>Add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
  },
  {
    id: "xero",
    name: "Xero",
    cells: {
      price: <>$27, $59 or $97 a month</>,
      model: <>Per plan, no per-user fees</>,
      time: <>Through Xero Projects, on Established</>,
      invoicing: <>Through Xero Projects, on Established</>,
      payments: <>Stripe and GoCardless</>,
      payouts: <>Gusto payroll add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
    brief: {
      price: <>$27 to $97 a month</>,
      model: <>Per plan</>,
      time: <>Established, via Projects</>,
      invoicing: <>Established, via Projects</>,
      payments: <>Stripe, GoCardless</>,
      payouts: <>Gusto add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
  },
  {
    id: "wave",
    name: "Wave",
    cells: {
      price: <>Free, or $19 a month for Pro</>,
      model: <>Per plan</>,
      time: <>—</>,
      invoicing: <>— No time tracking to invoice from</>,
      payments: <>Card and bank payments</>,
      payouts: <>Wave Payroll add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
    brief: {
      price: <>Free, or $19 a month</>,
      model: <>Per plan</>,
      time: <>—</>,
      invoicing: <>—</>,
      payments: <>Card, bank</>,
      payouts: <>Payroll add-on</>,
      support: <>—</>,
      ledger: <>Yes</>,
    },
  },
  {
    id: "harvest",
    name: "Harvest",
    cells: {
      price: <>$11 or $17.50 per seat a month, plus usage charges; free for one seat</>,
      model: <>Per seat, plus usage</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Stripe or PayPal</>,
      payouts: <>Deel integration</>,
      support: <>—</>,
      ledger: <>— Syncs to QuickBooks Online or Xero</>,
    },
    brief: {
      price: <>$11 or $17.50 per seat a month, plus usage</>,
      model: <>Per seat + usage</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Stripe, PayPal</>,
      payouts: <>Deel integration</>,
      support: <>—</>,
      ledger: <>— Syncs to QuickBooks or Xero</>,
    },
  },
  {
    id: "bigtime",
    name: "BigTime",
    cells: {
      price: <>From $20 per user a month; higher plans are quoted</>,
      model: <>Per user</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Card and ACH</>,
      payouts: <>—</>,
      support: <>Client portal, on Advanced and up</>,
      ledger: <>— Connects to QuickBooks or Sage Intacct</>,
    },
    brief: {
      price: <>From $20 per user a month</>,
      model: <>Per user</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Card, ACH</>,
      payouts: <>—</>,
      support: <>Client portal, Advanced and up</>,
      ledger: <>— Connects to QuickBooks or Sage Intacct</>,
    },
  },
  {
    id: "scoro",
    name: "Scoro",
    cells: {
      price: <>$17 to $57 per user a month</>,
      model: <>Per user, 5-user minimum</>,
      time: <>Yes</>,
      invoicing: <>Invoice app; not in Projects & Resources</>,
      payments: <>Stripe payment links</>,
      payouts: <>—</>,
      support: <>Customer portal</>,
      ledger: <>— Syncs with Xero, QuickBooks and others</>,
    },
    brief: {
      price: <>$17 to $57 per user a month</>,
      model: <>Per user, 5 minimum</>,
      time: <>Yes</>,
      invoicing: <>All plans but Projects & Resources</>,
      payments: <>Stripe payment links</>,
      payouts: <>—</>,
      support: <>Customer portal</>,
      ledger: <>— Syncs to Xero, QuickBooks and others</>,
    },
  },
  {
    id: "paymo",
    name: "Paymo",
    cells: {
      price: <>Free for one user; Solo $9.90; Plus $15.90 or Pro $23.90 per user a month</>,
      model: <>Per user</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>PM Payments: card and ACH</>,
      payouts: <>—</>,
      support: <>—</>,
      ledger: <>— Syncs with QuickBooks Online and Xero</>,
    },
    brief: {
      price: <>Free to $23.90 per user a month</>,
      model: <>Per user</>,
      time: <>Yes</>,
      invoicing: <>Yes</>,
      payments: <>Card, ACH</>,
      payouts: <>—</>,
      support: <>—</>,
      ledger: <>— Syncs to QuickBooks Online or Xero</>,
    },
  },
];

const SOURCES: { label: string; href: string }[] = [
  { label: "FreshBooks", href: "https://www.freshbooks.com/pricing" },
  { label: "QuickBooks Online", href: "https://quickbooks.intuit.com/pricing/" },
  { label: "Xero", href: "https://www.xero.com/us/pricing-plans/" },
  { label: "Wave", href: "https://www.waveapps.com/pricing" },
  { label: "Harvest", href: "https://www.getharvest.com/pricing" },
  { label: "BigTime", href: "https://www.bigtime.net/pricing/" },
  { label: "Scoro", href: "https://www.scoro.com/pricing/" },
  { label: "Paymo", href: "https://www.paymoapp.com/pricing/" },
];

type Guide = { id: string; name: string; href: string; summary: string };

const GUIDES: Guide[] = [
  { id: "freshbooks", name: "FreshBooks", href: "/switch-from-freshbooks", summary: "Invoicing priced per team member, with payroll as an add-on." },
  { id: "quickbooks", name: "QuickBooks Online", href: "/switch-from-quickbooks", summary: "Plans capped at 1 to 25 users, with contractor payments as an add-on." },
  { id: "xero", name: "Xero", href: "/switch-from-xero", summary: "Time tracking through Projects on Established, and payroll through Gusto." },
  { id: "wave", name: "Wave", href: "/switch-from-wave", summary: "Free bookkeeping and invoicing, without time tracking." },
  { id: "harvest", name: "Harvest", href: "/switch-from-harvest", summary: "Per-seat time tracking plus usage charges, with the books in a second system." },
  { id: "bigtime", name: "BigTime", href: "/switch-from-bigtime", summary: "Per-user time and billing that connects to your accounting system." },
  { id: "scoro", name: "Scoro", href: "/switch-from-scoro", summary: "Per-user work management with a 5-user minimum, and accounting kept elsewhere." },
  { id: "paymo", name: "Paymo", href: "/switch-from-paymo", summary: "Per-user projects and time, syncing to QuickBooks Online or Xero." },
  {
    id: "jira",
    name: "Jira Service Management",
    href: "/switch-from-jira-service-management",
    summary: "Bring your support cases across, closed ones included, with their comments and attachments.",
  },
];

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All eight" },
  ...COMPETITORS.map((c) => ({ id: c.id, label: c.name })),
];

function CompareTable({ selected }: { selected: string }) {
  const single = selected !== "all";
  const columns = [CHERRY, ...COMPETITORS.filter((c) => !single || c.id === selected)];
  const caption = single
    ? `CherryWorks Pro and ${columns[1].name} compared`
    : "CherryWorks Pro and eight other products compared";

  if (single) {
    // Two products: a readable three-column table that stacks into cards on phones.
    const other = columns[1];
    const cell = "align-top px-6 py-5 max-md:block max-md:p-0";
    const colLabel = "mb-1 block text-[12px] font-semibold uppercase tracking-[0.1em] md:hidden";
    return (
      <div className="overflow-hidden rounded-xl border border-[#E6E2DA] bg-white">
        <table data-testid="comparison-table" className="w-full border-collapse text-left text-[15px] leading-relaxed max-md:block">
          <caption className="sr-only">{caption}</caption>
          <thead className="max-md:hidden">
            <tr className="border-b border-[#E6E2DA] bg-[#FBFAF7]">
              <th scope="col" className="w-[24%] px-6 py-4"><span className="sr-only">Feature</span></th>
              <th scope="col" className="w-[38%] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#B32A30]">{CHERRY.name}</th>
              <th scope="col" className="w-[38%] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#5F6672]">{other.name}</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {ROWS.map((r) => (
              <tr key={r.key} className="border-b border-[#E6E2DA] last:border-0 max-md:block max-md:space-y-4 max-md:px-5 max-md:py-6">
                <th scope="row" className={`${cell} font-semibold text-[#15171C]`}>{r.label}</th>
                <td className={`${cell} text-[#3D4350]`}>
                  <span className={`${colLabel} text-[#B32A30]`}>{CHERRY.name}</span>
                  {CHERRY.cells[r.key]}
                </td>
                <td className={`${cell} text-[#3D4350]`}>
                  <span className={`${colLabel} text-[#5F6672]`}>{other.name}</span>
                  {other.cells[r.key]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // All nine: a compact grid of short answers, with the feature column pinned.
  // It fits from about 1130px wide and scrolls sideways below that.
  return (
    <>
      <p className="mb-3 text-sm text-[#5F6672] min-[1130px]:hidden" aria-hidden="true">
        Scroll sideways to see all nine products.
      </p>
      <div
        role="region"
        aria-label={`${caption}. Scroll sideways to see every column.`}
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-[#E6E2DA] bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339]"
      >
        <table data-testid="comparison-table" className="w-full min-w-[1060px] table-fixed border-collapse text-left text-[13.5px] leading-snug">
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-[120px] md:w-[140px]" />
            {columns.map((c) => <col key={c.id} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-[#E6E2DA] bg-[#FBFAF7]">
              <th scope="col" className="sticky left-0 z-10 bg-[#FBFAF7] px-3 py-4 shadow-[1px_0_0_#E6E2DA] md:px-4">
                <span className="sr-only">Feature</span>
              </th>
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`px-3 py-4 align-bottom text-[13px] font-semibold leading-tight ${i === 0 ? "bg-[#F8EDEC] text-[#B32A30]" : "text-[#15171C]"}`}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className="border-b border-[#E6E2DA] last:border-0">
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-4 align-top font-semibold text-[#15171C] shadow-[1px_0_0_#E6E2DA] md:px-4">
                  {r.label}
                </th>
                {columns.map((c, i) => (
                  <td key={c.id} className={`px-3 py-4 align-top ${i === 0 ? "bg-[#FBF4F3] text-[#15171C]" : "text-[#3D4350]"}`}>
                    {c.brief[r.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SwitchFreshBooksPage() {
  const [selected, setSelected] = useState("all");

  return (
    <MarketingShell>
      <SEO path="/compare" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Compare</Eyebrow>
            <Display className="mt-5">How CherryWorks{"\u00a0"}Pro compares</Display>
            <Lede className="mt-6 text-pretty">
              CherryWorks Pro keeps time, invoicing, the general ledger, contractor payouts and client support in one place, priced
              per firm. Here’s how it lines up against eight tools firms often use, by their published list prices and features.
            </Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">Start free trial</ButtonLink>
              <ButtonLink href="/tour" size="lg" variant="secondary" testId="cta-take-tour">Take the tour</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
        </Container>
      </PageHero>

      <Section tone="white" testId="section-comparison">
        <Container>
          <div className="max-w-3xl">
            <Heading>Side by side</Heading>
            <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
              Pick a product to see it next to CherryWorks Pro in more detail, or view all eight at once.
            </p>
          </div>

          <div role="group" aria-label="Choose a product to compare" className="mt-10 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const on = selected === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`compare-filter-${f.id}`}
                  onClick={() => setSelected(f.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium md:px-4 md:py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] ${
                    on
                      ? "border-[#15171C] bg-[#15171C] text-white"
                      : "border-[#D9D4CB] bg-white text-[#3D4350] hover:border-[#15171C] hover:text-[#15171C]"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="mt-8">
            <CompareTable selected={selected} />
          </div>

          <div className="mt-6 max-w-3xl space-y-3 text-pretty text-sm leading-relaxed text-[#5F6672]">
            <p>
              Monthly list prices in US dollars, as of October 2026. Several vendors charge less for annual billing. A dash means we
              found no built-in feature in the vendor’s published plans; many of these products connect to other tools that fill
              the gap. Check each vendor’s site for current terms.
            </p>
            <p>
              Vendor pricing:{" "}
              {SOURCES.map((s, i) => (
                <span key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="underline decoration-[#D9D4CB] underline-offset-4 hover:text-[#15171C] hover:decoration-[#15171C]">
                    {s.label}
                  </a>
                  {i < SOURCES.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          </div>
        </Container>
      </Section>

      <Section tone="paper" testId="section-switch-guides">
        <Container>
          <div className="max-w-3xl">
            <Heading>Switching guides</Heading>
            <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
              Each guide covers what that product does well, where firms run into limits, and how its exports come across in the
              import wizard. Nothing is written to your books until you’ve reviewed a dry run.
            </p>
          </div>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDES.map((g) => (
              <li key={g.id}>
                <Link
                  href={g.href}
                  className="group block h-full rounded-xl border border-[#E6E2DA] bg-white p-6 transition-colors hover:border-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339]"
                >
                  <span data-testid={`switch-link-${g.id}`} className="flex h-full flex-col">
                    <span className="block text-[13px] font-semibold uppercase tracking-[0.12em] text-[#5F6672]">Switching from</span>
                    <span className="mt-2 block font-display text-xl font-semibold text-[#15171C]">{g.name}</span>
                    <span className="mt-3 block flex-1 text-[15px] leading-relaxed text-[#3D4350]">{g.summary}</span>
                    <span className="mt-5 block text-sm font-semibold text-[#B32A30] group-hover:text-[#15171C]">
                      Read the guide <span aria-hidden="true">→</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <MarketingHubBand tone="white" />

      <ClosingCta
        heading="Try it with your own data"
        body="Fourteen days on Professional, import wizard included. Bring your history across and see what your team is owed."
      />
    </MarketingShell>
  );
}
