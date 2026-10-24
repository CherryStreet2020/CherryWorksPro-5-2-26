import { Link } from "wouter";
import { Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import {
  ButtonLink, Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Screenshot, Section, TextLink,
} from "@/components/marketing/kit";

const SCREENS = "/marketing/screens";

const FLOW = [
  {
    title: "A client emails you or opens a case",
    body: "Email from a client’s contacts to your support address becomes a case with a key like ABS-158. They can also open one in your Help Center.",
  },
  {
    title: "Your team works it",
    body: "Replies go to the client by email and show in the Help Center. Internal notes stay internal. Every status, priority and assignee change is on the case timeline.",
  },
  {
    title: "The hours are logged on the case",
    body: "Time on a case is an ordinary time entry for that client and project, so it goes through the same timesheet approval as project work.",
  },
  {
    title: "The client is billed and the person is paid",
    body: "Case hours go on the client’s next invoice with the rest of their time, and count toward the payout of the person who did the work.",
  },
];

const CAPABILITIES = [
  {
    t: "Email becomes a case",
    d: "Connect the Microsoft 365 mailbox behind your support address. Mail from a verified client contact opens a case, and replies that carry the case key thread onto it, attachments included. Unknown senders never open cases.",
  },
  {
    t: "A Help Center with no passwords",
    d: "Approve a client’s business email domain and anyone there signs in with a one-time link. They open cases, reply, attach files and add colleagues as watchers, under your firm’s name and logo.",
  },
  {
    t: "Customer Admins",
    d: "A lead at each client sees every case their company has open, sets priority, closes and reopens cases, and invites colleagues.",
  },
  {
    t: "SLAs per client",
    d: "Set first-response and resolution targets for the firm, then override them for any client. Clocks count business hours in your timezone and pause while you’re waiting on the client.",
  },
  {
    t: "Alerts before a target is missed",
    d: "The assignee is told shortly before a target and again if it’s missed. Unassigned cases alert your managers instead.",
  },
  {
    t: "Billing kept separate",
    d: "Invoices and payments live in a separate Customer Portal that only the client’s billing contacts can open, so a support requester never sees what you charge.",
  },
];

const CONTRAST = [
  { t: "Priced per agent", d: "Help desk products charge for each person who answers cases. Every plan here includes unlimited users." },
  { t: "No idea what the client pays", d: "A ticket in a help desk has no rate, no contract and no invoice. Here a case belongs to the client and project you bill." },
  { t: "Someone else’s brand in front of your client", d: "The Help Center and every case email carry your firm’s name and logo, because the client is hiring you, not a help desk vendor." },
  { t: "Reports stop at the ticket", d: "Case hours feed the same utilization, profitability and payout reports as the rest of your work." },
];

const faqs = [
  {
    q: "Do my clients need an account?",
    a: "No. Approve the client’s business email domain and anyone at the company can sign in to the Help Center with a one-time link sent to their inbox. There’s no password to reset and no user list to maintain. Shared domains like gmail.com can’t be approved.",
  },
  {
    q: "Which plans include Client Support?",
    a: "Support cases, the Help Center, SLAs and email-to-case are on the Professional and Business plans, not on Starter. The 14-day trial runs on Professional, so you can try all of it. Client contacts and Customer Admins don’t count as users.",
  },
  {
    q: "Can I keep my existing support email address?",
    a: "Yes, if it’s a Microsoft 365 mailbox. Connect it and set it as the support address, and CherryWorks Pro creates or updates cases from the mail your clients send to it. Google and SMTP mailboxes can send invoices and replies, but they can’t receive cases.",
  },
  {
    q: "How does support time reach the invoice?",
    a: "Time logged on a case is a normal time entry for the client and project. It goes through the same approval and invoicing as project time, and it counts toward the payout of the person who logged it.",
  },
  {
    q: "What comes across from Jira?",
    a: "From Jira Cloud: issues with their summary, description, status, priority, reporter, comments and attachments, closed issues included. Cases keep their original keys and new cases carry on the numbering.",
  },
];

export default function ClientSupportPage() {
  return (
    <MarketingShell>
      <SEO path="/client-support" />
      <FAQStructuredData faqs={faqs} />

      <PageHero className="pb-0 md:pb-0">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Client Support</Eyebrow>
            <Display testId="client-support-h1" className="mt-5">A support desk that bills.</Display>
            <Lede className="mt-6 max-w-2xl">
              Cases, SLAs, a Help Center with no passwords and email-to-case, in the same system that tracks the time,
              sends the invoice and pays your team. Not a separate tool with its own login and its own bill.
            </Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/signup" size="lg" arrow testId="client-support-cta-signup">Start your 14-day trial</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="secondary" testId="client-support-cta-demo">Book a demo</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">On the Professional and Business plans · <span className="whitespace-nowrap">Unlimited users</span></p>
          </div>
        </Container>
        <div className="relative mt-14 md:mt-16">
          <div className="absolute inset-x-0 bottom-0 top-1/2 border-t border-[#E6E2DA] bg-white" aria-hidden="true" />
          <Container className="relative">
            <Screenshot
              src={`${SCREENS}/support-cases.webp`}
              width={1600}
              height={1217}
              priority
              fade
              url="cherryworkspro.com/support/cases"
              alt="The Support Cases list: open cases for several clients with keys, status, priority, assignee and SLA due times."
            />
          </Container>
        </div>
      </PageHero>

      <section className="bg-white pb-20 pt-14 md:pb-28 md:pt-16" data-testid="section-flow">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Eyebrow>How a case moves</Eyebrow>
              <Heading className="mt-4">From the first email to the invoice</Heading>
              <ol className="mt-10">
                {FLOW.map((s, i) => (
                  <li
                    key={s.title}
                    data-testid={`flow-step-${i}`}
                    className="grid grid-cols-[2.25rem_1fr] gap-3 border-t border-[#E6E2DA] py-6 first:border-t-0 first:pt-0"
                  >
                    <span className="font-display text-lg font-semibold text-[#B32A30]">{i + 1}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-[#15171C]">{s.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D4350]">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lg:col-span-7 lg:pt-2">
              <Screenshot
                src={`${SCREENS}/case-detail.webp`}
                width={2000}
                height={1521}
                url="cherryworkspro.com/support/cases/BL-1"
                alt="One support case: the client's report, a reply and an internal note, and the hours logged on the case with how many are billable, unbilled and invoiced."
              />
            </div>
          </div>
        </Container>
      </section>

      <Section testId="section-capabilities">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What’s included</Eyebrow>
            <Heading className="mt-4">Everything a client asks for, on the record that already knows them</Heading>
          </div>
          <dl className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.t} className="border-t border-[#15171C] pt-5">
                <dt className="text-lg font-semibold text-[#15171C]">{c.t}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{c.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section tone="white" testId="section-contrast">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <Eyebrow>Why not a help desk product</Eyebrow>
              <Heading className="mt-4">Help desks were built for support departments</Heading>
              <p className="mt-5 text-[17px] leading-relaxed text-[#3D4350]">
                Your firm bills for support. That changes what the tool has to know.
              </p>
              <TextLink href="/switch-from-jira-service-management" testId="link-client-support-jira" className="mt-6">
                Moving from Jira Service Management
              </TextLink>
            </div>
            <dl className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
              {CONTRAST.map((c) => (
                <div key={c.t} className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="font-semibold text-[#15171C]">{c.t}</dt>
                  <dd className="text-[15px] leading-relaxed text-[#3D4350]">{c.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section testId="section-faq">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <Eyebrow>Questions</Eyebrow>
              <Heading className="mt-4">What firms ask about Client Support</Heading>
            </div>
            <div className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
              {faqs.map((f, i) => (
                <details key={f.q} className="group py-5" data-testid={`faq-item-${i}`}>
                  <summary
                    data-testid={`button-faq-${i}`}
                    className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold text-[#15171C] [&::-webkit-details-marker]:hidden"
                  >
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
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-white text-balance md:text-5xl">
              See a case go from email to invoice.
            </h2>
            <p className="mt-5 text-lg text-white/70">
              14-day trial on the Professional plan, Client Support included. You won’t be charged until day 15 · Cancel anytime.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">Start free trial</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight" testId="cta-book-demo">Book a demo</ButtonLink>
            </div>
            <p className="mt-6 text-sm text-white/60">
              Or{" "}
              <Link href="/tour" className="font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white" data-testid="link-client-support-tour">
                take the product tour
              </Link>{" "}
              first.
            </p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
