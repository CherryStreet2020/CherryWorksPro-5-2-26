import { SEO } from "@/components/seo";
import { SCREENS } from "@/components/marketing/screens";
import {
  Closing, Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Scene, Section, TextLink,
} from "@/components/marketing/kit";
import { REPORT_COUNT } from "@shared/seo-routes";

const PILLARS = [
  {
    title: "One system, not five",
    body: `Leads, support cases, time, invoices, payments, payouts and the books live in one place, so nothing is copied between tools at month end. ${REPORT_COUNT} reports read from the same records.`,
  },
  {
    title: "Flat pricing, every user included",
    body: "Plans are priced per firm, not per seat. Adding a contractor for one project doesn’t change your bill, and every price is on the pricing page before you sign up.",
  },
  {
    title: "Built by people who use it",
    body: "Our own firm runs on CherryWorks Pro every month: support cases, timesheets, invoices, client payments and contractor payouts. When something is awkward, we feel it first.",
  },
];

const MONTH = [
  {
    title: "Clients raise requests",
    body: "Requests arrive by email or through our Help Center and become cases. Hours are logged against the case as the work happens.",
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
    title: "The team is paid",
    body: "Every logged hour is valued at the person’s cost rate, so we know what we owe and to whom, and each contractor can see whether their hours are unbilled, invoiced or paid.",
  },
];

export default function AboutPage() {
  return (
    <MarketingShell>
      <SEO path="/about" />

      <PageHero>
        <Container>
          <Eyebrow>About us</Eyebrow>
          <Display testId="about-heading" className="mt-4">
            We didn’t study the problem. We lived it.
          </Display>
          <Lede size="hero" className="mt-6">
            CherryWorks Pro started inside a working consulting firm. We built it because we needed it, and we still run our own business on it.
          </Lede>
        </Container>
      </PageHero>

      <Section testId="section-about-story">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[4fr_8fr] lg:gap-[72px]">
            <Heading>How it started.</Heading>
            <div className="max-w-[64ch] space-y-5 text-[17px] leading-[1.65] text-[#5C606A]">
              <p>
                We manage technology projects for clients in manufacturing, IT and operations, with 1099 contractors, W-2 employees and corp-to-corp partners working side by side.
              </p>
              <p>
                For years we used FreshBooks for invoicing and time tracking. It was fine for sending invoices. It didn’t help with the part that took the most time, which was paying the team.
              </p>
              <p>
                Every month we matched invoices against time entries in a spreadsheet, worked out what we owed each person, sent the payments across three different rails, then updated another spreadsheet so we could file 1099s at year end. One mistake anywhere in that chain and the whole month had to be rechecked.
              </p>
              <p>
                QuickBooks was more accounting than we needed day to day. Harvest handled time and invoices, but paying people meant another tool and another spreadsheet. Nothing followed the cycle our firm runs every month: log the time, invoice the client, collect the payment, pay the person who did the work.
              </p>
              <p className="text-[#15171C]">
                So we built it, first for ourselves. Support cases came next, because our clients email us when something breaks and those hours need to be billed too. Then a general ledger, so the books close themselves, and Marketing Hub, so the next client is found in the same system.
              </p>
              <p>
                Today CherryWorks Pro runs agencies, IT services firms, architects, law practices and engineering teams, as well as consulting firms like ours.
              </p>
            </div>
          </div>
          <Scene screen={SCREENS.payouts} className="mt-16 md:mt-24" testId="about-payouts-screen" />
          <p className="mt-5 max-w-[620px] text-[14px] leading-relaxed text-[#6E727B]">
            Payouts: what each person is owed for the hours they logged, at their own cost rate. This was the spreadsheet we replaced first.
          </p>
        </Container>
      </Section>

      <Section testId="section-about-pillars">
        <Container>
          <Heading testId="mission-heading">Three things we won’t trade away.</Heading>
          <div className="mt-10 grid gap-x-10 md:mt-16 md:grid-cols-3 md:gap-x-[72px]">
            {PILLARS.map((p, i) => (
              <div key={p.title} data-testid={`mission-pillar-${i}`} className="border-t border-[#E6E3DD] pb-8 pt-5">
                <h3 className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">{p.title}</h3>
                <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section testId="section-about-month">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Heading testId="timeline-heading">A month at our own firm.</Heading>
              <Lede className="mt-5">This is the cycle CherryWorks Pro was built around, and the one we still run.</Lede>
              <p className="mt-6 text-[15px]">
                <TextLink href="/tour" testId="link-about-tour">See it in the product tour</TextLink>
              </p>
            </div>
            <ol className="border-t border-[#E6E3DD] lg:mt-2">
              {MONTH.map((m, i) => (
                <li
                  key={m.title}
                  data-testid={`timeline-milestone-${i}`}
                  className="grid gap-2 border-b border-[#E6E3DD] py-6 sm:grid-cols-[14rem_1fr] sm:gap-8"
                >
                  <h3 className="text-[17px] font-medium text-[#15171C]">{m.title}</h3>
                  <p className="text-[15.5px] leading-[1.55] text-[#5C606A]">{m.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      <Section testId="section-about-marketing-os">
        <Container>
          <div className="flex flex-col gap-6 border-t border-[#E6E3DD] pt-10 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Heading as="h3" testId="about-marketing-os-heading">Prospects stay separate from your books.</Heading>
              <p className="mt-4 text-[17px] leading-[1.6] text-[#5C606A]">
                The Business plan adds Marketing Hub for contacts, campaigns and follow-up sequences. Prospects are kept apart from the clients you bill until they sign, so outreach never clutters your invoices or reports.
              </p>
            </div>
            <p className="text-[15px]">
              <TextLink href="/marketing" testId="link-about-marketing-os">About Marketing Hub</TextLink>
            </p>
          </div>
        </Container>
      </Section>

      <Closing
        heading="Run your business on the system we run ours on."
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
