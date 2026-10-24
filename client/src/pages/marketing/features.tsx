import { Fragment, type ReactNode } from "react";
import { SEO } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";
import { CURRENCIES } from "@shared/currencies";
import { SCREENS, type ScreenSpec } from "@/components/marketing/screens";
import {
  ButtonLink, Closing, Container, Ctas, Display, Flow, Heading, Lede, MarketingShell, Note, PageHero, Row, Scene, Section,
  TextLink, TRIAL_NOTE,
} from "@/components/marketing/kit";

type Capability = { t: string; d: string; plan?: string };
type Detail = { title: string; body: ReactNode; plan?: string; screen: ScreenSpec };

type Area = {
  id: string;
  testId: string;
  name: string;
  plan?: string;
  planTestId?: string;
  title: string;
  body: string;
  link?: { href: string; label: string; testId: string };
  details: Detail[];
  caps: Capability[];
  extra?: ReactNode;
};

const PRO = "Professional and up";
const BIZ = "Business";

const SWITCH_FROM = [
  { name: "FreshBooks", href: "/compare", testId: "switch-card-freshbooks" },
  { name: "QuickBooks", href: "/switch-from-quickbooks", testId: "switch-card-quickbooks" },
  { name: "Harvest", href: "/switch-from-harvest", testId: "switch-card-harvest" },
  { name: "Xero", href: "/switch-from-xero", testId: "switch-card-xero" },
  { name: "Wave", href: "/switch-from-wave", testId: "switch-card-wave" },
  { name: "BigTime", href: "/switch-from-bigtime", testId: "switch-card-bigtime" },
  { name: "Scoro", href: "/switch-from-scoro", testId: "switch-card-scoro" },
  { name: "Paymo", href: "/switch-from-paymo", testId: "switch-card-paymo" },
  { name: "Jira Service Management", href: "/switch-from-jira-service-management", testId: "switch-card-jira" },
];

const AREAS: Area[] = [
  {
    id: "marketing-hub",
    testId: "section-features-marketing-os",
    name: "Marketing Hub",
    plan: "Business plan",
    planTestId: "badge-features-marketing-os",
    title: "Win new clients from the same system.",
    body: "Keep prospects, campaigns and follow-ups beside the work you deliver, without mixing them into your client list or your invoices.",
    link: { href: "/marketing", label: "More on Marketing Hub", testId: "link-features-marketing-os" },
    details: [
      {
        title: "Contacts and companies",
        screen: SCREENS.contacts,
        body: "Track every lead by lifecycle stage, from first touch to opportunity, with a lead score, tags and segments. Import a list from CSV, or let the chat on your website add people for you.",
      },
      {
        title: "Campaigns and sequences",
        screen: SCREENS.sequences,
        body: "Send a one-off campaign or a multi-step sequence. A sequence stops for anyone who replies, and unsubscribes and bounces are recorded against the contact.",
      },
    ],
    caps: [
      { t: "AI chat for your website", d: "A chat on your own site answers visitors’ questions and adds the interested ones to the hub as leads." },
      { t: "Activity timeline", d: "Every email, tag change and meeting with a contact, in order, on one record." },
      { t: "Kept apart from billing", d: "Prospects live in their own records, so outreach never touches your clients, invoices or reports." },
    ],
  },
  {
    id: "support",
    testId: "feature-section-support",
    name: "Support desk",
    plan: PRO,
    title: "Support your clients, and bill for the time.",
    body: "Connect the Microsoft 365 mailbox your clients already write to. Each email opens or updates a case, and the hours spent on it go on the invoice.",
    link: { href: "/client-support", label: "More on the support desk", testId: "link-features-client-support" },
    details: [
      {
        title: "Cases with an SLA clock",
        screen: SCREENS.caseDetail,
        body: "Every case has a key, a priority, an owner and response and resolution targets for that client, counted in business hours if you choose. Replies, internal notes and logged hours all sit on the case.",
      },
    ],
    caps: [
      { t: "Help Center", d: "Approve a client’s email domain and anyone there signs in with a one-time link to open and follow cases. Customer Admins see every case their company has open." },
      { t: "Support you can bill", d: "Hours logged on a case are ordinary time entries, so they reach the timesheet, the invoice and the payout." },
      { t: "Jira Service Management import", d: "Issues come across as cases with their comments, attachments and original keys, closed cases included." },
      { t: "Client portal", plan: "Every plan", d: "Clients see their invoices and pay them online, with alerts when something is overdue." },
    ],
  },
  {
    id: "time",
    testId: "feature-section-time",
    name: "Time and expenses",
    title: "Log the hours once, and use them everywhere.",
    body: "Your team logs time on a weekly timesheet or with a timer, against a project or a support case. That one record feeds the invoice, the payout and the reports.",
    details: [
      {
        title: "Timesheets and a timer",
        screen: SCREENS.time,
        plan: "Approvals: Professional and up",
        body: "Fill in the week, or switch to a day or month view. Mark each entry billable or not. People submit their week, and an admin approves it or sends it back with a reason, one at a time or in bulk.",
      },
      {
        title: "Expenses and receipts",
        screen: SCREENS.expenses,
        body: "Photograph a receipt and AI reads it for you. Expense reports post to the ledger once they’re approved, and reimbursements post when you pay them.",
      },
    ],
    caps: [
      { t: "Expense approvals", plan: PRO, d: "Expenses wait for an admin before they post or get reimbursed." },
      { t: "Batch expense reports", plan: PRO, d: "Bundle a trip’s or a month’s expenses into one report and approve them together." },
      { t: "Project budgets", plan: PRO, d: "Give each project a budget in hours and keep the work inside it." },
      { t: "Expense analytics", d: "Spending by category, project and person over time." },
    ],
  },
  {
    id: "invoicing",
    testId: "feature-section-invoicing",
    name: "Billing",
    title: "Turn approved time into invoices that get paid.",
    body: "Pick a client and CherryWorks Pro builds the invoice from their unbilled hours at each person’s rate. Send it from your own mailbox and let the client pay online.",
    details: [
      {
        title: "Invoices from your hours",
        screen: SCREENS.invoices,
        body: "Limit an invoice to a date range or to certain people, and group the lines by person, project, service or support case. It goes out from your Microsoft 365, Google or SMTP account with the PDF attached, to several contacts at once.",
      },
      {
        title: "Estimates and proposals",
        screen: SCREENS.estimates,
        body: "Send an estimate, let the client approve it online, and turn it into an invoice in one step. See what’s pending, what’s been accepted and how many convert.",
      },
    ],
    caps: [
      { t: "Card and ACH", d: "Clients pay through Stripe, and each payment posts to the ledger by itself." },
      { t: "Recurring invoices", d: "Templates for retainers and repeat work. On Professional and up they can charge the card on file." },
      { t: `${CURRENCIES.length} currencies`, d: "Invoice each client in their own currency and report across all of them." },
      { t: "Custom invoice themes", plan: PRO, d: "Your own colors and layout on invoices and their PDFs." },
      { t: "Dunning and payment plans", plan: BIZ, d: "Reminders that chase late invoices for you, and plans that split a large balance into instalments." },
      { t: "Multi-jurisdiction tax engine", plan: BIZ, d: "The right tax rates applied for each client’s location." },
    ],
  },
  {
    id: "payouts",
    testId: "feature-section-payouts",
    name: "Payouts",
    title: "Pay your team from the hours that billed the client.",
    body: "A person’s payout is the hours they logged times their cost rate. You see what you owe each person before you pay it, and they can see where their own hours stand. CherryWorks Pro tracks what’s owed; it doesn’t run payroll.",
    details: [
      {
        title: "What each person is owed",
        screen: SCREENS.payouts,
        body: "Every hour carries a status: unbilled, invoiced, pending payout or paid. Pay contractors through Stripe Connect on Professional and up, or record a payment made by Zelle, ACH or check.",
      },
    ],
    caps: [
      { t: "Employees, contractors and partners", d: "Add each person as W-2, 1099 or corp-to-corp, with their own cost rate." },
      { t: "W-2 staff", d: "Pay employees through your payroll provider, as you do today. CherryWorks Pro doesn’t withhold taxes or file payroll." },
      { t: "Statements and 1099s", d: "Download a payout statement for anyone as a PDF or a spreadsheet, and run the 1099 export at year end." },
      { t: "Vendor 1099 management", plan: PRO, d: "Track which vendors need a 1099 and what you paid each of them." },
      { t: "Automatic reimbursements", plan: PRO, d: "Approved out-of-pocket expenses become a reimbursement payout to the person who paid." },
    ],
  },
  {
    id: "books",
    testId: "feature-section-books",
    name: "Books and reports",
    title: "The books keep up with the work.",
    body: "Every plan includes a double-entry general ledger. Invoices, payments, refunds, payouts and approved expenses post their own journal entries, so month end isn’t a catch-up job.",
    details: [
      {
        title: "A general ledger on every plan",
        screen: SCREENS.journal,
        body: "A chart of accounts, journal entries posted for you or by hand, a ledger for each account and a trial balance.",
      },
      {
        title: `${REPORT_COUNT} reports, and your own`,
        screen: SCREENS.reports,
        plan: "Report builder and scheduled reports: Business",
        body: "AR aging, unbilled time, WIP aging, project profitability, utilization, cash flow, payout detail and a 1099 export, among others. Build your own reports and have them emailed on a schedule.",
      },
    ],
    caps: [
      { t: "Bank feeds", plan: PRO, d: "Connect bank accounts through Stripe Financial Connections and match transactions to payments, payouts and expenses." },
      { t: "Month-end and year-end close", plan: BIZ, d: "Lock a closed month so nothing new posts into it, reopen it to make a correction, and close the year." },
      { t: "Multiple entities", plan: BIZ, d: "Keep the books for more than one company under one login." },
      { t: "Dashboards for each role", plan: BIZ, d: "Owners, managers and team members each open to the numbers they need." },
      { t: "Multi-currency reporting", d: "Revenue and receivables rolled up across every currency you bill in." },
    ],
  },
  {
    id: "moving-in",
    testId: "feature-section-moving-in",
    name: "Moving in",
    plan: "Import wizard: Professional and up",
    title: "Move in without starting over.",
    body: "Bring your clients, projects, time, invoices and payments over from the system you use now. The import wizard shows you what it will create before anything is written.",
    link: { href: "/compare", label: "See how it compares", testId: "link-features-compare" },
    details: [],
    extra: (
      <p className="mt-10 max-w-[820px] text-[17px] leading-[1.7] text-[#5C606A] md:text-[19px]">
        Switching from{" "}
        {SWITCH_FROM.map((s, i) => (
          <Fragment key={s.testId}>
            <TextLink href={s.href}><span data-testid={s.testId}>{s.name}</span></TextLink>
            {i < SWITCH_FROM.length - 2 ? ", " : i === SWITCH_FROM.length - 2 ? " or " : ""}
          </Fragment>
        ))}
        ? Each has its own guide to the move.
      </p>
    ),
    caps: [
      { t: "Preview first", d: "Each import runs as a dry run, so you see what it will create, and which rows it will skip and why, before you commit." },
      { t: "Undo if needed", d: "If something looks wrong afterwards, an admin can roll the whole import back." },
      { t: "API and webhooks", plan: PRO, d: "Connect your other tools, and get a webhook when invoices, payments, clients, estimates or timesheets change." },
      { t: "Audit log and bulk edits", plan: BIZ, d: "Search who changed what and when, and update many records at once." },
      { t: "CherryAssist", d: "Ask how to do something and get an answer inside the app." },
      { t: "SSO and SAML", plan: "Enterprise", d: "Sign in through your identity provider, with MFA required across the firm." },
    ],
  },
];

const INDEX = AREAS.map((a) => ({ id: a.id, label: a.name }));

const PLANS = [
  { name: "Starter", price: PLAN_PRICING.STARTER.monthly, d: "Up to 5 clients and 3 projects. Time, expenses, invoicing, payouts, the general ledger and the built-in reports." },
  { name: "Professional", price: PLAN_PRICING.PROFESSIONAL.monthly, d: "Unlimited clients and projects. Adds the support desk and Help Center, approvals, bank feeds, Stripe Connect payouts, imports and the API. Your trial runs on this plan." },
  { name: "Business", price: PLAN_PRICING.BUSINESS.monthly, d: "Everything in Professional, plus Marketing Hub, period close, multi-entity, dunning and advanced reporting." },
];

function Caps({ caps }: { caps: Capability[] }) {
  return (
    <dl className="mt-16 grid gap-x-10 sm:grid-cols-2 md:mt-24 lg:grid-cols-3 lg:gap-x-[72px]">
      {caps.map((c) => (
        <div key={c.t} className="border-t border-[#E6E3DD] pb-8 pt-5">
          <dt className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">
            {c.t}
            {c.plan && <span className="mt-0.5 block text-[13px] font-normal text-[#6E727B]">{c.plan}</span>}
          </dt>
          <dd className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{c.d}</dd>
        </div>
      ))}
    </dl>
  );
}

function AreaSection({ area }: { area: Area }) {
  return (
    <Section id={area.id} testId={area.testId} className="scroll-mt-24">
      <Container>
        <p className="text-[15px] font-medium text-[#CF3339]">
          {area.name}
          {area.plan && <span data-testid={area.planTestId} className="font-normal text-[#6E727B]"> · {area.plan}</span>}
        </p>
        <Heading className="mt-3">{area.title}</Heading>
        <Lede className="mt-5">{area.body}</Lede>
        {area.link && (
          <p className="mt-5 text-[15px]">
            <TextLink href={area.link.href} testId={area.link.testId}>{area.link.label}</TextLink>
          </p>
        )}
        {area.extra}
        {area.details.length > 0 && (
          <Flow>
            {area.details.map((d, i) => (
              <Row key={d.title} title={d.title} screen={d.screen} flip={i % 2 === 1}>
                <p>{d.body}</p>
                {d.plan && <p className="text-[14px] text-[#6E727B]">{d.plan}</p>}
              </Row>
            ))}
          </Flow>
        )}
        <Caps caps={area.caps} />
      </Container>
    </Section>
  );
}

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <SEO path="/features" />

      <PageHero>
        <Container>
          <p className="text-[15px] font-medium text-[#CF3339]">Product</p>
          <Display testId="features-heading" className="mt-4">From the first conversation to the closed month.</Display>
          <Lede size="hero" className="mt-5 md:mt-6">
            CherryWorks Pro runs the front office and the back office of a services business: finding clients, supporting them,
            tracking time, billing, paying your team and keeping the books. Here is each part, what it does and which plan it’s on.
          </Lede>
          <Ctas>
            <ButtonLink href="/signup" testId="features-cta-signup">Start your trial</ButtonLink>
            <ButtonLink href="/tour" variant="secondary" testId="see-it-in-action">Take the tour</ButtonLink>
          </Ctas>
          <Note>{TRIAL_NOTE}</Note>

          <nav aria-label="On this page" data-testid="category-nav" className="mt-12 border-t border-[#E6E3DD] pt-5">
            <ul className="flex flex-wrap gap-x-7 gap-y-2.5 text-[15px]">
              {INDEX.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="text-[#5C606A] transition-colors hover:text-[#15171C]">{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <Scene screen={SCREENS.dashboard} priority testId="features-hero-screen" className="mt-10" />
        </Container>
      </PageHero>

      {AREAS.map((area) => (
        <AreaSection key={area.id} area={area} />
      ))}

      <Section testId="section-features-plans">
        <Container>
          <Heading>What’s on each plan</Heading>
          <Lede className="mt-5">Unlimited users and the full general ledger come with every plan.</Lede>
          <dl className="mt-10 grid border-t border-[#15171C] md:mt-14 md:grid-cols-3">
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={`py-6 md:pb-2 md:pr-8 md:pt-8 ${i > 0 ? "border-t border-[#E6E3DD] md:border-l md:border-t-0 md:pl-8" : ""}`}
              >
                <dt className="flex items-baseline justify-between gap-3">
                  <span className="text-[18px] font-medium text-[#15171C]">{p.name}</span>
                  <span className="text-[14px] text-[#6E727B]">
                    <span className="text-[24px] font-medium tracking-[-0.02em] text-[#15171C]">${p.price}</span> /month
                  </span>
                </dt>
                <dd className="mt-3 text-[16px] leading-[1.55] text-[#5C606A]">{p.d}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-7 text-[15px] text-[#5C606A]">
            Larger firms can ask about Enterprise for SSO, custom terms and an account manager.{" "}
            <TextLink href="/pricing" testId="link-features-pricing">Compare plans in detail</TextLink>
          </p>
        </Container>
      </Section>

      <Closing
        heading="Try it on next month’s work."
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-free-trial" }}
        secondary={{ href: "/tour", label: "Take the tour", testId: "cta-take-tour" }}
      />
    </MarketingShell>
  );
}
