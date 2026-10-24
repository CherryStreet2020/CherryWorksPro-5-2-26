import { SEO } from "@/components/seo";
import {
  Closing, Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Section, TextLink,
} from "@/components/marketing/kit";

/**
 * Only connections that are built and working are listed here, each one
 * traceable to code (server/email/*, server/routes/bank-routes.ts,
 * server/support-jira.ts, server/routes/integration-routes.ts, server/webhooks.ts).
 * Plan notes match requirePlanTier() gates. Add an entry only with the code behind it.
 * The webhook events are the ones fireWebhookEvent() actually sends, not the
 * longer WEBHOOK_EVENT_TYPES list an endpoint can subscribe to.
 */
type Integration = { id: string; name: string; plan?: string; body: string; points?: string[] };
type Group = { title: string; intro: string; items: Integration[] };

const PRO_UP = "Professional and up";

const groups: Group[] = [
  {
    title: "Email",
    intro: "Invoices, estimates and case replies go out from your firm’s own mailbox, so clients see your address, not ours.",
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
        name: "Imports from eight platforms",
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
          <Eyebrow>Integrations</Eyebrow>
          <Display className="mt-4">Your mailbox, your Stripe account, your bank.</Display>
          <Lede size="hero" className="mt-6">
            CherryWorks Pro sends from the email address your clients already know, takes payments and pays your team through Stripe, reads your bank feed, and talks to your own systems through an API and webhooks.
          </Lede>
        </Container>
      </PageHero>

      <Section>
        <Container>
          <div className="space-y-16 md:space-y-24">
            {groups.map((group) => (
              <div key={group.title} className="grid gap-6 md:grid-cols-[4fr_8fr] md:gap-[72px]">
                <div>
                  <Heading>{group.title}</Heading>
                  <p className="mt-4 max-w-sm text-[17px] leading-[1.6] text-[#5C606A]">{group.intro}</p>
                </div>
                <ul className="border-t border-[#E6E3DD] md:mt-2">
                  {group.items.map((item) => (
                    <li key={item.id} data-testid={`card-integration-${item.id}`} className="border-b border-[#E6E3DD] py-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="text-[17px] font-medium tracking-[-0.005em] text-[#15171C]">{item.name}</h3>
                        {item.plan && <p className="text-[13px] text-[#6E727B]">{item.plan}</p>}
                      </div>
                      <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{item.body}</p>
                      {item.points?.map((point) => (
                        <p key={point} className="mt-3 text-[14px] leading-relaxed text-[#6E727B]">
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

      <Section testId="section-marketing-os-addon">
        <Container>
          <div className="grid gap-6 md:grid-cols-[4fr_8fr] md:gap-[72px]">
            <div>
              <p data-testid="badge-marketing-os-addon" className="text-[15px] font-medium text-[#CF3339]">
                Marketing Hub <span className="font-normal text-[#6E727B]">· Business plan</span>
              </p>
              <Heading className="mt-3">Prospects stay apart from billing.</Heading>
            </div>
            <div className="md:mt-2">
              <p className="max-w-xl text-[17px] leading-[1.6] text-[#5C606A]">
                Contacts, companies, tags, segments, campaigns and email sequences live in their own tables, separate from the clients you bill. A prospect becomes a client only when you convert them.
              </p>
              <p className="mt-6 text-[15px]">
                <TextLink href="/marketing" testId="link-marketing-os">Tour Marketing Hub</TextLink>
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-6 border-t border-[#E6E3DD] pt-10 md:grid-cols-[4fr_8fr] md:gap-[72px]">
            <h2 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">Asked for, not built yet</h2>
            <div className="text-[15.5px] leading-[1.6] text-[#5C606A]">
              <p>{notYet.join(" · ")}</p>
              <p className="mt-4">
                <TextLink href="/contact" testId="link-zapier">Tell us which one you need</TextLink>
                <span>. Requests decide what gets built next.</span>
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <Closing
        heading="Connect your own mailbox and Stripe account in the trial."
        body="The trial runs on Professional, which includes the REST API, webhooks, imports and bank feeds."
        primary={{ href: "/signup", label: "Start your trial", testId: "button-start-trial-integrations" }}
        secondary={{ href: "/demo", label: "Book a demo" }}
      />
    </MarketingShell>
  );
}
