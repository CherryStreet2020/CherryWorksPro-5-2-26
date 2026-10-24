import type { ReactNode } from "react";
import { SEO } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink, TextLink, Screenshot,
} from "@/components/marketing/kit";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";

/**
 * One template for every "Switching from X" page. Each page file passes a data
 * object; the template supplies the CherryWorks Pro side of the comparison so
 * our own claims are written once and stay identical across pages.
 *
 * Competitor facts are list prices and published features as of October 2026,
 * each backed by a source the page links to.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STARTER = money(PLAN_PRICING.STARTER.monthly);
const PRO = money(PLAN_PRICING.PROFESSIONAL.monthly);
const BUSINESS = money(PLAN_PRICING.BUSINESS.monthly);

export type PainPoint = { title: string; body: ReactNode };
export type Source = { label: string; href: string };

/** The competitor's side of the table. Optional rows are left out when absent. */
export type TheirSide = {
  pricing: ReactNode;
  /** List-price arithmetic for ten people, only where the vendor prices per user. */
  tenPeople?: ReactNode;
  time: ReactNode;
  invoicing: ReactNode;
  payments: ReactNode;
  payouts: ReactNode;
  support: ReactNode;
  ledger: ReactNode;
};

export type SwitchPageData = {
  /** Display name, e.g. "Harvest". */
  name: string;
  /** SEO route, e.g. "/switch-from-harvest". */
  seoPath: string;
  h1: ReactNode;
  lede: ReactNode;
  screen: ScreenSpec;
  painHeading: string;
  painIntro: ReactNode;
  painPoints: PainPoint[];
  them: TheirSide;
  /** What the competitor does well, stated plainly. */
  strengths: ReactNode[];
  /** Where to click in the competitor to get the CSV files. */
  exportHow: ReactNode;
  /** What the import wizard reads from this platform's exports. */
  brings: string;
  sources: Source[];
};

const CWP: Record<keyof TheirSide, ReactNode> = {
  pricing: <>Per firm: {STARTER}, {PRO} or {BUSINESS} a month. Unlimited users on every plan; Starter is limited to 5 clients and 3 projects.</>,
  tenPeople: <>{PRO} a month on Professional</>,
  time: <>Timers and weekly timesheets; approvals on Professional and up</>,
  invoicing: <>Invoices built from billable hours, sent from your own Microsoft 365, Google or SMTP mailbox</>,
  payments: <>Clients pay by card or ACH; payments post to the ledger</>,
  payouts: <>Each person’s hours × their cost rate; pay contractors through Stripe Connect or record a payment (Professional and up). W-2 staff stay on your payroll.</>,
  support: <>Support cases and a client Help Center on Professional and up; hours logged on a case can be billed</>,
  ledger: <>Double-entry general ledger on every plan; bank feeds on Professional and up; period closes on Business</>,
};

const ROW_LABELS: Record<keyof TheirSide, string> = {
  pricing: "Pricing",
  tenPeople: "Ten people, list price",
  time: "Time tracking",
  invoicing: "Invoicing from time",
  payments: "Online payments",
  payouts: "Paying contractors",
  support: "Client support",
  ledger: "General ledger",
};

const ROW_ORDER: (keyof TheirSide)[] = ["pricing", "tenPeople", "time", "invoicing", "payments", "payouts", "support", "ledger"];

function ComparisonTable({ name, them }: { name: string; them: TheirSide }) {
  const rows = ROW_ORDER.filter((k) => them[k] !== undefined);
  const cell = "align-top px-6 py-5 max-md:block max-md:p-0";
  const colLabel = "mb-1 block text-[12px] font-semibold uppercase tracking-[0.1em] md:hidden";
  return (
    <div className="mt-12 overflow-hidden rounded-xl border border-[#E6E2DA] bg-white">
      <table className="w-full border-collapse text-left text-[15px] leading-relaxed max-md:block" data-testid="switch-comparison-table">
        <caption className="sr-only">CherryWorks Pro and {name} compared</caption>
        <thead className="max-md:hidden">
          <tr className="border-b border-[#E6E2DA] bg-[#FBFAF7]">
            <th scope="col" className="w-[20%] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#5F6672]">
              <span className="sr-only">What</span>
            </th>
            <th scope="col" className="w-[40%] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#B32A30]">CherryWorks Pro</th>
            <th scope="col" className="w-[40%] px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#5F6672]">{name}</th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.map((k) => (
            <tr key={k} className="border-b border-[#E6E2DA] last:border-0 max-md:block max-md:space-y-4 max-md:px-5 max-md:py-6">
              <th scope="row" className={`${cell} font-semibold text-[#15171C]`}>{ROW_LABELS[k]}</th>
              <td className={`${cell} text-[#3D4350]`}>
                <span className={`${colLabel} text-[#B32A30]`}>CherryWorks Pro</span>
                {CWP[k]}
              </td>
              <td className={`${cell} text-[#3D4350]`}>
                <span className={`${colLabel} text-[#5F6672]`}>{name}</span>
                {them[k]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SwitchPage({ data }: { data: SwitchPageData }) {
  const { name } = data;
  return (
    <MarketingShell>
      <SEO path={data.seoPath} />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Switching from {name}</Eyebrow>
            <Display testId="switch-h1" className="mt-5">{data.h1}</Display>
            <Lede className="mt-6 max-w-2xl text-pretty">{data.lede}</Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">Start free trial</ButtonLink>
              <ButtonLink href="/tour" size="lg" variant="secondary" testId="cta-take-tour">Take the tour</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
          <Screenshot
            className="mt-14 md:mt-16"
            src={data.screen.src}
            width={data.screen.width}
            height={data.screen.height}
            alt={data.screen.alt}
            url={data.screen.url}
            priority
            fade
          />
        </Container>
      </PageHero>

      <Section tone="white" testId="section-pain-points">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
            <div>
              <Heading>{data.painHeading}</Heading>
              <p className="mt-5 text-pretty text-lg leading-relaxed text-[#3D4350]">{data.painIntro}</p>
            </div>
            <div className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {data.painPoints.map((p, i) => (
                <div key={p.title} data-testid={`pain-point-${i}`} className="border-t border-[#E6E2DA] pt-5">
                  <h3 className="font-display text-xl font-semibold leading-snug text-[#15171C]">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="paper" testId="section-comparison">
        <Container>
          <div className="max-w-3xl">
            <Heading>{name} and CherryWorks{"\u00a0"}Pro, side by side</Heading>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-[#3D4350]">
              {name}’s details are its published list prices and features as of October 2026. Check the vendor’s site for current terms.
            </p>
          </div>
          <ComparisonTable name={name} them={data.them} />

          <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-16">
            <div>
              <h3 className="font-display text-2xl font-semibold text-[#15171C]">What {name} does well</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-[#3D4350]">
                {data.strengths.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-[0.7em] h-1 w-3 flex-none bg-[#D9D4CB]" aria-hidden="true" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-display text-2xl font-semibold text-[#15171C]">Also in CherryWorks Pro</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-[#3D4350]">
                <li className="flex gap-3"><span className="mt-[0.7em] h-1 w-3 flex-none bg-[#CF3339]" aria-hidden="true" /><span>{REPORT_COUNT} built-in reports, including project profitability, utilization, AR aging and a 1099 export</span></li>
                <li className="flex gap-3"><span className="mt-[0.7em] h-1 w-3 flex-none bg-[#CF3339]" aria-hidden="true" /><span>Estimates your clients can accept online, and recurring invoices</span></li>
                <li className="flex gap-3"><span className="mt-[0.7em] h-1 w-3 flex-none bg-[#CF3339]" aria-hidden="true" /><span>Every hour moves from unbilled to invoiced to pending payout to paid, and team members can see their own</span></li>
                <li className="flex gap-3"><span className="mt-[0.7em] h-1 w-3 flex-none bg-[#CF3339]" aria-hidden="true" /><span>Expense reports with approval, and bank reconciliation on Professional and up</span></li>
              </ul>
            </div>
          </div>

          <div className="mt-14 border-t border-[#E6E2DA] pt-6">
            <p className="text-sm text-[#5F6672]">Sources for {name}, checked October 2026:</p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {data.sources.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#3D4350] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <TextLink href="/compare" testId="link-all-comparisons">See all comparisons</TextLink>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-migration">
        <Container>
          <div className="max-w-3xl">
            <Heading testId="migration-timeline-heading">Moving from {name}</Heading>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-[#3D4350]">
              The import wizard reads the CSV files {name} exports. Nothing is written to your books until you’ve reviewed a dry run.
            </p>
          </div>
          <ol className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-3">
            <li data-testid="timeline-step-1" className="border-t border-[#E6E2DA] pt-5">
              <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">01</p>
              <h3 className="mt-3 font-display text-xl font-semibold text-[#15171C]">Export from {name}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{data.exportHow}</p>
            </li>
            <li data-testid="timeline-step-2" className="border-t border-[#E6E2DA] pt-5">
              <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">02</p>
              <h3 className="mt-3 font-display text-xl font-semibold text-[#15171C]">Upload and check</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                Upload up to ten files at once. CherryWorks Pro works out what each file holds from its header row and checks every
                file for problems before you go further.
              </p>
            </li>
            <li data-testid="timeline-step-3" className="border-t border-[#E6E2DA] pt-5">
              <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">03</p>
              <h3 className="mt-3 font-display text-xl font-semibold text-[#15171C]">Review, then import</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                Choose what to bring across and the date ranges, review the dry run, then run the import. An admin can roll back a
                completed import, which removes the records it created.
              </p>
            </li>
          </ol>
          <div className="mt-12 grid gap-6 border-t border-[#E6E2DA] pt-6 text-[15px] leading-relaxed text-[#3D4350] md:grid-cols-2 md:gap-16">
            <p>
              <span className="font-semibold text-[#15171C]">What comes across from {name}:</span> {data.brings}
            </p>
            <p>
              The import wizard is on Professional and Business. The 14-day trial runs on Professional, so you can import your own
              data and send a real invoice before you’re charged.
            </p>
          </div>
        </Container>
      </Section>

      <MarketingHubBand />

      <ClosingCta
        heading={<>Try it with your {name} data</>}
        body="Fourteen days on Professional, import wizard included. Bring your history across and see what your team is owed."
      />
    </MarketingShell>
  );
}

/** A modest note about Marketing Hub, shared by the switch pages and /compare. */
export function MarketingHubBand({ tone = "paper" }: { tone?: "paper" | "white" }) {
  const card = tone === "paper" ? "bg-white" : "bg-[#FBFAF7]";
  return (
    <Section tone={tone} testId="section-compare-marketing-os">
      <Container>
        <div className={`grid items-end gap-8 rounded-xl border border-[#E6E2DA] ${card} p-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12 md:p-12`}>
          <div className="max-w-2xl">
            <p data-testid="badge-compare-marketing-os" className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#B32A30]">
              Marketing Hub · Business plan
            </p>
            <h2 className="mt-4 font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-3xl">
              Find the next client in the same system
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#3D4350]">
              Marketing Hub adds prospects, companies, segments, email campaigns and sequences. Prospects stay apart from your
              clients, so outreach never touches your invoices or reports.
            </p>
          </div>
          <TextLink href="/marketing" testId="link-compare-marketing-os">See Marketing Hub</TextLink>
        </div>
      </Container>
    </Section>
  );
}

/** The closing night band. The hero carries `cta-start-trial`; these buttons get their own test ids. */
export function ClosingCta({ heading, body }: { heading: ReactNode; body: ReactNode }) {
  return (
    <Section tone="night" testId="section-cta">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance text-white md:text-5xl">{heading}</h2>
          <p className="mt-5 text-lg leading-relaxed text-white/70">{body}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial-closing">Start free trial</ButtonLink>
            <ButtonLink href="/tour" size="lg" variant="onNight" testId="cta-take-tour-closing">Take the tour</ButtonLink>
          </div>
          <p className="mt-6 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime</p>
        </div>
      </Container>
    </Section>
  );
}

export type ScreenSpec = { src: string; width: number; height: number; alt: string; url: string };

/** Real product screenshots (fictional firm), with alt text that describes only what each shows. */
export const SCREENS: Record<"time" | "invoices" | "payouts" | "supportCases", ScreenSpec> = {
  time: {
    src: "/marketing/screens/time.webp", width: 1600, height: 1041, url: "cherryworkspro.com/time",
    alt: "A weekly timesheet with hours logged per client and project, day by day.",
  },
  invoices: {
    src: "/marketing/screens/invoices.webp", width: 1600, height: 1136, url: "cherryworkspro.com/invoices",
    alt: "The Invoices page: totals invoiced, outstanding and paid this month, and a list of sent and paid invoices.",
  },
  payouts: {
    src: "/marketing/screens/payouts.webp", width: 1600, height: 852, url: "cherryworkspro.com/payouts",
    alt: "The Payouts page: unpaid time value and the balance owed to each team member, with a Pay button per person.",
  },
  supportCases: {
    src: "/marketing/screens/support-cases.webp", width: 1600, height: 1217, url: "cherryworkspro.com/support/cases",
    alt: "The Support Cases list: open cases for several clients with status, priority, assignee and SLA due times.",
  },
};
