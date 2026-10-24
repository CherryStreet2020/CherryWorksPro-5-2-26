import { Fragment } from "react";
import { SEO } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";
import { SCREENS } from "@/components/marketing/screens";
import {
  Area, Areas, ButtonLink, Closing, Container, Ctas, Display, Flow, Heading, Lede, MarketingShell, Note, PageHero,
  Row, Scene, Section, TextLink, TRIAL_NOTE,
} from "@/components/marketing/kit";

const AREAS = [
  {
    title: "Marketing Hub", plan: "Business", href: "/marketing",
    body: "Contacts, companies and segments. Campaigns and sequences that stop when someone replies, and an AI chat for your own website that turns visitors into leads.",
  },
  {
    title: "Support desk", plan: "Professional and up", href: "/client-support",
    body: "Client emails become cases with SLA timers. Every client gets a Help Center and a portal, and the time logged on a case lands on their invoice.",
  },
  {
    title: "Time and expenses", href: "/features#time",
    body: "Timesheets and a running timer, approvals, and receipts that AI reads for you. Expense reports post straight to the ledger.",
  },
  {
    title: "Billing", href: "/features#invoicing",
    body: "Invoices from approved hours, estimates clients approve online, recurring invoices that charge the card on file, dunning and payment plans, in 33 currencies.",
  },
  {
    title: "Books", href: "/features#books",
    body: "A full general ledger on every plan, bank feeds, a multi-jurisdiction tax engine, multi-entity, and month-end and year-end close.",
  },
  {
    title: "Payouts", href: "/features#payouts",
    body: "What every employee, contractor and partner is owed, worked out from the same hours that billed the client. 1099s included.",
  },
  {
    title: "Reports", href: "/features#books",
    body: `${REPORT_COUNT} reports out of the box, a report builder, scheduled reports by email and a dashboard for each role.`,
  },
  {
    title: "Platform", href: "/integrations",
    body: "API and webhooks, audit log search, bulk edits, imports from eight platforms and Jira, and CherryAssist for how-to questions inside the app.",
  },
];

const WORKFLOW = [
  {
    kicker: "Support desk", title: "A client emails support. It becomes a case.", screen: SCREENS.caseDetail,
    body: "The email opens a case with an owner, a priority and an SLA clock. Your client sees its progress in their own portal.",
  },
  {
    kicker: "Time", title: "The hours go on the timesheet.", screen: SCREENS.time,
    body: "Time logged against the case shows up on the week, against the right client and project, ready for approval.",
  },
  {
    kicker: "Billing", title: "Approved time becomes the invoice.", screen: SCREENS.invoices,
    body: "One click turns approved hours into an invoice at each person’s rate. It goes out with a pay link and posts to the ledger.",
  },
  {
    kicker: "Payouts", title: "Everyone gets paid what they’re owed.", screen: SCREENS.payouts,
    body: "When the client pays, each person’s share is already worked out from the same hours. Nobody rebuilds it in a spreadsheet.",
  },
];

const PLANS = [
  { name: "Starter", price: PLAN_PRICING.STARTER.monthly, body: "Time, invoicing, expenses, payouts and the full general ledger." },
  { name: "Professional", price: PLAN_PRICING.PROFESSIONAL.monthly, body: "Adds the support desk, approvals, bank feeds, imports and the API." },
  { name: "Business", price: PLAN_PRICING.BUSINESS.monthly, body: "Adds Marketing Hub, period close, multi-entity and advanced reporting." },
];

const IMPORTS = [
  { label: "QuickBooks", slug: "quickbooks" },
  { label: "FreshBooks", slug: "freshbooks" },
  { label: "Xero", slug: "xero" },
  { label: "Wave", slug: "wave" },
  { label: "Harvest", slug: "harvest" },
  { label: "BigTime", slug: "bigtime" },
  { label: "Scoro", slug: "scoro" },
  { label: "Paymo", slug: "paymo" },
  { label: "Jira Service Management", slug: "jira-service-management" },
];

export default function HomePage() {
  return (
    <MarketingShell>
      <SEO path="/" />

      <PageHero>
        <Container>
          <Display size="hero" testId="home-h1">Everything a services business runs on.</Display>
          <Lede size="hero" className="mt-5 md:mt-6">
            Win clients, run the work, bill for it, keep the books and pay your team. One system instead of five, built inside a services firm that still runs on it every day.
          </Lede>
          <Ctas>
            <ButtonLink href="/signup" testId="hero-cta-signup">Start your trial</ButtonLink>
            <ButtonLink href="/demo" variant="secondary" testId="hero-cta-demo">Book a demo</ButtonLink>
          </Ctas>
          <Note>{TRIAL_NOTE}</Note>
          <Scene screen={SCREENS.supportCases} priority testId="hero-screenshot" className="mt-12 md:mt-14" />
          <p className="mt-7 text-[15px] text-[#6E727B]">
            Made for <span className="text-[#5C606A]">consulting firms, agencies, IT services, architects, law practices and engineering teams.</span>
          </p>
        </Container>
      </PageHero>

      <Section id="product" testId="section-areas">
        <Container>
          <Heading>One login for the front office and the back office.</Heading>
          <Lede className="mt-5">
            Most firms run a CRM, a help desk, a timesheet app, an invoicing tool and accounting software, then spend Friday copying numbers between them. Here it&rsquo;s one product and one set of numbers.
          </Lede>
          <Areas>
            {AREAS.map((a) => (
              <Area key={a.title} title={a.title} plan={a.plan} href={a.href} testId={`area-${a.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                {a.body}
              </Area>
            ))}
          </Areas>
        </Container>
      </Section>

      <Section testId="section-workflow">
        <Container>
          <Heading>Follow one request from the inbox to the payout.</Heading>
          <Flow>
            {WORKFLOW.map((step, i) => (
              <Row
                key={step.kicker}
                kicker={step.kicker}
                title={step.title}
                screen={step.screen}
                flip={i % 2 === 1}
                testId={`workflow-step-${i + 1}`}
              >
                <p>{step.body}</p>
              </Row>
            ))}
          </Flow>
        </Container>
      </Section>

      <Section testId="section-pricing">
        <Container>
          <Heading>Flat monthly price. Unlimited users.</Heading>
          <div className="mt-10 grid border-t border-[#E6E3DD] md:mt-16 md:grid-cols-3">
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={`py-6 md:pb-2 md:pr-8 md:pt-8 ${i > 0 ? "border-t border-[#E6E3DD] md:border-l md:border-t-0 md:pl-8" : ""}`}
                data-testid={`home-plan-${p.name.toLowerCase()}`}
              >
                <h3 className="text-[18px] font-medium text-[#15171C]">{p.name}</h3>
                <p className="mt-2.5 text-[44px] font-medium leading-none tracking-[-0.03em] text-[#15171C]">
                  ${p.price}<span className="text-[16px] font-normal tracking-normal text-[#6E727B]"> /month</span>
                </p>
                <p className="mt-3 text-[16px] text-[#5C606A]">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-7 text-[15px] text-[#5C606A]">
            Every plan includes every user you add. <TextLink href="/pricing" testId="link-home-pricing">Compare plans</TextLink>
          </p>
        </Container>
      </Section>

      <Section testId="section-imports">
        <Container>
          <Heading>Bring your history with you.</Heading>
          <p className="mt-7 max-w-[820px] text-[17px] leading-[1.7] text-[#5C606A] md:text-[19px]">
            Moving from{" "}
            {IMPORTS.map((imp, i) => (
              <Fragment key={imp.slug}>
                <TextLink href={`/switch-from-${imp.slug}`} testId={`link-import-${imp.slug}`}>{imp.label}</TextLink>
                {i < IMPORTS.length - 2 ? ", " : i === IMPORTS.length - 2 ? " or " : ""}
              </Fragment>
            ))}
            ? The import wizard brings over your clients, projects, invoices and cases.
          </p>
        </Container>
      </Section>

      <Closing
        heading="Run the whole business from one place."
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-free-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
