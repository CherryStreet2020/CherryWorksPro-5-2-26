import type { ReactNode } from "react";
import { SEO } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink, Ctas, Note, TextLink, Scene,
  Closing, TRIAL_NOTE,
} from "@/components/marketing/kit";
import { SCREENS, type ScreenSpec } from "@/components/marketing/screens";
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


export { SCREENS, type ScreenSpec };

function ComparisonTable({ name, them }: { name: string; them: TheirSide }) {
  const rows = ROW_ORDER.filter((k) => them[k] !== undefined);
  const cell = "align-top py-5 pr-8 max-md:block max-md:p-0";
  const colLabel = "mb-1 block text-[14px] font-medium md:hidden";
  return (
    <table className="mt-10 w-full border-collapse text-left text-[16px] leading-[1.55] max-md:block md:mt-14" data-testid="switch-comparison-table">
      <caption className="sr-only">CherryWorks Pro and {name} compared</caption>
      <thead className="max-md:hidden">
        <tr className="border-b border-[#15171C]">
          <th scope="col" className="w-[22%] pb-4 pr-8 text-[15px] font-medium">
            <span className="sr-only">What</span>
          </th>
          <th scope="col" className="w-[39%] pb-4 pr-8 text-[15px] font-medium text-[#15171C]">CherryWorks Pro</th>
          <th scope="col" className="w-[39%] pb-4 text-[15px] font-medium text-[#5C606A]">{name}</th>
        </tr>
      </thead>
      <tbody className="max-md:block max-md:border-t max-md:border-[#15171C]">
        {rows.map((k) => (
          <tr key={k} className="border-b border-[#E6E3DD] max-md:block max-md:space-y-4 max-md:py-6">
            <th scope="row" className={`${cell} font-medium text-[#15171C]`}>{ROW_LABELS[k]}</th>
            <td className={`${cell} text-[#15171C]`}>
              <span className={`${colLabel} text-[#CF3339]`}>CherryWorks Pro</span>
              {CWP[k]}
            </td>
            <td className={`${cell} text-[#5C606A] md:pr-0`}>
              <span className={`${colLabel} text-[#6E727B]`}>{name}</span>
              {them[k]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A list of short statements, each under a hairline. */
function Lines({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-5 text-[16px] leading-[1.55] text-[#5C606A]">
      {items.map((item, i) => (
        <li key={i} className="border-t border-[#E6E3DD] py-3.5">{item}</li>
      ))}
    </ul>
  );
}

const ALSO_IN = [
  <>Marketing Hub on Business: contacts, companies, campaigns and sequences, beside your clients</>,
  <>{REPORT_COUNT} built-in reports, including project profitability, utilization, AR aging and a 1099 export</>,
  <>Estimates your clients accept online, recurring invoices, dunning and payment plans</>,
  <>Every hour moves from unbilled to invoiced to pending payout to paid, and team members can see their own</>,
  <>Expense reports with approval, and bank reconciliation on Professional and up</>,
];

const STEPS = (name: string, exportHow: ReactNode) => [
  { title: <>Export from {name}</>, body: exportHow },
  {
    title: "Upload and check",
    body: "Upload up to ten files at once. CherryWorks Pro works out what each file holds from its header row and checks every file for problems before you go further.",
  },
  {
    title: "Review, then import",
    body: "Choose what to bring across and the date ranges, review the dry run, then run the import. An admin can roll back a completed import, which removes the records it created.",
  },
];

export function SwitchPage({ data }: { data: SwitchPageData }) {
  const { name } = data;
  return (
    <MarketingShell>
      <SEO path={data.seoPath} />

      <PageHero>
        <Container>
          <Eyebrow>Switching from {name}</Eyebrow>
          <Display testId="switch-h1" className="mt-4">{data.h1}</Display>
          <Lede size="hero" className="mt-5 md:mt-6">{data.lede}</Lede>
          <Ctas>
            <ButtonLink href="/signup" testId="cta-start-trial">Start your trial</ButtonLink>
            <ButtonLink href="/tour" variant="secondary" testId="cta-take-tour">Take the tour</ButtonLink>
          </Ctas>
          <Note>{TRIAL_NOTE}</Note>
          <Scene screen={data.screen} priority className="mt-12 md:mt-14" />
        </Container>
      </PageHero>

      <Section testId="section-pain-points">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Heading>{data.painHeading}</Heading>
              <Lede className="mt-5">{data.painIntro}</Lede>
            </div>
            <div className="grid gap-x-10 sm:grid-cols-2">
              {data.painPoints.map((p, i) => (
                <div key={p.title} data-testid={`pain-point-${i}`} className="border-t border-[#E6E3DD] pb-8 pt-5">
                  <h3 className="text-[20px] font-medium leading-snug tracking-[-0.01em] text-[#15171C]">{p.title}</h3>
                  <p className="mt-2 text-[16px] leading-[1.55] text-[#5C606A]">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section testId="section-comparison">
        <Container>
          <Heading>{name} and CherryWorks{" "}Pro, side by side</Heading>
          <Lede className="mt-5">
            {name}’s details are its published list prices and features as of October 2026. Check the vendor’s site for current terms.
          </Lede>
          <ComparisonTable name={name} them={data.them} />

          <div className="mt-16 grid gap-12 md:mt-20 md:grid-cols-2 md:gap-[72px]">
            <div>
              <h3 className="text-[24px] font-medium tracking-[-0.02em] text-[#15171C]">What {name} does well</h3>
              <Lines items={data.strengths} />
            </div>
            <div>
              <h3 className="text-[24px] font-medium tracking-[-0.02em] text-[#15171C]">Also in CherryWorks Pro</h3>
              <Lines items={ALSO_IN} />
            </div>
          </div>

          <div className="mt-14 text-[14px] text-[#6E727B]">
            <p>Sources for {name}, checked October 2026:</p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {data.sources.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-b border-[#CFCBC3] text-[#5C606A] transition-colors hover:border-[#15171C] hover:text-[#15171C]"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[15px]">
              <TextLink href="/compare" testId="link-all-comparisons">See all comparisons</TextLink>
            </p>
          </div>
        </Container>
      </Section>

      <Section testId="section-migration">
        <Container>
          <Heading testId="migration-timeline-heading">Moving from {name}</Heading>
          <Lede className="mt-5">
            The import wizard reads the CSV files {name} exports. Nothing is written to your books until you’ve reviewed a dry run.
          </Lede>
          <ol className="mt-10 grid gap-x-10 md:mt-14 md:grid-cols-3">
            {STEPS(name, data.exportHow).map((step, i) => (
              <li key={i} data-testid={`timeline-step-${i + 1}`} className="border-t border-[#15171C] pb-8 pt-5">
                <h3 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">{step.title}</h3>
                <p className="mt-2 text-[16px] leading-[1.55] text-[#5C606A]">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 grid gap-6 border-t border-[#E6E3DD] pt-6 text-[16px] leading-[1.55] text-[#5C606A] md:grid-cols-2 md:gap-[72px]">
            <p>
              <span className="font-medium text-[#15171C]">What comes across from {name}:</span> {data.brings}
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
        heading={<>Try it with your {name} data.</>}
        body="Fourteen days on Professional, import wizard included. Bring your history across and see what your team is owed."
      />
    </MarketingShell>
  );
}

/** A short note about Marketing Hub, shared by the switch pages and /compare. */
export function MarketingHubBand() {
  return (
    <Section testId="section-compare-marketing-os">
      <Container>
        <div className="grid items-end gap-6 border-t border-[#E6E3DD] pt-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
          <div className="max-w-[640px]">
            <p data-testid="badge-compare-marketing-os" className="text-[15px] font-medium text-[#CF3339]">
              Marketing Hub · Business plan
            </p>
            <h2 className="mt-3 text-[27px] font-medium leading-[1.12] tracking-[-0.025em] text-[#15171C] md:text-[34px]">
              Find the next client in the same system.
            </h2>
            <p className="mt-4 text-[17px] leading-[1.55] text-[#5C606A]">
              Marketing Hub adds contacts, companies, segments, email campaigns, sequences that stop on a reply, and an AI chat for
              your own website. Prospects stay apart from your clients, so outreach never touches your invoices or reports.
            </p>
          </div>
          <p className="text-[15px]">
            <TextLink href="/marketing" testId="link-compare-marketing-os">See Marketing Hub</TextLink>
          </p>
        </div>
      </Container>
    </Section>
  );
}

/** The closing call to action. The hero carries `cta-start-trial`; these buttons get their own test ids. */
export function ClosingCta({ heading, body }: { heading: ReactNode; body: ReactNode }) {
  return (
    <Closing
      heading={heading}
      body={body}
      primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial-closing" }}
      secondary={{ href: "/tour", label: "Take the tour", testId: "cta-take-tour-closing" }}
    />
  );
}
