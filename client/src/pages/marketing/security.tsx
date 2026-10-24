import { Link } from "wouter";
import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, Lede, MarketingShell, PageHero, Section } from "@/components/marketing/kit";

/**
 * Every line below is something the product does today and can be pointed to
 * in the code or the hosting setup (docs/DEPLOY.md). Keep it that way: add a
 * claim only with the code that backs it.
 */
const sections: { title: string; points: string[] }[] = [
  {
    title: "Each firm’s data stays separate",
    points: [
      "Every record belongs to one organization.",
      "The server takes your organization from your signed-in session, never from anything the browser sends, and scopes every query and change to it.",
    ],
  },
  {
    title: "Sign-in and sessions",
    points: [
      "Passwords are hashed with bcrypt. We never store them in plain text.",
      "Session cookies are HttpOnly, SameSite=Lax and Secure. A session ends after 30 minutes without activity.",
      "Every request that changes data must carry a CSRF token.",
      "Two-factor sign-in with an authenticator app, with recovery codes. A firm can require it for every admin.",
    ],
  },
  {
    title: "Payments",
    points: [
      "Clients pay by card or ACH on Stripe’s hosted checkout page, so card numbers never reach our servers.",
      "Stripe’s webhooks are checked against their signature, and each event is recorded so it is applied only once.",
      "A refund is checked against the original charge and recorded in a single step.",
    ],
  },
  {
    title: "Invoices",
    points: [
      "Once an invoice is sent, each edit is saved as a new revision, so the version your client received is kept.",
      "Each invoice’s public link carries its own random 256-bit token.",
    ],
  },
  {
    title: "Rate limits",
    points: [
      "Sign-in, signup, password reset, public invoice links, payments, imports and settings changes each have their own limit.",
      "On top of those, every IP address, user and organization has a per-minute request budget.",
    ],
  },
  {
    title: "Audit log",
    points: [
      "Invoice sends and revisions, payments and refunds, payouts, timesheet approvals, imports, sign-ins and API key changes are written to an audit log for your organization.",
      "Admins can export the log.",
    ],
  },
  {
    title: "Hosting and stored data",
    points: [
      "CherryWorks Pro runs on Microsoft Azure in the United States (East US 2).",
      "All traffic uses HTTPS, with HSTS.",
      "Stored bank details, mailbox passwords and mailbox sign-in tokens are encrypted by the application before they are saved.",
      "The database keeps 35 days of point-in-time backups.",
      "We do not sell customer data.",
    ],
  },
  {
    title: "Marketing contacts stay apart from billing",
    points: [
      "On the Business plan, Marketing Hub prospects and companies are stored in their own tables, separate from your billing clients.",
      "Prospects are never copied into your client list automatically.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <SEO path="/security" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Security</Eyebrow>
            <Display testId="heading-security-title" className="mt-5">Security at CherryWorks Pro</Display>
            <Lede className="mt-6 max-w-2xl">
              <span data-testid="text-security-subtitle">Built for firms that handle their clients’ money.</span>{" "}
              This page lists how the product protects your data today, in plain terms. If you need something it doesn’t cover, ask us.
            </Lede>
          </div>
        </Container>
      </PageHero>

      <Section tone="white" className="!py-0">
        <Container>
          <ol className="divide-y divide-[#E6E2DA]">
            {sections.map((section, idx) => (
              <li
                key={section.title}
                data-testid={`section-security-${idx + 1}`}
                className="grid gap-4 py-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:py-12"
              >
                <div className="flex items-baseline gap-4">
                  <span className="font-display text-sm font-semibold tabular-nums text-[#B32A30]" aria-hidden="true">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <h2 className="font-display text-2xl font-semibold leading-snug tracking-[-0.01em] text-[#15171C] md:text-[1.75rem]">
                    {section.title}
                  </h2>
                </div>
                <ul className="space-y-3 text-base leading-relaxed text-[#3D4350]">
                  {section.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-[#9AA0AA]" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section>
        <Container>
          <p className="max-w-2xl text-lg leading-relaxed text-[#3D4350]" data-testid="text-security-cta">
            Questions about security or compliance, or a questionnaire to fill in?{" "}
            <Link
              href="/contact"
              className="font-semibold text-[#15171C] underline decoration-[#CF3339]/40 underline-offset-[5px] hover:decoration-[#CF3339]"
              data-testid="link-security-contact"
            >
              Send us a message
            </Link>
            .
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
