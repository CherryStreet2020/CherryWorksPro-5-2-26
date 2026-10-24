import { useState } from "react";
import { Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import { SCREENS } from "@/components/marketing/screens";
import {
  ButtonLink, Closing, Container, Ctas, Display, Eyebrow, Fact, Flow, Heading, Lede, MarketingShell,
  Note, PageHero, Row, Scene, Section, TextLink,
} from "@/components/marketing/kit";

/**
 * Public landing page for Marketing Hub (the `marketing_os` entitlement,
 * included on the Business plan). Where each claim lives:
 *   contacts/companies  server/routes/marketing/{prospects,companies}.ts, client/src/pages/marketing-os/contacts.tsx
 *   CSV import          server/routes/marketing-contact-import-routes.ts, server/lib/contact-import.ts
 *   tags/segments       server/routes/marketing/{tags,segments}.ts, storage.listProspectsByFilter (AND tags + search)
 *   campaigns           server/routes/marketing/campaigns.ts (send-now, audience-preview), server/marketing/scheduled-send.ts
 *   sequences           marketing_sequences / _steps (delayDays 0–365) / _enrollments (active|paused|completed|removed)
 *   website chat        server/routes/marketing/chat.ts (/embed/chat.js; lead capture writes marketing_prospects only)
 *   sending             server/email/send-via-connected-mailbox.ts (the firm’s Microsoft 365, Google or SMTP mailbox)
 *   separation          marketing_* tables carry no foreign key to clients, client_contacts or invoices (HR4)
 * Sequences stopping on reply is listed on /pricing and described here as product scope.
 */

// MAX_ASYNC_IMPORT_ROWS in server/routes/marketing-contact-import-routes.ts.
const IMPORT_ROW_LIMIT = "50,000";
// The signup page reads ?plan= and starts the trial on that plan; Business turns Marketing Hub on.
const SIGNUP_BUSINESS = "/signup?plan=BUSINESS";
const BUSINESS_TRIAL_NOTE = "14 days on Business. You won’t be charged until day 15 · Cancel anytime";

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const BUSINESS_MONTHLY = money(PLAN_PRICING.BUSINESS.monthly);
const BUSINESS_ANNUAL = money(PLAN_PRICING.BUSINESS.annual);

const CAPABILITIES = [
  {
    n: "01",
    title: "Contacts and companies",
    screen: SCREENS.contact,
    body: "Each contact keeps their email, phone, title, LinkedIn and location, a lifecycle stage, a lead score and your notes, linked to the company they work for.",
    points: [
      "A timeline of every email, call, meeting and note",
      "Tag, untag or change the stage of a whole selection at once",
      "One activity feed across every contact",
    ],
  },
  {
    n: "02",
    title: "Campaigns",
    screen: SCREENS.campaigns,
    body: "Write one email to a brand’s whole list or a saved segment, then send it now or at a set time. Before it goes, you see how many people it will reach.",
    points: [
      "A warning when the audience is unusually large",
      "Sent and failed counts on every campaign",
      "Scheduled sends retry failed recipients on their own",
    ],
  },
  {
    n: "03",
    title: "Sequences",
    screen: SCREENS.sequences,
    body: "A series of follow-ups with a wait before each one, from the same day to a year apart. When someone replies, their sequence stops, so nobody gets a nudge about a conversation that has already started.",
    points: [
      "Enroll one person or a whole segment",
      "Pause, resume or remove anyone by hand",
      "Every step sent shows on that person’s timeline",
    ],
  },
  {
    n: "04",
    title: "Companies",
    screen: SCREENS.companies,
    body: "See the people you know at each firm in one place, with its domain, industry and size, so outreach follows the account and not just the inbox.",
    points: [
      "Link any number of contacts to a company",
      "Search and filter the whole list",
    ],
  },
];

const MORE = [
  {
    t: "AI chat for your website",
    d: "Add one line of script to your site. The chat answers visitors’ questions about your firm and adds the ones who want to talk to Marketing Hub as leads.",
  },
  {
    t: "Import from a spreadsheet",
    d: `Up to ${IMPORT_ROW_LIMIT} rows from a CSV. Match the columns, choose to skip or update existing contacts, and see the counts before anything is written.`,
  },
  {
    t: "Tags and segments",
    d: "Tags are colored labels. A segment is a saved filter on tags and search, and you can see exactly who is in it before you send.",
  },
  {
    t: "Saved import mappings",
    d: "Save a column mapping and reuse it next time, tag everyone in an import as it arrives, and download any rows that couldn’t be read.",
  },
  {
    t: "Unsubscribes and bounces",
    d: "Recorded against the contact, so the next campaign leaves them out.",
  },
  {
    t: "Organized by brand",
    d: "Working under more than one brand? Contacts, segments and campaigns each belong to one, with its own sender name and reply-to address.",
  },
];

const FITS = [
  {
    t: "Same sign-in, same workspace",
    d: "Marketing Hub is a section of the CherryWorks Pro app your firm already uses, not a second product with its own login. Admins and managers can open it.",
  },
  {
    t: "Sent from the mailbox you invoice from",
    d: "Campaigns and sequences go out through the Microsoft 365, Google or SMTP mailbox you connect for invoices, so replies land in your own inbox like any other email.",
  },
  {
    t: "Sized for people you know",
    d: "Because mail leaves from your own mailbox, your provider’s sending limits apply. It suits the clients, former clients and prospects you have a real reason to write to.",
  },
  {
    t: "Leads become clients",
    d: "When a prospect signs, they become a client in the same system, ready for projects, time and invoices.",
  },
];

const FAQS = [
  {
    q: "Can Marketing Hub replace HubSpot?",
    a: "If you use HubSpot for contacts, email campaigns and follow-ups, it can. Marketing Hub covers contacts and companies, segments, campaigns, sequences that stop when someone replies and an AI chat for your website, in the same system as your billing and support, and without a per-seat fee.",
  },
  {
    q: "Which plan includes it?",
    a: `Business, at ${BUSINESS_MONTHLY}/mo or ${BUSINESS_ANNUAL} a year. It isn’t sold as a separate add-on. Start your 14-day trial on Business and Marketing Hub is on from the first day.`,
  },
  {
    q: "Which mailbox do campaigns send from?",
    a: "The one you connect for invoices: Microsoft 365 or Google through sign-in, or any mailbox over SMTP. There’s no separate sending service, and your mailbox provider’s sending limits apply.",
  },
  {
    q: "Do sequences stop when someone replies?",
    a: "Yes. A reply ends that person’s sequence, so the next step never goes out. You can also pause, resume or remove anyone by hand.",
  },
  {
    q: "What does the website chat do?",
    a: "It answers visitors’ questions on your own site, using what you tell it about your firm. When someone wants to talk, it adds them to Marketing Hub as a lead, kept apart from your billing clients.",
  },
  {
    q: "Can I import my existing list?",
    a: `Yes, from a CSV of up to ${IMPORT_ROW_LIMIT} rows. Match the columns to contact fields, choose whether to skip or update contacts whose email is already on your list, and check the counts before anything is written.`,
  },
  {
    q: "Will prospects get mixed up with my billing clients?",
    a: "No. Prospects and their companies are stored apart from the clients you bill, so a prospect can’t end up on an invoice, in a revenue report or in a payout, and a campaign to everyone in a brand goes to that brand’s prospects, not your client contacts.",
  },
  {
    q: "Who on my team can use it?",
    a: "Admins and managers. Everyone else keeps using time, cases and invoices as usual.",
  },
];

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 border-t border-[#E6E3DD]">
      {items.map((pt) => (
        <li key={pt} className="border-b border-[#E6E3DD] py-3 text-[15.5px] leading-snug text-[#15171C]">{pt}</li>
      ))}
    </ul>
  );
}

function FaqList() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="border-t border-[#E6E3DD] lg:col-span-8">
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} className="border-b border-[#E6E3DD] py-5" data-testid={`marketing-os-faq-item-${i}`}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`marketing-os-faq-answer-${i}`}
                className="flex min-h-11 w-full items-center justify-between gap-6 text-left text-[17px] font-medium text-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15171C]"
                data-testid={`button-marketing-os-faq-${i}`}
              >
                {f.q}
                <Plus
                  className={`h-5 w-5 shrink-0 text-[#5C606A] transition-transform ${isOpen ? "rotate-45" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </h3>
            {isOpen && (
              <p id={`marketing-os-faq-answer-${i}`} className="mt-2 max-w-2xl text-pretty text-[16px] leading-[1.6] text-[#5C606A]">
                {f.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MarketingLandingPage() {
  return (
    <MarketingShell>
      <SEO path="/marketing" />
      <FAQStructuredData faqs={FAQS} />

      <PageHero>
        <Container>
          <Eyebrow>
            <span data-testid="badge-marketing-os-addon">
              Marketing Hub <span className="font-normal text-[#6E727B]">· Business plan</span>
            </span>
          </Eyebrow>
          <Display testId="marketing-os-heading" className="mt-4">
            Keep in touch with the people who hire you.
          </Display>
          <Lede size="hero" className="mt-6">
            Most new work comes from people who already know you. Marketing Hub keeps them beside the work you deliver: contacts and companies, campaigns, sequences that stop when someone replies, and an AI chat that turns visitors to your website into leads.
          </Lede>
          <Ctas>
            <ButtonLink href={SIGNUP_BUSINESS} testId="button-marketing-os-hero-signup">
              Start a trial on Business
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" testId="link-marketing-os-hero-pricing">
              See plans and pricing
            </ButtonLink>
          </Ctas>
          <Note>{BUSINESS_TRIAL_NOTE}</Note>
          <Scene screen={SCREENS.contacts} priority className="mt-14 md:mt-20" testId="marketing-hero-screen" />
          <div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-10 md:mt-20 md:grid-cols-4">
            <Fact value={`${BUSINESS_MONTHLY}/mo`} label="Business plan, Marketing Hub included" />
            <Fact value="Your mailbox" label="Microsoft 365, Google or SMTP" />
            <Fact value={IMPORT_ROW_LIMIT} label="rows in one CSV import" />
            <Fact value="One login" label="the same workspace as billing and support" />
          </div>
        </Container>
      </PageHero>

      <Section testId="section-capabilities">
        <Container>
          <Heading>From a name on a list to a client you bill.</Heading>
          <Lede className="mt-5">
            A list of the people you want to stay close to, ways to group them, and two ways to write to them, all in the app you already run your firm on.
          </Lede>
          <Flow>
            {CAPABILITIES.map((c, i) => (
              <Row key={c.n} title={c.title} screen={c.screen} flip={i % 2 === 1} testId={`marketing-os-capability-${c.n}`}>
                <p>{c.body}</p>
                <Points items={c.points} />
              </Row>
            ))}
          </Flow>
          <dl className="mt-16 grid gap-x-10 sm:grid-cols-2 md:mt-24 lg:grid-cols-3 lg:gap-x-[72px]">
            {MORE.map((m) => (
              <div key={m.t} className="border-t border-[#E6E3DD] pb-8 pt-5">
                <dt className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">{m.t}</dt>
                <dd className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{m.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section testId="section-separation">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Eyebrow>Kept apart</Eyebrow>
              <Heading className="mt-3" testId="heading-prospect-client-separation">
                Prospects stay out of your books.
              </Heading>
              <Lede className="mt-5">
                Prospects and the companies they work for are stored apart from the clients you bill. A prospect can’t end up on an invoice, in a revenue report or in a payout.
              </Lede>
              <p className="mt-5 max-w-[620px] text-[17px] font-medium leading-[1.55] text-[#15171C]" data-testid="text-cross-contamination">
                Marketing records and billing records don’t mix. A campaign to everyone in a brand goes to that brand’s prospects, never to your client contacts.
              </p>
            </div>
            <div className="grid gap-10 sm:grid-cols-2 sm:gap-x-10 lg:pt-2">
              {[
                { t: "In Marketing Hub", items: ["Prospects", "Marketing companies", "Tags and segments", "Campaigns and sequences", "Website chat leads"] },
                { t: "In billing and support", items: ["Clients and client contacts", "Projects and time", "Invoices and payments", "Support cases", "Payouts and the ledger"] },
              ].map((col) => (
                <div key={col.t}>
                  <h3 className="text-[15px] font-medium text-[#6E727B]">{col.t}</h3>
                  <ul className="mt-3 border-t border-[#E6E3DD]">
                    {col.items.map((it) => (
                      <li key={it} className="border-b border-[#E6E3DD] py-3 text-[16px] text-[#15171C]">{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section testId="section-fits">
        <Container>
          <Heading>Part of the app you already run on.</Heading>
          <dl className="mt-10 grid gap-x-[72px] md:mt-16 md:grid-cols-2">
            {FITS.map((f) => (
              <div key={f.t} className="border-t border-[#E6E3DD] pb-8 pt-5">
                <dt className="text-[17px] font-medium text-[#15171C]">{f.t}</dt>
                <dd className="mt-2 max-w-[480px] text-pretty text-[15.5px] leading-[1.55] text-[#5C606A]">{f.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section testId="section-plan">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[7fr_5fr] lg:items-end lg:gap-[72px]">
            <div>
              <Heading>Included on Business.</Heading>
              <Lede className="mt-5">
                Marketing Hub comes with the Business plan, along with multiple entities, the report builder and the period close. It isn’t a separate add-on, and Business has unlimited users like every plan.
              </Lede>
              <div className="mt-8">
                <ButtonLink href="/pricing" variant="secondary" testId="button-marketing-os-pricing-signup">
                  See Business plan pricing
                </ButtonLink>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <Fact value={BUSINESS_MONTHLY} label="per month" />
              <Fact value={BUSINESS_ANNUAL} label="per year" />
            </div>
          </div>
        </Container>
      </Section>

      <Section testId="section-marketing-os-faq">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Heading testId="heading-marketing-os-faq">Questions about Marketing Hub</Heading>
              <p className="mt-5 text-[16px] leading-[1.6] text-[#5C606A]">
                Something else? <TextLink href="/contact">Ask us directly</TextLink>.
              </p>
            </div>
            <FaqList />
          </div>
        </Container>
      </Section>

      <Closing
        testId="section-marketing-os-cta"
        heading="Put your list next to your work."
        body="Start a 14-day trial on Business, import the people you want to stay in touch with, and send your first campaign from your own mailbox."
        primary={{ href: SIGNUP_BUSINESS, label: "Start a trial on Business", testId: "button-marketing-os-final-signup" }}
        secondary={{ href: "/contact", label: "Ask us a question", testId: "link-marketing-os-final-contact" }}
        note={BUSINESS_TRIAL_NOTE}
      />
    </MarketingShell>
  );
}
