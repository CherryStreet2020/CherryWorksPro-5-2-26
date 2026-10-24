import { Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import { SCREENS } from "@/components/marketing/screens";
import {
  ButtonLink, Closing, Container, Ctas, Display, Eyebrow, Flow, Heading, Lede, MarketingShell, Note, PageHero, Row,
  Scene, Section, TextLink, TRIAL_NOTE,
} from "@/components/marketing/kit";

const FLOW = [
  {
    title: "A client emails you, and it’s a case.",
    screen: SCREENS.caseDetail,
    body: [
      "Email from a client’s contacts to your support address becomes a case with a key like ABS-158. They can also open one in your Help Center.",
      "Replies go to the client by email and show in the Help Center. Internal notes stay internal, and every status, priority and assignee change is on the timeline.",
    ],
  },
  {
    title: "The hours go on the invoice.",
    screen: SCREENS.invoices,
    body: [
      "Time on a case is an ordinary time entry for that client and project, so it goes through the same approval as project work and lands on the client’s next invoice.",
    ],
  },
  {
    title: "And the person who did the work is paid.",
    screen: SCREENS.payouts,
    body: [
      "Case hours count toward the payout of whoever logged them, the same as any other billable time.",
    ],
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
    d: "Invoices and payments live in a separate client portal that only the client’s billing contacts can open, so a support requester never sees what you charge.",
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
    q: "Which plans include the support desk?",
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

      <PageHero>
        <Container>
          <Eyebrow>
            Support desk <span className="font-normal text-[#6E727B]">· Professional and up</span>
          </Eyebrow>
          <Display testId="client-support-h1" className="mt-4">A support desk that bills.</Display>
          <Lede size="hero" className="mt-6">
            Cases, SLAs, a Help Center with no passwords and email-to-case, in the same system that tracks the time, sends the invoice and pays your team.
          </Lede>
          <Ctas>
            <ButtonLink href="/signup" testId="client-support-cta-signup">Start your trial</ButtonLink>
            <ButtonLink href="/demo" variant="secondary" testId="client-support-cta-demo">Book a demo</ButtonLink>
          </Ctas>
          <Note>{TRIAL_NOTE}</Note>
          <Scene screen={SCREENS.supportCases} priority className="mt-14 md:mt-20" testId="client-support-hero-screen" />
        </Container>
      </PageHero>

      <Section testId="section-flow">
        <Container>
          <Heading>From the first email to the invoice.</Heading>
          <Lede className="mt-5">
            A help desk stops at the ticket. Here the case, the hours, the invoice and the payout are one record.
          </Lede>
          <Flow>
            {FLOW.map((s, i) => (
              <Row key={s.title} title={s.title} screen={s.screen} flip={i % 2 === 1} testId={`flow-step-${i}`}>
                {s.body.map((p) => <p key={p}>{p}</p>)}
              </Row>
            ))}
          </Flow>
        </Container>
      </Section>

      <Section testId="section-capabilities">
        <Container>
          <Heading>Everything a client asks for, on the record that already knows them.</Heading>
          <dl className="mt-10 grid gap-x-10 sm:grid-cols-2 md:mt-16 lg:grid-cols-3 lg:gap-x-[72px]">
            {CAPABILITIES.map((c) => (
              <div key={c.t} className="border-t border-[#E6E3DD] pb-8 pt-5">
                <dt className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">{c.t}</dt>
                <dd className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{c.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section testId="section-contrast">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Heading>Help desks were built for support departments.</Heading>
              <Lede className="mt-5">Your firm bills for support. That changes what the tool has to know.</Lede>
              <p className="mt-6 text-[15px]">
                <TextLink href="/switch-from-jira-service-management" testId="link-client-support-jira">
                  Moving from Jira Service Management
                </TextLink>
              </p>
            </div>
            <dl className="border-t border-[#E6E3DD] lg:mt-2">
              {CONTRAST.map((c) => (
                <div key={c.t} className="grid gap-2 border-b border-[#E6E3DD] py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="text-[17px] font-medium text-[#15171C]">{c.t}</dt>
                  <dd className="text-[15.5px] leading-[1.55] text-[#5C606A]">{c.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section testId="section-faq">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Heading>Questions about the support desk</Heading>
            </div>
            <div className="border-t border-[#E6E3DD] lg:col-span-8">
              {faqs.map((f, i) => (
                <details key={f.q} className="group border-b border-[#E6E3DD] py-5" data-testid={`faq-item-${i}`}>
                  <summary
                    data-testid={`button-faq-${i}`}
                    className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium text-[#15171C] [&::-webkit-details-marker]:hidden"
                  >
                    {f.q}
                    <Plus className="h-5 w-5 shrink-0 text-[#5C606A] transition-transform group-open:rotate-45" aria-hidden="true" />
                  </summary>
                  <p className="mt-2 max-w-2xl text-[16px] leading-[1.6] text-[#5C606A]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Closing
        heading="See a case go from email to invoice."
        body={<>Or <TextLink href="/tour" testId="link-client-support-tour">take the product tour</TextLink> first.</>}
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
