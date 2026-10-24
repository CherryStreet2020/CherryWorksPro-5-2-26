import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, Heading, Lede, MarketingShell, PageHero, Section, TextLink } from "@/components/marketing/kit";

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
          <Eyebrow>Security</Eyebrow>
          <Display testId="heading-security-title" className="mt-4">How CherryWorks Pro protects your data.</Display>
          <Lede size="hero" className="mt-6">
            <span data-testid="text-security-subtitle">Built for firms that handle their clients’ money.</span>{" "}
            This page lists what the product does today, in plain terms. If you need something it doesn’t cover, ask us.
          </Lede>
        </Container>
      </PageHero>

      <Section>
        <Container>
          <ul className="border-t border-[#E6E3DD]">
            {sections.map((section, idx) => (
              <li
                key={section.title}
                data-testid={`section-security-${idx + 1}`}
                className="grid gap-4 border-b border-[#E6E3DD] py-10 md:grid-cols-[5fr_7fr] md:gap-[72px] md:py-12"
              >
                <Heading as="h2" className="!text-[22px] !leading-[1.2] !tracking-[-0.015em] md:!text-[26px]">{section.title}</Heading>
                <ul className="space-y-3 text-[16px] leading-[1.6] text-[#5C606A]">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section className="pb-24 md:pb-[152px]">
        <Container>
          <p className="max-w-2xl text-[19px] leading-[1.5] text-[#15171C]" data-testid="text-security-cta">
            Questions about security or compliance, or a questionnaire to fill in?{" "}
            <TextLink href="/contact" testId="link-security-contact">Send us a message</TextLink>.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
