import type { ReactNode } from "react";
import { SEO } from "@/components/seo";
import { SCREENS } from "@/components/marketing/screens";
import {
  ButtonLink, Closing, Container, Ctas, Display, Eyebrow, Flow, Heading, Lede, MarketingShell, Note, PageHero, Row,
  Scene, Section, TextLink,
} from "@/components/marketing/kit";
import { REPORT_COUNT } from "@shared/seo-routes";
import { CURRENCIES } from "@shared/currencies";

/**
 * /tour — the product tour. One month at a services firm, told with real
 * screens of the product filled with a fictional firm's sample data: a lead,
 * a support request, the hours, the invoice, the payout and the close. Every
 * section is rendered in the page, stacked, so the pre-rendered HTML carries
 * all of it.
 *
 * The e2e spec (e2e/public-demo.spec.ts) asserts the `demo-section-*` testids
 * and a few `button-*` testids from the old mockup tour. They sit on the text
 * that describes each feature.
 */

const STEPS = [
  { id: "step-1", label: "A lead becomes a client" },
  { id: "step-2", label: "A support request comes in" },
  { id: "step-3", label: "Time is logged and approved" },
  { id: "step-4", label: "The invoice is paid" },
  { id: "step-5", label: "Your team is paid" },
  { id: "step-6", label: "The month closes" },
];

function Facts({ children }: { children: ReactNode }) {
  return <ul className="mt-6 border-t border-[#E6E3DD]">{children}</ul>;
}

function Fact({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <li data-testid={testId} className="border-b border-[#E6E3DD] py-3 text-[15.5px] leading-snug text-[#15171C]">
      {children}
    </li>
  );
}

function Step({ id, kicker, title, lede, children }: { id: string; kicker: string; title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <Section id={id} className="scroll-mt-24">
      <Container>
        <Eyebrow>{kicker}</Eyebrow>
        <Heading className="mt-3">{title}</Heading>
        <Lede className="mt-5">{lede}</Lede>
        {children}
      </Container>
    </Section>
  );
}

function Feature({ title, plan, testId, children }: { title: string; plan?: string; testId?: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="border-t border-[#E6E3DD] pb-8 pt-5">
      <dt className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">
        {title}
        {plan && <span className="mt-0.5 block text-[13px] font-normal text-[#6E727B]">{plan}</span>}
      </dt>
      <dd className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{children}</dd>
    </div>
  );
}

function FeatureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[3fr_9fr] md:gap-[72px]">
      <h3 className="pt-5 text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">{title}</h3>
      <dl className="grid gap-x-10 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

export default function DemoPage() {
  return (
    <MarketingShell>
      <SEO path="/tour" />

      <PageHero>
        <Container>
          <Eyebrow>Product tour</Eyebrow>
          <Display testId="demo-heading" className="mt-4">
            One month at a services firm, start to finish.
          </Display>
          <Lede size="hero" className="mt-6">
            Follow one client through CherryWorks Pro: the first conversation, a support request, the hours, the invoice, the payout to the people who did the work, and the close.
          </Lede>
          <nav aria-label="Tour steps" className="mt-10">
            <ul className="flex flex-wrap gap-x-7 gap-y-3 text-[15px]">
              {STEPS.map((step) => (
                <li key={step.id}>
                  <a
                    href={`#${step.id}`}
                    data-testid={`link-tour-${step.id}`}
                    className="border-b border-[#CFCBC3] text-[#15171C] transition-colors hover:border-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C]"
                  >
                    {step.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Scene screen={SCREENS.dashboard} priority className="mt-14 md:mt-20" testId="tour-hero-screen" />
          <p data-testid="demo-section-accessibility" className="mt-5 max-w-[620px] text-[14px] leading-relaxed text-[#6E727B]">
            Every screen on this page is the real product, filled with sample data for a fictional firm. Each one has a written description for screen readers.
          </p>
        </Container>
      </PageHero>

      <Step
        id="step-1"
        kicker="Marketing Hub"
        title="A lead becomes a client."
        lede="A visitor asks your website chat a question and leaves their email. They land in Marketing Hub as a lead, get a short sequence of follow-ups, and when they sign, they become a client ready for projects and invoices."
      >
        <Flow>
          <Row title="Every touch on one record." screen={SCREENS.contact} testId="demo-section-marketing-os">
            <p>Emails, calls, meetings and notes on a single timeline, with a lifecycle stage and a lead score. Prospects stay apart from the clients you bill.</p>
            <Facts>
              <Fact>Sequences stop when someone replies</Fact>
              <Fact>Campaigns go out from your own mailbox</Fact>
              <Fact>Marketing Hub is on the Business plan</Fact>
            </Facts>
            <p className="mt-5 text-[15px]">
              <TextLink href="/marketing" testId="link-tour-marketing-os">Tour the Marketing Hub</TextLink>
            </p>
          </Row>
        </Flow>
      </Step>

      <Step
        id="step-2"
        kicker="Support desk"
        title="A support request comes in."
        lede="The client emails your support address or opens a request in your Help Center, and it lands in Support Cases with a key made from the client’s name. Whoever picks it up sees the priority, the SLA clock and the hours already spent."
      >
        <Scene screen={SCREENS.supportCases} className="mt-12 md:mt-16" />
        <Flow>
          <Row title="Work the case and log the time." screen={SCREENS.caseDetail} flip>
            <p>The case page keeps the conversation, attachments and properties together. Reply to the client, or leave an internal note only your team sees.</p>
            <Facts>
              <Fact>Requests arrive by email, through the Help Center, or entered by your team</Fact>
              <Fact>SLA targets per client, counted in business hours</Fact>
              <Fact>Clients sign in with a one-time link, not a password</Fact>
              <Fact>Hours on the case show as billable, unbilled and invoiced</Fact>
            </Facts>
          </Row>
        </Flow>
      </Step>

      <Step
        id="step-3"
        kicker="Time and expenses"
        title="Time is logged and approved."
        lede="Everyone logs time against a client project or a support case, with a timer or by entry. At the end of the week they submit their timesheet, and a manager reviews it."
      >
        <Flow>
          <Row title="One week, every project." screen={SCREENS.time} testId="demo-section-time">
            <p>Day, week and month views, with filters by person, project, date range and billable.</p>
            <Facts>
              <Fact testId="demo-section-timesheet-approval">
                Managers can <span data-testid="button-approve-0">approve a week</span>,{" "}
                <span data-testid="button-approve-all">approve a whole batch at once</span>, or{" "}
                <span data-testid="button-reject-0">send one back with a reason</span>
              </Fact>
              <Fact>A submitted week can be recalled before it’s approved</Fact>
              <Fact>Timesheet approvals are on Professional and up</Fact>
            </Facts>
          </Row>
          <Row title="Receipts that fill themselves in." screen={SCREENS.expenses} flip testId="demo-section-expenses">
            <p>Team members submit expenses with a receipt attached. You approve them, reimburse through a payout, and put billable ones on the client’s invoice.</p>
            <p data-testid="demo-section-ai-receipt">Upload a photo or PDF of a receipt and AI reads the vendor, date, tax and total for you to check.</p>
          </Row>
        </Flow>
      </Step>

      <Step
        id="step-4"
        kicker="Billing"
        title="The invoice goes out, and the client pays."
        lede="Generate Invoice turns a client’s hours into invoice lines, grouped by team member, project, service or case. It goes out from your own email address with the PDF attached, and the client pays online."
      >
        <Flow>
          <Row title="Every invoice, and where it stands." screen={SCREENS.invoices} testId="demo-section-invoicing">
            <p>Sent from your firm’s Microsoft 365, Google or SMTP mailbox, to one or more contacts with CC.</p>
            <Facts>
              <Fact testId="demo-section-stripe">Card or ACH through Stripe, posted to your general ledger</Fact>
              <Fact>Recurring invoices that charge the card on file</Fact>
              <Fact>Dunning and payment plans on Business</Fact>
              <Fact testId="demo-section-multi-currency">Bill in the client’s currency, {CURRENCIES.length} supported, with the rate recorded</Fact>
            </Facts>
          </Row>
          <Row title="Estimates the client approves online." screen={SCREENS.estimates} flip testId="demo-section-estimates">
            <p>
              Send an estimate the client accepts or declines from a link.{" "}
              <span data-testid="button-convert-invoice">Turn an accepted estimate into an invoice</span>,{" "}
              <span data-testid="button-download-pdf">open it as a PDF</span>, or{" "}
              <span data-testid="button-revise-estimate">duplicate it to send a revision</span>.
            </p>
          </Row>
        </Flow>
      </Step>

      <Step
        id="step-5"
        kicker="Payouts"
        title="Your team is paid for the hours they logged."
        lede="Payouts adds up each person’s unpaid hours at their own cost rate, so you see what you owe before you pay it. Pay a contractor through Stripe Connect, or record a payment you made another way."
      >
        <Flow>
          <Row title="What you owe each person." screen={SCREENS.payouts} testId="demo-section-payouts">
            <p>The amount owed is unpaid hours times each person’s cost rate, and team members see their own hours, earnings and payments.</p>
            <Facts>
              <Fact>Stripe Connect payouts on Professional and up</Fact>
              <Fact>Record Zelle, ACH, check or wire payments on any plan</Fact>
              <Fact>W-2 staff stay on your payroll provider</Fact>
            </Facts>
          </Row>
        </Flow>
      </Step>

      <Step
        id="step-6"
        kicker="Books"
        title="The month closes."
        lede="Invoices, payments, expenses and payouts have already posted to a full general ledger. Match the bank feed, check the trial balance, and lock the month."
      >
        <Flow>
          <Row title="The journal, already written." screen={SCREENS.journal} testId="demo-section-gl">
            <p>A chart of accounts, journal entries and a trial balance on every plan.</p>
            <Facts>
              <Fact testId="demo-section-bank-recon">Bank feeds through Stripe Financial Connections, matched to payments and payouts (Professional and up)</Fact>
              <Fact>Month-end and year-end close, and multiple entities, on Business</Fact>
            </Facts>
          </Row>
          <Row title={`${REPORT_COUNT} reports, ready on day one.`} screen={SCREENS.reports} flip testId="demo-section-reports">
            <p>AR aging, unbilled time, project profitability, budget burn, utilization, timesheet compliance and a 1099 export. A report builder and scheduled reports by email come with Business.</p>
          </Row>
        </Flow>
        <div className="mt-20 flex flex-col gap-6 border-t border-[#E6E3DD] pt-10 md:mt-[120px] md:flex-row md:items-center md:justify-between">
          <p className="max-w-xl text-[19px] leading-[1.5] text-[#15171C]">
            That’s the month. Try it with your own clients for 14 days.
          </p>
          <Ctas className="md:mt-0">
            <ButtonLink href="/signup" testId="cta-section-try-the-dashboard">Start your trial</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" testId="cta-see-pricing">See plans</ButtonLink>
          </Ctas>
        </div>
      </Step>

      <Section testId="section-tour-more">
        <Container>
          <Heading>The rest of the product.</Heading>
          <Lede className="mt-5">What else is in CherryWorks Pro, with the plan it needs where that matters.</Lede>
          <div className="mt-12 space-y-10 md:mt-16 md:space-y-14">
            <FeatureGroup title="Every day">
              <Feature title="Dashboard" testId="demo-section-dashboard">
                Revenue trend, revenue by client, AR aging, cash flow and team utilization, plus what needs attention: overdue invoices, timesheets waiting for approval and unreconciled bank transactions.
              </Feature>
              <Feature title="Dashboards for each role" plan="Business">
                Partners, managers and team members each open to the numbers they own.
              </Feature>
              <Feature title="Client portal" testId="demo-section-client-portal">
                Billing contacts sign in with a one-time link to see their invoices, estimates, payments and balance.
              </Feature>
              <Feature title="Team onboarding" testId="demo-section-team-onboarding">
                Invite people by email. Contractors fill in their profile, business details, payment method and address, and confirm their W-9 is on file.
              </Feature>
            </FeatureGroup>

            <FeatureGroup title="Setup and help">
              <Feature title="Import wizard" plan="Professional and up" testId="demo-section-import-wizard">
                Bring your data from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro or Paymo, with a preview before anything is written. Support cases come from Jira with their comments, attachments and original keys.
              </Feature>
              <Feature title="API and webhooks" plan="Professional and up" testId="demo-section-api">
                A REST API with API keys and an OpenAPI spec, and webhooks when invoices, payments, clients, estimates or timesheets change.
              </Feature>
              <Feature title="CherryAssist" testId="demo-section-cherry-assist">
                Ask how to do something and get an answer inside the app, or send a support request if nothing answers it.
              </Feature>
              <Feature title="Mission Control" testId="demo-section-mission-control">
                A getting-started page with setup steps, an implementation guide for admins and managers, what’s new and tips.
              </Feature>
              <Feature title="Audit log and bulk edits" plan="Business">
                Search who changed what and when, and change many records at once.
              </Feature>
            </FeatureGroup>
          </div>
        </Container>
      </Section>

      <Closing
        heading="Run next month in CherryWorks Pro."
        headingTestId="demo-cta-heading"
        body="Start a 14-day trial, or book a demo and walk through your own setup with us. Unlimited users on every plan."
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
