import type { ReactNode } from "react";
import { SEO } from "@/components/seo";
import {
  MarketingShell,
  Container,
  Section,
  PageHero,
  Eyebrow,
  Display,
  Heading,
  Lede,
  ButtonLink,
  TextLink,
  Screenshot,
} from "@/components/marketing/kit";
import { REPORT_COUNT } from "@shared/seo-routes";

/**
 * /tour — the product tour. One month at a services firm, told with real
 * screenshots of the product (filled with a fictional firm's sample data):
 * a support request, the hours, the invoice, the payout. Every section is
 * rendered in the page, stacked, so the pre-rendered HTML carries all of it.
 *
 * The e2e spec (e2e/public-demo.spec.ts) asserts the `demo-section-*` testids
 * and a few `button-*` testids from the old mockup tour. They now sit on the
 * honest text that describes each feature.
 */

const STEPS = [
  { id: "step-1", label: "A support request comes in" },
  { id: "step-2", label: "Time gets logged and approved" },
  { id: "step-3", label: "The invoice goes out and gets paid" },
  { id: "step-4", label: "Your team gets paid" },
];

function StepNumber({ n }: { n: number }) {
  return <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">Step {n}</p>;
}

function StepText({ children }: { children: ReactNode }) {
  return <p className="mt-5 text-[17px] leading-relaxed text-[#3D4350]">{children}</p>;
}

function Facts({ children }: { children: ReactNode }) {
  return <ul className="border-b border-[#E6E2DA]">{children}</ul>;
}

function FactItem({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <li data-testid={testId} className="border-t border-[#E6E2DA] py-3.5 text-[15px] leading-relaxed text-[#3D4350]">
      {children}
    </li>
  );
}

function Feature({ title, plan, testId, children }: { title: string; plan?: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="border-t border-[#E6E2DA] pt-5">
      <dt className="font-semibold text-[#15171C]">
        {title}
        {plan && <span className="ml-2 text-[13px] font-normal text-[#5F6672]">{plan}</span>}
      </dt>
      <dd className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{children}</dd>
    </div>
  );
}

function FeatureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-12 md:gap-12">
      <h3 className="font-display text-xl font-semibold tracking-[-0.01em] text-[#15171C] md:col-span-3">{title}</h3>
      <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2 md:col-span-9">{children}</dl>
    </div>
  );
}

export default function DemoPage() {
  return (
    <MarketingShell>
      <SEO path="/tour" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Product tour</Eyebrow>
            <Display testId="demo-heading" className="mt-5">
              One month at a services firm, start to finish
            </Display>
            <Lede className="mt-6">
              Follow one client request through CherryWorks Pro: the support case, the hours, the invoice and the
              payout to the people who did the work.
            </Lede>
          </div>

          <nav aria-label="Tour steps" className="mt-14">
            <ol className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li key={step.id} className="border-t border-[#E6E2DA]">
                  <a
                    href={`#${step.id}`}
                    data-testid={`link-tour-${step.id}`}
                    className="group flex gap-3 py-4 text-[15px] font-semibold text-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339]"
                  >
                    <span className="font-display text-sm text-[#B32A30]">{i + 1}</span>
                    <span className="underline decoration-transparent underline-offset-[5px] group-hover:decoration-[#CF3339]">
                      {step.label}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <p data-testid="demo-section-accessibility" className="mt-8 max-w-2xl text-sm leading-relaxed text-[#5F6672]">
            Every screen below is a real screenshot of CherryWorks Pro, filled with sample data for a fictional firm.
            Each one has a written description for screen readers.
          </p>
        </Container>
      </PageHero>

      {/* Step 1: support */}
      <Section tone="white" id="step-1" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <StepNumber n={1} />
              <Heading className="mt-3">A support request comes in</Heading>
              <StepText>
                A client emails your support address or opens a request in your Help Center, and it lands in Support
                Cases with a key made from the client’s name. Whoever picks it up sees the priority, the SLA clock and
                the hours already spent.
              </StepText>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <Facts>
                <FactItem>
                  Requests come in by email (Microsoft 365 mailboxes), through your Help Center, or entered by your team.
                </FactItem>
                <FactItem>SLA targets are set per client and respect business hours.</FactItem>
                <FactItem>
                  Clients sign in to the Help Center with a one-time link instead of a password. Customer Admins see
                  every case their company has open.
                </FactItem>
                <FactItem>Support Cases are on Professional and up.</FactItem>
              </Facts>
            </div>
          </div>

          <Screenshot
            className="mt-14"
            src="/marketing/screens/support-cases.webp"
            width={1600}
            height={1217}
            url="cherryworkspro.com/support/cases"
            alt="The Support Cases list with six open cases for sample clients. Each row shows a case key such as BL-1, the subject, type, priority, status, assignee, time left on the SLA and hours logged."
          />

          <div className="mt-16 grid items-start gap-8 md:mt-20 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-4">
              <h3 className="font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-balance text-[#15171C] md:text-[1.75rem]">
                Work the case and log the time
              </h3>
              <p className="mt-4 text-[17px] leading-relaxed text-[#3D4350]">
                The case page keeps the conversation, attachments and properties together. Reply to the customer, or
                leave an internal note only your team sees.
              </p>
              <p className="mt-4 text-[17px] leading-relaxed text-[#3D4350]">
                Time logged on the case is shown as billable, unbilled and invoiced, so support hours reach the invoice.
              </p>
            </div>
            <div className="md:col-span-8">
              <Screenshot
                src="/marketing/screens/case-detail.webp"
                width={2000}
                height={1521}
                fade
                url="cherryworkspro.com/support/cases/BL-1"
                alt="Support case BL-1, “Driver app shows yesterday’s routes after 6am”, for a sample client. It shows the description, a customer reply, an internal note, a reply composer, the case properties and an hours panel with logged, billable, unbilled and invoiced time."
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* Step 2: time */}
      <Section tone="paper" id="step-2" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <StepNumber n={2} />
              <Heading className="mt-3" testId="demo-section-time">
                Time gets logged and approved
              </Heading>
              <StepText>
                Everyone logs time against a client project or a support case, with a timer or by entry. At the end of
                the week they submit their timesheet, and a manager reviews it.
              </StepText>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <Facts>
                <FactItem>Day, week and month views, with filters by person, project, date range and billable.</FactItem>
                <FactItem testId="demo-section-timesheet-approval">
                  Managers can <span data-testid="button-approve-0">approve a week</span>,{" "}
                  <span data-testid="button-approve-all">approve a whole batch at once</span>, or{" "}
                  <span data-testid="button-reject-0">send one back with a reason</span>. A submitted week can be
                  recalled before it’s approved.
                </FactItem>
                <FactItem>Timesheet approvals are on Professional and up.</FactItem>
              </Facts>
            </div>
          </div>

          <Screenshot
            className="mt-14"
            src="/marketing/screens/time.webp"
            width={1600}
            height={1041}
            fade
            url="cherryworkspro.com/time"
            alt="The weekly timesheet for October 18 to 24, 2026, with daily bars colored by project, a week total against a 40-hour target, and buttons to submit the week, generate an invoice, start a timer or add an entry."
          />
        </Container>
      </Section>

      {/* Step 3: invoice and payment */}
      <Section tone="white" id="step-3" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <StepNumber n={3} />
              <Heading className="mt-3" testId="demo-section-invoicing">
                The invoice goes out from your mailbox, and the client pays
              </Heading>
              <StepText>
                Generate Invoice turns a client’s hours into invoice lines, grouped by team member, project, service or
                case. It goes out from your own email address with the PDF attached, and the client can pay online.
              </StepText>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <Facts>
                <FactItem>
                  Sends from your firm’s Microsoft 365, Google or SMTP mailbox, to one or more contacts with CC.
                </FactItem>
                <FactItem testId="demo-section-stripe">
                  Clients pay by card or ACH bank transfer through Stripe, and the payment posts to your general ledger.
                </FactItem>
                <FactItem>You choose whether an invoice includes time that hasn’t been approved yet.</FactItem>
                <FactItem>Recurring invoices for retainers, blank invoices for anything else, and an Excel export.</FactItem>
              </Facts>
            </div>
          </div>

          <Screenshot
            className="mt-14"
            src="/marketing/screens/invoices.webp"
            width={1600}
            height={1136}
            url="cherryworkspro.com/invoices"
            alt="The Invoices page with totals for invoiced, outstanding, overdue and paid this month, a collection rate, status tabs, and four sample invoices, INV-0001 to INV-0004, two sent and two paid."
          />
        </Container>
      </Section>

      {/* Step 4: payouts */}
      <Section tone="paper" id="step-4" className="scroll-mt-16">
        <Container>
          <div className="grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <StepNumber n={4} />
              <Heading className="mt-3" testId="demo-section-payouts">
                Your team gets paid for the hours they logged
              </Heading>
              <StepText>
                Payouts adds up each person’s unpaid hours at their own cost rate, so you see what you owe before you
                pay it. Pay a contractor through Stripe Connect, or record a payment you made another way.
              </StepText>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <Facts>
                <FactItem>The amount owed is unpaid hours times each person’s cost rate.</FactItem>
                <FactItem>
                  Stripe Connect payouts are on Professional and up. On any plan, you can record a Zelle, ACH, check or
                  wire payment.
                </FactItem>
                <FactItem>Team members see their own hours, earnings and what’s been paid to them.</FactItem>
                <FactItem>W-2 staff are paid through your payroll. CherryWorks Pro doesn’t run payroll.</FactItem>
              </Facts>
            </div>
          </div>

          <Screenshot
            className="mt-14"
            src="/marketing/screens/payouts.webp"
            width={1600}
            height={852}
            url="cherryworkspro.com/payouts"
            alt="The Payouts page with unpaid time value, pending payments, total owed and total paid, and an outstanding balance for each of three team members, with hours, amount and a Pay button."
          />

          <div className="mt-16 flex flex-col gap-6 border-t border-[#E6E2DA] pt-10 md:flex-row md:items-center md:justify-between">
            <p className="max-w-xl text-lg leading-relaxed text-[#3D4350]">
              That’s the month: a request, the hours, the invoice and the payout. Try it with your own clients for 14
              days.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-section-try-the-dashboard">
                Start your 14-day trial
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="secondary" testId="cta-see-pricing">
                See plans
              </ButtonLink>
            </div>
          </div>
        </Container>
      </Section>

      {/* Everything else */}
      <Section tone="white" testId="section-tour-more">
        <Container>
          <div className="max-w-2xl">
            <Heading>The rest of the product</Heading>
            <p className="mt-5 text-lg leading-relaxed text-[#3D4350]">
              The four steps above lean on everything else in CherryWorks Pro. Here’s what else is in it, with the plan
              it needs where that matters.
            </p>
          </div>

          <div className="mt-14 space-y-14">
            <FeatureGroup title="Money and books">
              <Feature title="Dashboard" testId="demo-section-dashboard">
                Revenue trend, revenue by client, AR aging, cash flow and team utilization, plus what needs attention:
                overdue invoices, timesheets waiting for approval and unreconciled bank transactions. Team members get
                their own dashboard.
              </Feature>
              <Feature title="Estimates" testId="demo-section-estimates">
                Send an estimate the client accepts or declines from a link.{" "}
                <span data-testid="button-convert-invoice">Turn an accepted estimate into an invoice</span>,{" "}
                <span data-testid="button-download-pdf">open it as a PDF</span>, or{" "}
                <span data-testid="button-revise-estimate">duplicate it to send a revision</span>.
              </Feature>
              <Feature title="Expenses" plan="Approvals on Professional and up" testId="demo-section-expenses">
                Team members submit expenses with a receipt attached. You approve them, reimburse through a payout, and
                put billable ones on the client’s invoice.
              </Feature>
              <Feature title="Receipt scanning" testId="demo-section-ai-receipt">
                Upload a photo or PDF of a receipt and the vendor, date, tax and total are read from it and filled in
                for you to check.
              </Feature>
              <Feature title="Multi-currency" testId="demo-section-multi-currency">
                Bill a client in their own currency, with the exchange rate to your base currency recorded on the
                invoice.
              </Feature>
              <Feature title="General ledger" testId="demo-section-gl">
                A full general ledger on every plan: chart of accounts, journal entries and a trial balance, with
                invoices and payments posting to it. Period closes are on Business.
              </Feature>
              <Feature title="Bank feeds" plan="Professional and up" testId="demo-section-bank-recon">
                Connect bank accounts through Stripe Financial Connections. Transactions are matched to invoice payments
                and payouts, and you accept the matches.
              </Feature>
              <Feature title="Reports" testId="demo-section-reports">
                {REPORT_COUNT} built-in reports, including AR aging, unbilled time, project profitability, budget burn,
                utilization, timesheet compliance and a 1099 export.
              </Feature>
            </FeatureGroup>

            <FeatureGroup title="Clients and team">
              <Feature title="Customer portal" testId="demo-section-client-portal">
                Billing contacts sign in with a one-time link to see their invoices, estimates, payments and balance.
              </Feature>
              <Feature title="Team onboarding" testId="demo-section-team-onboarding">
                Invite people by email. Contractors fill in their profile, business details, payment method and address,
                and confirm their W-9 is on file. W-2 staff fill in their profile and address.
              </Feature>
              <Feature title="Marketing Hub" plan="Business" testId="demo-section-marketing-os">
                <span className="block">
                  Prospects, campaigns, email sequences and segments, kept apart from your billing clients.
                </span>
                <TextLink href="/marketing" testId="link-tour-marketing-os" className="mt-3">
                  Tour the Marketing Hub
                </TextLink>
              </Feature>
            </FeatureGroup>

            <FeatureGroup title="Setup and help">
              <Feature title="Import wizard" plan="Professional and up" testId="demo-section-import-wizard">
                Bring your data from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro or Paymo, with a
                preview before anything is written. Support cases import from Jira Service Management with their
                comments, attachments and original keys.
              </Feature>
              <Feature title="API and webhooks" plan="Professional and up" testId="demo-section-api">
                A REST API for reading clients, invoices, payments, time entries, projects and team, with API keys and
                an OpenAPI spec. Outgoing webhooks keep a delivery log.
              </Feature>
              <Feature title="CherryAssist" testId="demo-section-cherry-assist">
                In-app help: press / or the help button to search the help articles, and send a support request if
                nothing answers your question.
              </Feature>
              <Feature title="Mission Control" testId="demo-section-mission-control">
                A getting-started page with setup steps, an implementation guide for admins and managers, what’s new and
                tips.
              </Feature>
            </FeatureGroup>
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-cta">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2
              data-testid="demo-cta-heading"
              className="font-display text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance text-white md:text-5xl"
            >
              Run next month in CherryWorks Pro
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Start a 14-day trial on the Professional plan, or book a demo and walk through your own setup with us.
              Unlimited users on every plan.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">
                Start free trial
              </ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight" testId="cta-book-demo">
                Book a demo
              </ButtonLink>
            </div>
            <p className="mt-6 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
