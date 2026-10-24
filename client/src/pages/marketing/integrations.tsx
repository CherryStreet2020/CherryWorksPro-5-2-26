import { Link } from "wouter";
import { SEO } from "@/components/seo";
import {
  ButtonLink, Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Section, TextLink,
} from "@/components/marketing/kit";

/**
 * Only connections that are built and working are listed here, each one
 * traceable to code (server/email/*, server/routes/bank-routes.ts,
 * server/support-jira.ts, server/routes/integration-routes.ts, server/webhooks.ts).
 * Plan notes match requirePlanTier() gates. Add a card only with the code behind it.
 */
type Integration = { id: string; name: string; plan?: string; body: string; points?: string[] };
type Group = { title: string; intro: string; items: Integration[] };

const PRO_UP = "Professional and Business";

const groups: Group[] = [
  {
    title: "Email",
    intro: "Invoices go out from your firm’s own mailbox, so clients see your address, not ours.",
    items: [
      {
        id: "microsoft-365",
        name: "Microsoft 365",
        body: "Connect a Microsoft 365 mailbox with Microsoft’s own sign-in. Mail is sent through Microsoft Graph from that mailbox.",
        points: ["Inbound email-to-case works with Microsoft 365 mailboxes only."],
      },
      {
        id: "google",
        name: "Gmail and Google Workspace",
        body: "Connect a Gmail or Google Workspace mailbox with Google’s sign-in and send from it.",
      },
      {
        id: "smtp",
        name: "Any SMTP server",
        body: "Point CherryWorks Pro at your mail provider’s SMTP server. The password is encrypted before it is stored.",
      },
    ],
  },
  {
    title: "Payments and banking",
    intro: "Money moves through Stripe. CherryWorks Pro records what happened in your ledger.",
    items: [
      {
        id: "stripe",
        name: "Stripe payments",
        body: "Clients pay invoices by card or ACH on Stripe’s hosted checkout page, and each payment posts to your ledger.",
      },
      {
        id: "stripe-connect",
        name: "Stripe Connect payouts",
        plan: PRO_UP,
        body: "Pay contractors what their hours have earned through Stripe Connect, or record a payment you made another way.",
      },
      {
        id: "bank-accounts",
        name: "Bank accounts",
        plan: PRO_UP,
        body: "Link US bank accounts through Stripe Financial Connections to pull in transactions and balances, then match deposits and charges to your invoices, payments and expenses.",
      },
    ],
  },
  {
    title: "Moving in",
    intro: "Bring your history with you instead of starting from a blank account.",
    items: [
      {
        id: "imports",
        name: "Imports from 8 platforms",
        plan: PRO_UP,
        body: "Import from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro and Paymo. You see a preview before anything is written.",
        points: ["These are file imports. There is no live, two-way sync with QuickBooks or any other accounting system."],
      },
      {
        id: "jira-service-management",
        name: "Jira Service Management",
        plan: PRO_UP,
        body: "Import your Jira Cloud support issues with an Atlassian API token. Comments, attachments and original keys come across, closed issues included.",
      },
    ],
  },
  {
    title: "For developers",
    intro: "Connect your own tools directly. An admin creates the API keys and webhook endpoints.",
    items: [
      {
        id: "rest-api",
        name: "REST API",
        plan: PRO_UP,
        body: "Read clients, invoices, payments, projects, time entries and your team, and create clients, invoices, projects and time entries, under /api/v1 with an API key. The OpenAPI description is published at /api/docs.",
      },
      {
        id: "webhooks",
        name: "Webhooks",
        plan: PRO_UP,
        body: "Get a request to your endpoint, signed with HMAC-SHA256, when something happens in your account. Failed deliveries are retried.",
        points: [
          "Events: invoice.created, invoice.sent, invoice.paid, payment.received, client.created, estimate.sent, timesheet.submitted, timesheet.approved, timesheet.recalled.",
        ],
      },
    ],
  },
];

const notYet = ["Zapier", "Slack", "Microsoft Teams", "HubSpot", "Google Sheets", "Notion", "Live QuickBooks Online sync"];

export default function IntegrationsPage() {
  return (
    <MarketingShell>
      <SEO path="/integrations" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Integrations</Eyebrow>
            <Display className="mt-5">What CherryWorks Pro connects to</Display>
            <Lede className="mt-6 max-w-2xl">
              This page lists only the connections that are built and working today. If a tool you rely on isn’t here, it isn’t built yet.
            </Lede>
          </div>
        </Container>
      </PageHero>

      <Section tone="white" className="!py-0">
        <Container>
          <div className="divide-y divide-[#E6E2DA]">
            {groups.map((group) => (
              <div
                key={group.title}
                className="grid gap-6 py-12 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:gap-12 md:py-16"
              >
                <div>
                  <h2 className="font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-[1.75rem]">
                    {group.title}
                  </h2>
                  <p className="mt-3 max-w-sm text-base leading-relaxed text-[#5F6672]">{group.intro}</p>
                </div>
                <ul className="grid gap-px overflow-hidden rounded-xl border border-[#E6E2DA] bg-[#E6E2DA]">
                  {group.items.map((item) => (
                    <li key={item.id} data-testid={`card-integration-${item.id}`} className="bg-white p-6 md:p-7">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="text-lg font-semibold text-[#15171C]">{item.name}</h3>
                        {item.plan && <p className="text-[13px] font-medium text-[#5F6672]">{item.plan}</p>}
                      </div>
                      <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">{item.body}</p>
                      {item.points?.map((point) => (
                        <p key={point} className="mt-3 border-l-2 border-[#E6E2DA] pl-3 text-sm leading-relaxed text-[#5F6672]">
                          {point}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:gap-12">
            <h2 className="font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-[1.75rem]">
              Not built yet
            </h2>
            <div>
              <p className="text-base leading-relaxed text-[#3D4350]">
                People ask about these. None of them is available today:
              </p>
              <p className="mt-3 text-base leading-relaxed text-[#15171C]">{notYet.join(" · ")}</p>
              <p className="mt-6 text-base leading-relaxed text-[#3D4350]">
                <Link
                  href="/contact"
                  data-testid="link-zapier"
                  className="font-medium text-[#15171C] underline decoration-[#D9D4CB] underline-offset-4 hover:decoration-[#15171C]"
                >
                  Zapier: not yet — tell us if you need it
                </Link>
                . The same goes for anything else on this list. Requests decide what gets built next.
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="white" testId="section-marketing-os-addon">
        <Container>
          <div className="grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:items-end md:gap-12">
            <div>
              <p
                data-testid="badge-marketing-os-addon"
                className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#B32A30]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#CF3339]" aria-hidden="true" />
                Included in Business plan
              </p>
              <Heading className="mt-4">Marketing Hub keeps prospects apart from billing</Heading>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#3D4350]">
                Prospects, companies, tags, segments, campaigns and email sequences live in their own tables, separate from your
                billing clients. Prospects are never copied into your client list automatically.
              </p>
            </div>
            <div className="md:justify-self-end">
              <TextLink href="/marketing" testId="link-marketing-os">Tour Marketing Hub</TextLink>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="night">
        <Container>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-white md:text-5xl">
              Connect your own mailbox and Stripe account in the trial
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Professional and Business include the REST API, webhooks, imports and bank accounts. Start a trial on either to try them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" arrow testId="button-start-trial-integrations">
                Start your 14-day trial
              </ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight">Book a demo</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-white/50">You won’t be charged until day 15 · Cancel anytime</p>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
