import { SEO } from "@/components/seo";
import {
  MarketingShell, Container, Section, PageHero, Eyebrow, Display, Heading, Lede, ButtonLink, TextLink,
} from "@/components/marketing/kit";
import { REPORT_COUNT } from "@shared/seo-routes";

const PILLARS = [
  {
    title: "One system, not five",
    body: `Time, invoices, payments, payouts, support cases and the books live in one place, so nothing has to be copied between tools at month end. ${REPORT_COUNT} reports read from the same records.`,
  },
  {
    title: "Flat pricing, every user included",
    body: "Plans are priced per firm, not per seat. Adding a contractor for one project doesn’t change your bill, and the price is on the pricing page before you sign up.",
  },
  {
    title: "Built by people who use it",
    body: "Our own firm runs on CherryWorks Pro every month: support cases, timesheets, invoices, client payments and contractor payouts. When something is awkward, we feel it first.",
  },
];

const MONTH = [
  {
    title: "Clients raise requests",
    body: "Requests arrive by email or through the Help Center and become cases. Hours are logged against the case as the work happens.",
  },
  {
    title: "Time is approved",
    body: "Timesheets are reviewed before anything is billed, so the invoice matches the work.",
  },
  {
    title: "Invoices go out from our own mailbox",
    body: "Invoices are built from approved hours and sent from our Microsoft 365 account. Clients pay by ACH or card.",
  },
  {
    title: "The team gets paid",
    body: "Every logged hour is valued at the person’s cost rate, so we know what we owe and to whom. Sending an invoice queues the contractors’ payouts for the hours on it, and each contractor can see whether their hours are unbilled, invoiced or paid.",
  },
];

export default function AboutPage() {
  return (
    <MarketingShell>
      <SEO path="/about" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Our story</Eyebrow>
            <Display testId="about-heading" className="mt-5">
              We didn’t study the problem. We lived it.
            </Display>
            <Lede className="mt-6 max-w-2xl">
              CherryWorks Pro started inside a working consulting firm. We built it because we needed it, and we still run
              our own business on it.
            </Lede>
          </div>
        </Container>
      </PageHero>

      <Section tone="white" testId="section-about-story">
        <Container>
          <div className="mx-auto max-w-[68ch] space-y-6 text-lg leading-relaxed text-[#3D4350]">
            <p>
              We’re a consulting firm first. We manage technology projects for clients in manufacturing, IT and operations,
              with a mix of 1099 contractors, W-2 employees and corp-to-corp partners working side by side.
            </p>
            <p>
              For years we used FreshBooks for invoicing and time tracking. It was fine for sending invoices. It didn’t help
              with the part that took the most time.
            </p>
            <p className="font-display text-2xl leading-snug text-[#15171C]">The breaking point was paying the team.</p>
            <p>
              Every month we matched invoices against time entries in a spreadsheet, worked out what we owed each person,
              sent the payments across three different rails, then updated another spreadsheet so we could file 1099s at
              year end. One mistake anywhere in that chain and the whole month had to be rechecked.
            </p>
            <p>
              We looked at the usual options. QuickBooks was more accounting than we needed day to day. Harvest handled time
              and invoices, but paying people meant another tool and another spreadsheet. Nothing followed the one workflow
              our firm runs every month:
            </p>
            <p className="border-l-2 border-[#CF3339] pl-5 font-display text-xl leading-snug text-[#15171C] md:text-2xl">
              Log time, invoice the client, collect the payment, pay the person who did the work.
            </p>
            <p>
              So we built it, first for ourselves. Support cases came next, because our clients email us when something
              breaks and those hours need to be billed too. Then we opened it up to other firms that work the way we do.
            </p>
          </div>
        </Container>
      </Section>

      <Section testId="section-about-pillars">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What we hold to</Eyebrow>
            <Heading testId="mission-heading" className="mt-4">Three things we won’t trade away</Heading>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
            {PILLARS.map((p, i) => (
              <div key={p.title} data-testid={`mission-pillar-${i}`} className="border-t border-[#15171C] pt-6">
                <p className="font-display text-sm font-semibold text-[#B32A30]">0{i + 1}</p>
                <h3 className="mt-3 text-xl font-semibold text-[#15171C]">{p.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#3D4350]">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-about-month">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Eyebrow>How we use it</Eyebrow>
              <Heading testId="timeline-heading" className="mt-4">A month at our own firm</Heading>
              <p className="mt-5 text-[17px] leading-relaxed text-[#3D4350]">
                This is the cycle CherryWorks Pro was built around, and the one we run ourselves.
              </p>
              <TextLink href="/tour" testId="link-about-tour" className="mt-6">See it in the product tour</TextLink>
            </div>
            <ol className="lg:col-span-7">
              {MONTH.map((m, i) => (
                <li
                  key={m.title}
                  data-testid={`timeline-milestone-${i}`}
                  className="grid grid-cols-[2.5rem_1fr] gap-4 border-t border-[#E6E2DA] py-6 first:border-t-0 first:pt-0"
                >
                  <span className="font-display text-lg font-semibold text-[#B32A30]">{i + 1}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-[#15171C]">{m.title}</h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D4350]">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      <Section testId="section-about-marketing-os" className="!py-16 md:!py-20">
        <Container>
          <div className="grid items-end gap-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <Heading as="h3" testId="about-marketing-os-heading" className="!text-2xl md:!text-3xl">
                Prospects stay separate from your books
              </Heading>
              <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-[#3D4350]">
                The Business plan adds Marketing Hub for campaigns and follow-up sequences. Prospects are kept apart from
                billing clients, so outreach never clutters your invoices or reports.
              </p>
            </div>
            <div className="md:col-span-4 md:text-right">
              <TextLink href="/marketing" testId="link-about-marketing-os">About Marketing Hub</TextLink>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-cta">
        <Container>
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-white text-balance md:text-5xl">
              Run your firm on the system we run ours on.
            </h2>
            <p className="mt-5 text-lg text-white/70">
              14-day trial on the Professional plan. You won’t be charged until day 15 · Cancel anytime.
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
