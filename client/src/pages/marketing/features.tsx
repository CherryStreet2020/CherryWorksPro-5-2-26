import type { ReactNode } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";
import {
  ButtonLink, Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Screenshot, Section, TextLink,
} from "@/components/marketing/kit";

const SCREENS = "/marketing/screens";

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

type Capability = { t: string; d: string; plan?: string };

type Job = {
  id: string;
  n: string;
  title: string;
  body: string;
  plan?: string;
  caps: Capability[];
  img: { src: string; width: number; height: number; alt: string; url: string };
  link?: { href: string; label: string; testId: string };
};

/** The four jobs that have a real screenshot. Books, moving in and Marketing Hub are laid out below. */
const JOBS: Job[] = [
  {
    id: "time",
    n: "01",
    title: "Time tracking and approvals",
    body: "Your team logs hours on a weekly timesheet or with a timer, against a client’s project or a support case. That one record of time feeds the invoice, the payout and the reports, so nobody re-keys hours into another system.",
    caps: [
      { t: "Timesheet or timer", d: "Fill in the week on the timesheet, or switch to a day or month view. Start a timer on a project and it keeps running in the corner while you work." },
      { t: "Billable or not", d: "Mark each entry billable or non-billable. Non-billable work is still tracked and reported, but it never goes on an invoice." },
      { t: "Weekly approvals", plan: "Professional and up", d: "People submit their week. An admin approves or rejects it with a reason, one at a time or in bulk, and people can recall a week they submitted by mistake." },
      { t: "Time on support cases", d: "Hours logged on a case are ordinary time entries, so case work shows on the timesheet and is billed like any other work." },
    ],
    img: { src: `${SCREENS}/time.webp`, width: 1600, height: 1041, alt: "A weekly timesheet with hours logged per client and project, day by day.", url: "cherryworkspro.com/time" },
  },
  {
    id: "invoicing",
    n: "02",
    title: "Invoicing and getting paid",
    body: "Pick a client and CherryWorks Pro builds the invoice from their unbilled hours. If you use approvals, only approved time goes in unless you choose to include the rest. Send it from your own mailbox and let the client pay online.",
    caps: [
      { t: "Built from your hours", d: "Limit the invoice to a date range or to certain people, and group the lines by person, project, service or support case." },
      { t: "Sent from your own mailbox", d: "Invoices go out from your firm’s Microsoft 365, Google or SMTP account with the PDF attached, to one contact or several, with others on CC." },
      { t: "Card and ACH", d: "Clients pay online by card or ACH, and each payment posts to your ledger on its own, with nobody re-entering it." },
      { t: "Estimates and recurring invoices", d: "Send an estimate and turn it into an invoice once the client accepts it. Recurring templates handle retainers and other repeat billing." },
    ],
    img: { src: `${SCREENS}/invoices.webp`, width: 1600, height: 1136, alt: "The Invoices page: totals invoiced, outstanding and paid this month, and a list of sent and paid invoices.", url: "cherryworkspro.com/invoices" },
  },
  {
    id: "payouts",
    n: "03",
    title: "Paying your team",
    body: "A person’s payout is the hours they logged times their cost rate. You see what you owe each person before you pay it, and they can see where their own hours stand. CherryWorks Pro tracks what’s owed; it doesn’t run payroll.",
    caps: [
      { t: "Every hour has a status", d: "Unbilled, invoiced, pending payout, paid. Team members can see their own hours and which of them have been paid." },
      { t: "Contractors", d: "Pay through Stripe Connect (Professional and up), or record a payment you made another way, such as Zelle, ACH or a check." },
      { t: "W-2 staff", d: "Pay employees through your payroll provider, as you do today. CherryWorks Pro doesn’t withhold taxes or file payroll." },
      { t: "Statements and 1099s", d: "Download a payout statement for anyone as a PDF or a spreadsheet, and run the 1099 export at year end." },
    ],
    img: { src: `${SCREENS}/payouts.webp`, width: 1600, height: 852, alt: "The Payouts page: unpaid time value and the balance owed to each team member, with a Pay button per person.", url: "cherryworkspro.com/payouts" },
  },
  {
    id: "support",
    n: "04",
    title: "Client support cases and a Help Center",
    body: "Connect the Microsoft 365 mailbox your clients already write to. Each email opens or updates a case with a key, a priority, an owner and an SLA clock, and your clients get a Help Center where they can follow their cases.",
    plan: "Professional and up",
    caps: [
      { t: "Email to case", d: "Every message to your support address opens a new case or updates the one it belongs to. Inbound email works with Microsoft 365 mailboxes." },
      { t: "SLA targets per client", d: "Set first-response and resolution targets for each client, counted in business hours if you choose." },
      { t: "Sign-in without passwords", d: "Approve a client’s email domain and anyone there signs in to the Help Center with a one-time link. Customer Admins see every case their company has open." },
      { t: "Support you can bill", d: "Log time on a case and it goes on the timesheet and the invoice. Each case shows its hours logged, billable, unbilled and invoiced." },
    ],
    img: { src: `${SCREENS}/support-cases.webp`, width: 1600, height: 1217, alt: "The Support Cases list: open cases for several clients with status, priority, assignee and SLA due times.", url: "cherryworkspro.com/support/cases" },
    link: { href: "/client-support", label: "More on client support", testId: "link-features-client-support" },
  },
];

const INDEX = [
  { id: "time", n: "01", label: "Time tracking and approvals" },
  { id: "invoicing", n: "02", label: "Invoicing and getting paid" },
  { id: "payouts", n: "03", label: "Paying your team" },
  { id: "support", n: "04", label: "Client support and Help Center" },
  { id: "books", n: "05", label: "Books and reports" },
  { id: "moving-in", n: "06", label: "Moving in" },
  { id: "marketing-hub", n: "07", label: "Marketing Hub" },
];

const SWITCH_FROM = [
  { name: "FreshBooks", href: "/compare" },
  { name: "QuickBooks", href: "/switch-from-quickbooks" },
  { name: "Harvest", href: "/switch-from-harvest" },
  { name: "Xero", href: "/switch-from-xero" },
  { name: "Wave", href: "/switch-from-wave" },
  { name: "BigTime", href: "/switch-from-bigtime" },
  { name: "Scoro", href: "/switch-from-scoro" },
  { name: "Paymo", href: "/switch-from-paymo" },
];

const PILL = "inline-flex h-10 items-center rounded-full border border-[#D9D4CB] bg-white px-4 text-sm font-medium text-[#15171C] hover:border-[#15171C]";

function StepNumber({ n }: { n: string }) {
  return <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">{n}</p>;
}

function PlanTag({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="mt-5 inline-flex items-center rounded-full border border-[#D9D4CB] bg-white px-3 py-1 text-[13px] font-medium text-[#3D4350]"
    >
      {children}
    </p>
  );
}

function CapTitle({ cap }: { cap: Capability }) {
  return (
    <dt className="font-semibold text-[#15171C]">
      {cap.t}
      {cap.plan && <span className="mt-0.5 block text-[13px] font-medium text-[#5F6672]">{cap.plan}</span>}
    </dt>
  );
}

/** Label on the left, detail on the right, a hairline between rows. */
function Rows({ rows }: { rows: Capability[] }) {
  return (
    <dl className="border-b border-[#E6E2DA]">
      {rows.map((r) => (
        <div key={r.t} className="grid gap-2 border-t border-[#E6E2DA] py-5 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-8">
          <CapTitle cap={r} />
          <dd className="text-pretty text-[15px] leading-relaxed text-[#3D4350]">{r.d}</dd>
        </div>
      ))}
    </dl>
  );
}

function JobSection({ job, tone, flip }: { job: Job; tone: "paper" | "white"; flip: boolean }) {
  return (
    <Section tone={tone} id={job.id} testId={`feature-section-${job.id}`} className="scroll-mt-16">
      <Container>
        <div className="grid items-center gap-10 md:grid-cols-12 md:gap-12">
          <div className={`md:col-span-5 ${flip ? "md:order-2" : ""}`}>
            <StepNumber n={job.n} />
            <Heading className="mt-3">{job.title}</Heading>
            <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">{job.body}</p>
            {job.plan && <PlanTag>{job.plan}</PlanTag>}
            {job.link && (
              <div className="mt-6">
                <TextLink href={job.link.href} testId={job.link.testId}>{job.link.label}</TextLink>
              </div>
            )}
          </div>
          <div className={`md:col-span-7 ${flip ? "md:order-1" : ""}`}>
            <Screenshot {...job.img} />
          </div>
        </div>
        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
          {job.caps.map((c) => (
            <div key={c.t} className="border-t border-[#E6E2DA] pt-5">
              <CapTitle cap={c} />
              <dd className="mt-2 text-pretty text-[15px] leading-relaxed text-[#3D4350]">{c.d}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </Section>
  );
}

const PLANS = [
  { name: "Starter", price: PLAN_PRICING.STARTER.monthly, d: "Up to 5 clients and 3 projects. Time tracking, invoicing, payouts, the general ledger and the built-in reports." },
  { name: "Professional", price: PLAN_PRICING.PROFESSIONAL.monthly, d: "Unlimited clients and projects. Adds timesheet approvals, support cases and the Help Center, bank feeds, Stripe Connect payouts and the import wizard. The trial runs on this plan." },
  { name: "Business", price: PLAN_PRICING.BUSINESS.monthly, d: "Everything in Professional, plus period closes and the Marketing Hub." },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <SEO path="/features" />

      <PageHero>
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <Eyebrow>Product</Eyebrow>
              <Display testId="features-heading" className="mt-5">What CherryWorks Pro does, job by job</Display>
              <Lede className="mt-6 max-w-2xl text-pretty">
                It was built to run a consulting firm, and it still does every month: billing clients, working support cases and paying contractors. Below is each job it handles, what it actually does and which plan it’s on.
              </Lede>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <ButtonLink href="/signup" size="lg" arrow testId="features-cta-signup">Start your 14-day trial</ButtonLink>
                <ButtonLink href="/tour" size="lg" variant="secondary" testId="see-it-in-action">Take the product tour</ButtonLink>
              </div>
              <p className="mt-5 text-sm text-[#5F6672]">
                Unlimited users on every plan · From {money(PLAN_PRICING.STARTER.monthly)}/mo
              </p>
            </div>
            <nav aria-label="On this page" data-testid="category-nav" className="lg:col-span-5 lg:pt-3">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#5F6672]">On this page</p>
              <ol className="mt-4 border-b border-[#E6E2DA]">
                {INDEX.map((item) => (
                  <li key={item.id} className="border-t border-[#E6E2DA]">
                    <a
                      href={`#${item.id}`}
                      className="flex items-baseline gap-4 py-3 text-[15px] font-medium text-[#15171C] hover:text-[#B32A30]"
                    >
                      <span className="w-6 shrink-0 font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">{item.n}</span>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </Container>
      </PageHero>

      {JOBS.map((job, i) => (
        <JobSection key={job.id} job={job} tone={i % 2 === 0 ? "white" : "paper"} flip={i % 2 === 1} />
      ))}

      <Section tone="white" id="books" testId="feature-section-books" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-5">
              <StepNumber n="05" />
              <Heading className="mt-3">Books and reports</Heading>
              <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
                Every plan includes a double-entry general ledger. Sent invoices, payments, refunds, payouts and approved expenses post their own journal entries, so the books keep pace with the work instead of waiting for month end.
              </p>
            </div>
            <div className="md:col-span-7 md:pt-1">
              <Rows
                rows={[
                  { t: "General ledger", d: "A chart of accounts, manual journal entries, a ledger for each account and a trial balance." },
                  { t: `${REPORT_COUNT} built-in reports`, d: "AR aging, unbilled time, WIP aging, project profitability, utilization, cash flow, payout detail and a 1099 export, among others." },
                  { t: "Expenses", d: "Attach receipts to expenses. Approved expenses post to the ledger, and reimbursements post when you pay them." },
                  { t: "Bank feeds", plan: "Professional and up", d: "Connect bank accounts through Stripe Financial Connections and match transactions to payments, payouts and expenses." },
                  { t: "Period closes", plan: "Business", d: "Close a month so nothing new posts into it, and reopen it if you need to make a correction." },
                ]}
              />
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="paper" id="moving-in" testId="feature-section-moving-in" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-5">
              <StepNumber n="06" />
              <Heading className="mt-3">Moving in</Heading>
              <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
                Bring your clients, projects, time, invoices and payments over from the system you use now. The import wizard shows you what it will create before anything is written.
              </p>
              <PlanTag>Import wizard: Professional and up</PlanTag>
              <div className="mt-6">
                <TextLink href="/compare" testId="link-features-compare">See how it compares</TextLink>
              </div>
            </div>
            <div className="md:col-span-7 md:pt-1">
              <p className="text-sm font-semibold text-[#15171C]">Switching from</p>
              <ul className="mt-4 flex flex-wrap gap-2.5">
                {SWITCH_FROM.map((p) => (
                  <li key={p.name}>
                    <Link href={p.href} className={PILL}>
                      <span data-testid={`switch-card-${p.name.toLowerCase()}`}>{p.name}</span>
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/switch-from-jira-service-management" className={PILL}>
                    <span data-testid="switch-card-jira">Jira Service Management</span>
                  </Link>
                </li>
              </ul>
              <div className="mt-10">
                <Rows
                  rows={[
                    { t: "Preview first", d: "Each import runs as a dry run, so you can check what it will create, and which rows it will skip and why, before you commit." },
                    { t: "Undo if needed", d: "If something looks wrong afterwards, an admin can roll the whole import back." },
                    { t: "Support history from Jira", plan: "Professional and up", d: "Jira Service Management issues come across as cases with their comments, attachments and original keys, closed cases included." },
                  ]}
                />
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="white" id="marketing-hub" testId="section-features-marketing-os" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-5">
              <StepNumber n="07" />
              <Heading className="mt-3">Marketing Hub</Heading>
              <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
                A place to keep prospects and follow up with them, separate from the clients you bill, for firms that want their outreach in the same system as their delivery.
              </p>
              <PlanTag testId="badge-features-marketing-os">Business plan</PlanTag>
              <div className="mt-6">
                <TextLink href="/marketing" testId="link-features-marketing-os">More on the Marketing Hub</TextLink>
              </div>
            </div>
            <div className="md:col-span-7 md:pt-1">
              <Rows
                rows={[
                  { t: "Prospects and companies", d: "Track leads by lifecycle stage, from lead to opportunity, with a lead score. Sort them with tags and segments, or import a contact list." },
                  { t: "Campaigns and sequences", d: "Send one-off email campaigns or multi-step sequences. Unsubscribes and bounces are recorded against the contact." },
                  { t: "Separate from clients", d: "Prospects live in their own records, so marketing lists don’t mix with your client list or your invoices." },
                ]}
              />
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="paper" testId="section-features-plans">
        <Container>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
            <div className="max-w-xl">
              <Heading>What’s on each plan</Heading>
              <p className="mt-5 text-pretty text-[17px] leading-relaxed text-[#3D4350]">
                Unlimited users and the full general ledger come with every plan.
              </p>
            </div>
            <div className="shrink-0 md:pb-1">
              <TextLink href="/pricing" testId="link-features-pricing">Compare plans in detail</TextLink>
            </div>
          </div>
          <div>
            <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-3">
              {PLANS.map((p) => (
                <div key={p.name} className="border-t border-[#15171C] pt-5">
                  <dt className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[#15171C]">{p.name}</span>
                    <span className="text-sm text-[#5F6672]">
                      <span className="font-display text-xl font-semibold text-[#15171C]">{money(p.price)}</span>/mo
                    </span>
                  </dt>
                  <dd className="mt-3 text-pretty text-[15px] leading-relaxed text-[#3D4350]">{p.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-cta">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-balance text-3xl font-semibold leading-tight tracking-[-0.015em] text-white md:text-5xl">
              Try it on next month’s work
            </h2>
            <p className="mt-5 text-balance text-lg leading-relaxed text-white/70">
              Start a 14-day trial on the Professional plan with your own clients and hours, or take the tour first.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-free-trial">Start your 14-day trial</ButtonLink>
              <ButtonLink href="/tour" size="lg" variant="onNight" testId="cta-take-tour">Take the tour</ButtonLink>
            </div>
            <p className="mt-6 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
