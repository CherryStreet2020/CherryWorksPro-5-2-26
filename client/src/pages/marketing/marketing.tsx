import { useState } from "react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import { PLAN_PRICING } from "@shared/plan-pricing";
import {
  ButtonLink, Container, Display, Eyebrow, Fact, Heading, Lede, MarketingShell, PageHero, Section,
} from "@/components/marketing/kit";

/**
 * Public landing page for Marketing Hub (the `marketing_os` entitlement,
 * included on the Business plan). Every claim here maps to shipped code:
 *   contacts/companies  server/routes/marketing/{prospects,companies}.ts, client/src/pages/marketing-os/contacts.tsx
 *   CSV import          server/routes/marketing-contact-import-routes.ts, server/lib/contact-import.ts
 *   tags/segments       server/routes/marketing/{tags,segments}.ts, storage.listProspectsByFilter (AND tags + search)
 *   campaigns           server/routes/marketing/campaigns.ts (send-now, audience-preview), server/marketing/scheduled-send.ts
 *   sequences           marketing_sequences / _steps (delayDays 0–365) / _enrollments (active|paused|completed|removed)
 *   sending             server/email/send-via-connected-mailbox.ts (the firm’s Microsoft 365, Google or SMTP mailbox)
 *   separation          marketing_* tables carry no foreign key to clients, client_contacts or invoices (HR4)
 * Not claimed because it doesn’t exist: open/click tracking, reply detection, auto-stop on reply.
 */

// MAX_ASYNC_IMPORT_ROWS in server/routes/marketing-contact-import-routes.ts.
const IMPORT_ROW_LIMIT = "50,000";
// The signup page reads ?plan= and starts the trial on that plan; Business turns Marketing Hub on.
const SIGNUP_BUSINESS = "/signup?plan=BUSINESS";

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const BUSINESS_MONTHLY = money(PLAN_PRICING.BUSINESS.monthly);
const BUSINESS_ANNUAL = money(PLAN_PRICING.BUSINESS.annual);

const CAPABILITIES = [
  {
    n: "01",
    title: "Contacts and companies",
    lead: "A list of the people you want to stay in touch with.",
    body: "Each contact keeps their email, phone, title, LinkedIn and location, a lifecycle stage and your notes. Link people to the company they work for, with its domain, industry and size.",
    points: [
      "Search, or filter by stage or tag",
      "Tag, untag or change the stage of a whole selection at once",
      "A timeline on each contact: the notes, calls and meetings you log, and the scheduled campaign and sequence emails they’ve been sent",
      "One activity feed across every contact",
    ],
  },
  {
    n: "02",
    title: "Import from a spreadsheet",
    lead: "Bring the list you already have.",
    body: "Upload a CSV, match its columns to contact fields, and decide what happens when an email address is already on your list: skip the row or update the contact. Before anything is written, you see how many rows will be added, updated, skipped or rejected.",
    points: [
      `Up to ${IMPORT_ROW_LIMIT} rows in one file, imported in the background`,
      "Tag everyone in an import as it comes in",
      "Save a column mapping and reuse it next time",
      "Download the rows that couldn’t be imported",
    ],
  },
  {
    n: "03",
    title: "Tags and segments",
    lead: "Group people the way you already think about them.",
    body: "Tags are colored labels you put on contacts. A segment is a saved filter: everyone who carries all of the tags you pick, narrowed by a search if you like. Campaigns and sequences send to segments, and a campaign uses the segment as it stands when it sends.",
    points: [
      "See how many people are in a segment, and who, before you send to it",
      "Segments match on tags and search text only, not on custom fields or past activity",
    ],
  },
  {
    n: "04",
    title: "Campaigns",
    lead: "One email to a group, now or at a set time.",
    body: "Write a subject and body, choose everyone in a brand or a saved segment, then send now or schedule it. Before you send, you see how many people it will reach, with a warning when that number is unusually large.",
    points: [
      "Each campaign shows how many sends went out and which ones failed",
      "Scheduled sends retry failed recipients automatically",
      "No open or click tracking: emails go out without pixels or rewritten links",
    ],
  },
  {
    n: "05",
    title: "Sequences",
    lead: "Follow-ups that go out on a schedule.",
    body: "A sequence is a series of emails with a wait of some number of days before each one. Enroll people one at a time or a whole segment, then pause, resume or remove anyone. Every email a sequence sends is logged on that person’s timeline.",
    points: [
      "Steps can be anywhere from the same day to a year apart",
      "A sequence doesn’t stop on its own when someone replies; pause or remove them when they write back",
    ],
  },
];

const FITS = [
  {
    t: "Same sign-in, same workspace",
    d: "Marketing Hub is a section of the CherryWorks Pro app your firm already uses, not a second product with its own login. Admins and managers can open it.",
  },
  {
    t: "Sent from the mailbox you invoice from",
    d: "Campaigns and sequences go out through the Microsoft 365, Google or SMTP mailbox you connect for invoices, so replies land in your own inbox like any other email. With Microsoft 365 or Google, mail sends as that mailbox; a brand’s own from-address is used over SMTP.",
  },
  {
    t: "Organized by brand",
    d: "If your firm works under more than one brand, contacts, tags, segments and campaigns each belong to one, and each brand has its own sender name and reply-to address.",
  },
  {
    t: "Sized for people you know",
    d: "Because mail leaves from your own mailbox, your provider’s sending limits apply. It suits the clients, former clients and prospects you have a real reason to write to, not bulk newsletters.",
  },
];

const FAQS = [
  {
    q: "Is Marketing Hub a replacement for HubSpot?",
    a: "No. HubSpot is a full marketing platform with landing pages, forms, ads and email analytics. Marketing Hub is narrower: a contact list, tags and segments, campaigns and follow-up sequences, sent from your own mailbox. It’s for firms that win work through relationships and want that list in the same place as their billing and support.",
  },
  {
    q: "Which plan includes it?",
    a: `Business, at ${BUSINESS_MONTHLY}/mo or ${BUSINESS_ANNUAL} a year. It isn’t sold as a separate add-on. The 14-day trial starts on Professional unless you choose otherwise, so pick Business when you sign up and Marketing Hub is on from the first day.`,
  },
  {
    q: "Which mailbox do campaigns send from?",
    a: "The one you connect for invoices: Microsoft 365 or Google through sign-in, or any mailbox over SMTP. There’s no separate sending service, and your mailbox provider’s sending limits apply.",
  },
  {
    q: "Does it track opens and clicks?",
    a: "No. Emails go out as you wrote them, without tracking pixels or rewritten links, so there are no open or click rates. Each campaign shows how many sends went out and which failed.",
  },
  {
    q: "Do sequences stop when someone replies?",
    a: "Not on their own. Replies come back to your inbox as normal email, and you pause or remove that person from the sequence. A paused enrollment can be resumed later.",
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
    a: "Admins and managers. Other team members keep using time, cases and invoices as usual and can’t open Marketing Hub.",
  },
];

function FaqList() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} className="py-5" data-testid={`marketing-os-faq-item-${i}`}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`marketing-os-faq-answer-${i}`}
                className="flex w-full items-center justify-between gap-6 text-left text-[17px] font-semibold text-[#15171C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#CF3339]"
                data-testid={`button-marketing-os-faq-${i}`}
              >
                {f.q}
                <Plus
                  className={`h-5 w-5 shrink-0 text-[#5F6672] transition-transform ${isOpen ? "rotate-45" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </h3>
            {isOpen && (
              <p id={`marketing-os-faq-answer-${i}`} className="mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-[#3D4350]">
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
          <div className="max-w-3xl">
            <p
              className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#B32A30]"
              data-testid="badge-marketing-os-addon"
            >
              Marketing Hub · Included on the Business plan
            </p>
            <Display testId="marketing-os-heading" className="mt-5">
              Keep in touch with the people who hire you
            </Display>
            <Lede className="mt-6 max-w-2xl">
              Most consulting work comes from people who already know you. Marketing Hub keeps that list inside CherryWorks Pro: contacts and their companies, tags and segments, and campaigns and follow-up sequences sent from your own mailbox. It isn’t trying to be HubSpot. It’s the marketing a consulting firm actually does.
            </Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href={SIGNUP_BUSINESS} size="lg" arrow testId="button-marketing-os-hero-signup">
                Start a trial on Business
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="secondary" testId="link-marketing-os-hero-pricing">
                See plans and pricing
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">
              You won’t be charged until day 15 · Cancel anytime
            </p>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-[#E6E2DA] pt-10 md:mt-20 md:grid-cols-4">
            <Fact value={`${BUSINESS_MONTHLY}/mo`} label="Business plan, Marketing Hub included" />
            <Fact value="Your mailbox" label="Microsoft 365, Google or SMTP" />
            <Fact value={IMPORT_ROW_LIMIT} label="rows in one CSV import" />
            <Fact value="One login" label="the same workspace as billing and support" />
          </div>
        </Container>
      </PageHero>

      <Section tone="white" testId="section-capabilities">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What it does</Eyebrow>
            <Heading className="mt-4">Five parts, and where each one stops</Heading>
            <Lede className="mt-5">
              A list of people, ways to group them, and two ways to write to them. Here’s what each part does today.
            </Lede>
          </div>
          <div className="mt-14 divide-y divide-[#E6E2DA] border-y border-[#E6E2DA]">
            {CAPABILITIES.map((c) => (
              <div
                key={c.n}
                className="grid gap-6 py-10 md:grid-cols-12 md:gap-12 md:py-12"
                data-testid={`marketing-os-capability-${c.n}`}
              >
                <div className="md:col-span-4">
                  <p className="font-display text-sm font-semibold tracking-[0.08em] text-[#B32A30]">{c.n}</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-[1.75rem]">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-pretty text-[15px] leading-relaxed text-[#5F6672]">{c.lead}</p>
                </div>
                <div className="md:col-span-8">
                  <p className="max-w-2xl text-pretty text-[17px] leading-relaxed text-[#3D4350]">{c.body}</p>
                  <ul className="mt-6 max-w-2xl space-y-2.5 border-t border-[#ECE8E1] pt-5">
                    {c.points.map((pt) => (
                      <li key={pt} className="flex gap-3 text-[15px] leading-snug text-[#3D4350]">
                        <span className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#CF3339]" aria-hidden="true" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section testId="section-separation">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <Eyebrow>Kept apart</Eyebrow>
              <Heading className="mt-4" testId="heading-prospect-client-separation">
                Prospects stay out of your books
              </Heading>
              <Lede className="mt-5">
                Prospects and the companies they work for are stored apart from the clients you bill. A prospect can’t end up on an invoice, in a revenue report or in a payout.
              </Lede>
              <p className="mt-5 text-[17px] font-semibold leading-relaxed text-[#15171C]" data-testid="text-cross-contamination">
                Marketing records and billing records don’t mix. A campaign to everyone in a brand goes to that brand’s prospects, never to your client contacts.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-xl border border-[#E6E2DA] bg-[#E6E2DA] sm:grid-cols-2 lg:col-span-7">
              {[
                { t: "In Marketing Hub", items: ["Prospects", "Marketing companies", "Tags and segments", "Campaigns and sequences"] },
                { t: "In billing and support", items: ["Clients and client contacts", "Projects and time", "Invoices and payments", "Support cases"] },
              ].map((col) => (
                <div key={col.t} className="bg-white p-7">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#5F6672]">{col.t}</h3>
                  <ul className="mt-4 divide-y divide-[#ECE8E1]">
                    {col.items.map((it) => (
                      <li key={it} className="py-3 text-[15px] text-[#15171C]">{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-fits">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Eyebrow>How it fits</Eyebrow>
              <Heading className="mt-4">Part of the app you already run your firm on</Heading>
              <Lede className="mt-5">
                What Marketing Hub shares with the rest of CherryWorks Pro, and what that means day to day.
              </Lede>
            </div>
            <dl className="grid content-start gap-x-10 gap-y-8 sm:grid-cols-2 lg:col-span-7 lg:pt-2">
              {FITS.map((f) => (
                <div key={f.t} className="border-t border-[#E6E2DA] pt-5">
                  <dt className="font-semibold text-[#15171C]">{f.t}</dt>
                  <dd className="mt-2 text-pretty text-[15px] leading-relaxed text-[#3D4350]">{f.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section testId="section-plan" className="md:py-24">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7">
              <Eyebrow>Plan</Eyebrow>
              <Heading className="mt-4">Included on Business</Heading>
              <Lede className="mt-5">
                Marketing Hub comes with the Business plan, along with period closes. It isn’t a separate add-on, and like every plan, Business has unlimited users. Pick Business when you start your 14-day trial and Marketing Hub is on from the first day.
              </Lede>
              <div className="mt-8">
                <ButtonLink href="/pricing" variant="secondary" arrow testId="button-marketing-os-pricing-signup">
                  See Business plan pricing
                </ButtonLink>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8 border-t border-[#E6E2DA] pt-8 lg:col-span-4 lg:col-start-9 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
              <Fact value={BUSINESS_MONTHLY} label="per month" />
              <Fact value={BUSINESS_ANNUAL} label="per year" />
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-marketing-os-faq">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Heading testId="heading-marketing-os-faq">Questions about Marketing Hub</Heading>
              <p className="mt-5 text-[15px] leading-relaxed text-[#3D4350]">
                Something else?{" "}
                <Link href="/contact" className="font-medium text-[#15171C] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]">
                  Ask us directly
                </Link>
                . A person who uses the product every day will answer.
              </p>
            </div>
            <FaqList />
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-marketing-os-cta">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.015em] text-balance text-white md:text-5xl">
              Put your list next to your work
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Start a 14-day trial on Business, import a CSV of the people you want to stay in touch with, and send your first campaign from your own mailbox.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href={SIGNUP_BUSINESS} size="lg" arrow testId="button-marketing-os-final-signup">
                Start a trial on Business
              </ButtonLink>
              <ButtonLink href="/contact" size="lg" variant="onNight" testId="link-marketing-os-final-contact">
                Ask us a question
              </ButtonLink>
            </div>
            <p className="mt-6 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
