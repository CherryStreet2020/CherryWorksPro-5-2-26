import { useState } from "react";
import { Link } from "wouter";
import { BookOpen, Clock, LifeBuoy, Users, Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { REPORT_COUNT } from "@shared/seo-routes";
import {
  ButtonLink, Container, Display, Eyebrow, Fact, Heading, Lede, MarketingShell, PageHero, Screenshot, Section, TextLink,
} from "@/components/marketing/kit";

const SCREENS = "/marketing/screens";

const WORKFLOW = [
  {
    n: "01",
    title: "A client emails support. It becomes a case.",
    body: "Connect the Microsoft 365 mailbox your clients already write to. Every message opens or updates a case with a key, a priority, an owner and an SLA clock, so nothing sits unanswered in someone’s inbox.",
    img: { src: `${SCREENS}/support-cases.webp`, width: 1600, height: 1217, alt: "The Support Cases list: open cases for several clients with status, priority, assignee and SLA due times." },
    url: "app.cherryworkspro.com/support/cases",
  },
  {
    n: "02",
    title: "The hours go on the timesheet.",
    body: "Your team logs time against the case or the project, by timer or on the weekly timesheet. Support work and project work land in the same place, at the right rate for each client.",
    img: { src: `${SCREENS}/time.webp`, width: 1600, height: 1041, alt: "A weekly timesheet with hours logged per client and project, day by day." },
    url: "app.cherryworkspro.com/time",
  },
  {
    n: "03",
    title: "Approved time becomes the invoice.",
    body: "Generate the invoice from approved hours and send it from your own mailbox: Microsoft 365, Google or SMTP. Clients pay by card or ACH, and the payment posts to your ledger by itself.",
    img: { src: `${SCREENS}/invoices.webp`, width: 1600, height: 1136, alt: "The Invoices page: totals invoiced, outstanding and paid this month, and a list of sent and paid invoices." },
    url: "app.cherryworkspro.com/invoices",
  },
  {
    n: "04",
    title: "Everyone gets paid what they’re owed.",
    body: "Payouts are worked out from the hours each person logged at their rate, and team members can see which of their hours have been invoiced and paid. Pay contractors through Stripe Connect or record a payment you made elsewhere.",
    img: { src: `${SCREENS}/payouts.webp`, width: 1600, height: 852, alt: "The Payouts page: unpaid time value and the balance owed to each team member, with a Pay button per person." },
    url: "app.cherryworkspro.com/payouts",
  },
];

const PILLARS = [
  {
    icon: Clock, title: "Time & Billing", href: "/features",
    desc: "Track time, approve timesheets and turn approved hours into invoices.",
    points: ["Timer or weekly timesheet, rates per project", "Recurring and multi-currency invoices", "Card and ACH payments online"],
  },
  {
    icon: BookOpen, title: "Books", href: "/features",
    desc: "A real general ledger under everything. Invoices, payments, expenses and payouts post themselves.",
    points: ["Chart of accounts, journals, trial balance", "AR aging, cash flow and P&L", "Receipt scanning that posts the expense"],
  },
  {
    icon: Users, title: "Team & Payouts", href: "/features",
    desc: "Contractors, W-2 staff and corp-to-corp partners on one team, with no charge per person.",
    points: ["Unlimited users on every plan", "Payouts and reimbursements in one balance", "1099 records at year end"],
  },
  {
    icon: LifeBuoy, title: "Client Support", href: "/client-support",
    desc: "A support desk that knows your clients, their contracts and who pays the invoice.",
    points: ["Cases from email, the Help Center or your team", "SLA targets per client, business-hours aware", "Support time flows to the invoice"],
  },
];

const IMPORTS = [
  { label: "QuickBooks", href: "/switch-from-quickbooks" },
  { label: "FreshBooks", href: "/switch-from-freshbooks" },
  { label: "Harvest", href: "/switch-from-harvest" },
  { label: "Xero", href: "/switch-from-xero" },
  { label: "Wave", href: "/switch-from-wave" },
  { label: "BigTime", href: "/switch-from-bigtime" },
  { label: "Scoro", href: "/switch-from-scoro" },
  { label: "Paymo", href: "/switch-from-paymo" },
  { label: "Jira Service Management", href: "/switch-from-jira-service-management" },
];

const FAQS = [
  {
    q: "Who is CherryWorks Pro for?",
    a: "Consultancies, agencies, IT and managed service firms that bill clients for time, including support time, and pay a team of employees, contractors or both.",
  },
  {
    q: "How does the free trial work?",
    a: "You get 14 days of the Professional plan with everything switched on. We take a card at sign-up so your account carries on without interruption, but you won’t be charged until day 15, and you can cancel any time before then.",
  },
  {
    q: "Are users really unlimited?",
    a: "Yes, on every plan. Add 1099 contractors, W-2 staff and corp-to-corp partners without a per-person fee. Client contacts who use your Help Center are not users either.",
  },
  {
    q: "Can I bring my data from the tool I use now?",
    a: "Yes. Import wizards cover QuickBooks, FreshBooks, Harvest, Xero, Wave, BigTime, Scoro and Paymo, with a dry-run preview before anything is written. Support cases can be imported from Jira with their comments and attachments. Imports are on the Professional plan and up, which is what the trial runs on.",
  },
  {
    q: "Does it replace my accounting software?",
    a: "Every plan includes a full general ledger: chart of accounts, journal entries, trial balance and P&L, with invoices, payments, expenses and payouts posting automatically. Whether you also keep a separate accounting package is up to you and your accountant.",
  },
  {
    q: "How are team payouts worked out?",
    a: "From the hours each person logged at their cost rate. Every hour moves from unbilled to invoiced to paid, and team members can see where theirs stand. Contractors can be paid through Stripe Connect on the Professional plan and up; W-2 staff are paid through your payroll as usual.",
  },
];

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Lets a visitor price their own team: the per-user figure is theirs to type,
 * so the page never quotes a competitor's price that may have changed.
 */
function SeatCalculator() {
  const [team, setTeam] = useState(8);
  const [seat, setSeat] = useState("15");
  const flat = PLAN_PRICING.PROFESSIONAL.monthly;
  const perUser = Math.max(0, Number(seat) || 0);
  const perSeat = team * perUser;
  const saving = perSeat - flat;
  const breakEven = perUser > 0 ? Math.floor(flat / perUser) + 1 : null;

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-[#E6E2DA] bg-[#E6E2DA] md:grid-cols-2" data-testid="seat-calculator">
      <div className="bg-white p-6 md:p-8">
        <label htmlFor="calc-team" className="flex items-baseline justify-between text-sm font-semibold text-[#15171C]">
          People on your team
          <span className="font-display text-2xl" data-testid="calc-team-value">{team}</span>
        </label>
        <input
          id="calc-team"
          type="range"
          min={1}
          max={50}
          value={team}
          onChange={(e) => setTeam(Number(e.target.value))}
          className="mt-4 w-full accent-[#CF3339]"
          data-testid="input-calc-team"
        />
        <label htmlFor="calc-seat" className="mt-8 block text-sm font-semibold text-[#15171C]">
          What your current tool charges per user, per month
        </label>
        <div className="mt-2 flex h-12 items-center rounded-lg border border-[#D9D4CB] bg-white px-4 focus-within:border-[#15171C]">
          <span className="text-[#5F6672]">$</span>
          <input
            id="calc-seat"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            className="w-full bg-transparent pl-1 text-[15px] text-[#15171C] outline-none"
            data-testid="input-calc-seat"
          />
        </div>
        <p className="mt-3 text-sm text-[#5F6672]">Check your last invoice. Add-ons charged per user count too.</p>
      </div>

      <div className="flex flex-col justify-between bg-[#FBFAF7] p-6 md:p-8" data-testid="calc-result" aria-live="polite">
        <dl className="space-y-5">
          <div className="flex items-baseline justify-between gap-4 border-b border-[#E6E2DA] pb-5">
            <dt className="text-sm text-[#3D4350]">Per-user pricing</dt>
            <dd className="text-right">
              <span className="font-display text-3xl font-semibold text-[#15171C]">{money(perSeat)}</span>
              <span className="text-sm text-[#5F6672]"> /mo</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-[#3D4350]">
              CherryWorks Pro Professional
              <span className="block text-[13px] text-[#5F6672]">Unlimited users, clients and projects</span>
            </dt>
            <dd className="text-right">
              <span className="font-display text-3xl font-semibold text-[#15171C]">{money(flat)}</span>
              <span className="text-sm text-[#5F6672]"> /mo</span>
            </dd>
          </div>
        </dl>
        <p className="mt-8 text-[15px] leading-relaxed text-[#15171C]" data-testid="calc-verdict">
          {perUser === 0
            ? "Enter your per-user price to compare."
            : saving > 0
              ? <>You’d keep <strong>{money(saving)} a month</strong>, {money(saving * 12)} a year, and the gap grows with every hire.</>
              : <>At {team} {team === 1 ? "person" : "people"}, per-user pricing costs less. Flat pricing pulls ahead at {breakEven} people and stays flat after that.</>}
        </p>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <MarketingShell>
      <SEO path="/" />
      <FAQStructuredData faqs={FAQS} />

      <PageHero className="pb-0 md:pb-0">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>For consultancies, agencies and IT service firms</Eyebrow>
            <Display testId="home-h1" className="mt-5">
              <span className="block sm:inline">Client work in.</span>{" "}
              <span className="block sm:inline">Invoices out.</span>{" "}
              <span className="block">Your team paid.</span>
            </Display>
            <Lede className="mt-6 max-w-2xl">
              CherryWorks Pro runs the whole loop in one system. Client emails become support cases, the hours your team logs become invoices, and each person’s payout is worked out from the hours that were billed.
            </Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/signup" size="lg" arrow testId="hero-cta-signup">Start your 14-day trial</ButtonLink>
              <ButtonLink href="/tour" size="lg" variant="secondary" testId="hero-cta-tour">Take the product tour</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">
              Unlimited users on every plan · From {money(PLAN_PRICING.STARTER.monthly)}/mo flat ·{" "}
              <Link href="/demo" className="whitespace-nowrap font-medium text-[#15171C] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]" data-testid="hero-cta-demo">
                or book a demo
              </Link>
            </p>
          </div>
        </Container>
        <div className="relative mt-14 md:mt-16">
          <div className="absolute inset-x-0 bottom-0 top-1/2 border-t border-[#E6E2DA] bg-white" aria-hidden="true" />
          <Container className="relative">
            <Screenshot
              src={`${SCREENS}/case-detail.webp`}
              width={2000}
              height={1521}
              priority
              fade
              url="app.cherryworkspro.com/support/cases/BL-1"
              alt="A support case in CherryWorks Pro: the client's report, a reply and an internal note, and the hours logged on the case with how many are billed."
              testId="hero-screenshot"
            />
          </Container>
        </div>
      </PageHero>

      <section className="bg-white pb-20 pt-14 md:pb-24 md:pt-16" data-testid="section-origin">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-display text-2xl leading-snug text-[#15171C] md:text-[1.9rem]">
              We built CherryWorks Pro to run our own consulting firm. We bill our clients, work their support cases and pay our contractors with it every month.
            </p>
            <TextLink href="/about" className="mt-6" testId="link-home-about">Why we built it</TextLink>
          </div>
        </Container>
      </section>

      <Section testId="section-workflow">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <Heading className="mt-4">One record, from the first email to the last payout</Heading>
            <Lede className="mt-5">
              Most firms stitch this together from a help desk, a timesheet app, an invoicing tool and a spreadsheet for paying people. Here it’s the same record the whole way through, so nobody re-types anything.
            </Lede>
          </div>
          <ol className="mt-16 space-y-20 md:mt-20 md:space-y-28">
            {WORKFLOW.map((step, i) => (
              <li key={step.n} className="grid items-center gap-8 md:grid-cols-12 md:gap-12" data-testid={`workflow-step-${i + 1}`}>
                <div className={`md:col-span-5 ${i % 2 === 1 ? "md:order-2" : ""}`}>
                  <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">{step.n}</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-[1.75rem]">{step.title}</h3>
                  <p className="mt-4 text-[17px] leading-relaxed text-[#3D4350]">{step.body}</p>
                </div>
                <div className={`md:col-span-7 ${i % 2 === 1 ? "md:order-1" : ""}`}>
                  <Screenshot {...step.img} url={step.url} />
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section tone="white" testId="section-pillars">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What’s inside</Eyebrow>
            <Heading className="mt-4">Four things every services firm runs on</Heading>
            <Lede className="mt-5">Most tools do one of these and hand you a CSV for the rest. CherryWorks Pro does all four on the same records.</Lede>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[#E6E2DA] bg-[#E6E2DA] sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group flex flex-col bg-white p-7 transition-colors hover:bg-[#FBFAF7]"
                data-testid={`pillar-${p.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              >
                <p.icon className="h-5 w-5 text-[#CF3339]" aria-hidden="true" />
                <h3 className="mt-5 text-lg font-semibold text-[#15171C]">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{p.desc}</p>
                <ul className="mt-5 space-y-2 border-t border-[#ECE8E1] pt-5">
                  {p.points.map((pt) => (
                    <li key={pt} className="text-sm leading-snug text-[#5F6672]">{pt}</li>
                  ))}
                </ul>
                <span className="mt-auto pt-6 text-sm font-semibold text-[#15171C] underline decoration-[#CF3339]/40 underline-offset-4 group-hover:decoration-[#CF3339]">
                  Learn more
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-[#E6E2DA] pt-12 md:grid-cols-4" data-testid="section-proof">
            <Fact value="Unlimited" label="users on every plan" />
            <Fact value={String(REPORT_COUNT)} label="built-in reports" />
            <Fact value="8" label="platforms you can import from" />
            <Fact value="Full GL" label="general ledger on every plan" />
          </div>
        </Container>
      </Section>

      <Section testId="section-support">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Eyebrow>Client Support</Eyebrow>
              <Heading className="mt-4">The help desk that knows who pays the invoice</Heading>
              <Lede className="mt-5">
                Jira Service Management, Zendesk and Freshdesk were built for support departments. Your firm bills for support. Here a case is client work with a clock, a contract and an invoice attached.
              </Lede>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/client-support" variant="secondary" arrow testId="link-home-client-support">See Client Support</ButtonLink>
              </div>
              <p className="mt-5 text-sm text-[#5F6672]">
                Leaving Jira?{" "}
                <Link href="/switch-from-jira-service-management" className="font-medium text-[#15171C] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]" data-testid="link-home-jira">
                  Import your project with its history
                </Link>
              </p>
            </div>
            <dl className="grid content-start gap-x-10 gap-y-8 sm:grid-cols-2 lg:col-span-7 lg:pt-2">
              {[
                { t: "No passwords for your clients", d: "Approve a client’s email domain and anyone there signs in to your Help Center with a one-time link." },
                { t: "Customer admins", d: "A lead at each client can see every case their company has open, not just their own." },
                { t: "SLAs that respect business hours", d: "First-response and resolution targets per client, with the clock paused outside working hours." },
                { t: "Bring your Jira history", d: "Issues come across with their comments, attachments and original keys, closed cases included." },
              ].map((f) => (
                <div key={f.t} className="border-t border-[#E6E2DA] pt-5">
                  <dt className="font-semibold text-[#15171C]">{f.t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{f.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-pricing-calc">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-4">
              <Eyebrow>Flat pricing</Eyebrow>
              <Heading className="mt-4">Stop paying more every time you hire</Heading>
              <Lede className="mt-5">
                Per-user pricing charges you for growing. Ours doesn’t change when your team does. Starter is {money(PLAN_PRICING.STARTER.monthly)}/mo for up to 5 clients; Professional removes the limits.
              </Lede>
              <TextLink href="/pricing" className="mt-7" testId="link-home-pricing">See every plan</TextLink>
            </div>
            <div className="lg:col-span-8">
              <SeatCalculator />
            </div>
          </div>
        </Container>
      </Section>

      <Section testId="section-imports" className="md:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-5">
              <Eyebrow>Switching</Eyebrow>
              <Heading className="mt-4">Bring your history with you</Heading>
              <Lede className="mt-5">Clients, projects, time and invoices come across from the tool you use today. Preview the import before anything is written.</Lede>
            </div>
            <ul className="flex flex-wrap gap-2.5 lg:col-span-7">
              {IMPORTS.map((imp) => (
                <li key={imp.href}>
                  <Link
                    href={imp.href}
                    className="inline-flex h-10 items-center rounded-full border border-[#D9D4CB] bg-white px-4 text-sm font-medium text-[#15171C] transition-colors hover:border-[#15171C]"
                    data-testid={`link-import-${imp.href.replace("/switch-from-", "")}`}
                  >
                    {imp.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-faq">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Heading>Questions firms ask us</Heading>
              <p className="mt-5 text-[15px] leading-relaxed text-[#3D4350]">
                Something else? <Link href="/contact" className="font-medium text-[#15171C] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]">Ask us directly</Link>. A person who uses the product every day will answer.
              </p>
            </div>
            <div className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
              {FAQS.map((f, i) => (
                <details key={f.q} className="group py-5" data-testid={`faq-${i}`}>
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold text-[#15171C] [&::-webkit-details-marker]:hidden">
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
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.015em] text-white md:text-5xl">Try it on your own work</h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Fourteen days with everything on. Import your clients, projects and time, send a real invoice, and see what your team is owed.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-free-trial">Start your 14-day trial</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight" testId="cta-book-demo">Book a demo</ButtonLink>
            </div>
            <p className="mt-6 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime · Your data exports with you</p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
