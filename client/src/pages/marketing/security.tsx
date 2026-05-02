import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Shield, Database, CreditCard, Lock, ShieldAlert, Link2, FileText, Server } from "lucide-react";
import { Link } from "wouter";

const sections = [
  {
    icon: Database,
    title: "Tenant Isolation",
    content: "Every row in our database is scoped to a single organization. Every query and mutation derives the organization ID from the authenticated session \u2014 never from request input. Cross-tenant reads and writes are architecturally impossible.",
  },
  {
    icon: Shield,
    title: "Financial Determinism",
    content: "Invoice totals, discounts, tax, and payment status are computed deterministically and re-verifiable on demand. Once an invoice is sent, edits create immutable revision snapshots \u2014 the original is never silently mutated. Every financial mutation is written to an audit log.",
  },
  {
    icon: CreditCard,
    title: "Payments",
    content: "Stripe integration uses signature-verified webhooks (constructEvent against STRIPE_WEBHOOK_SECRET). Payment receipts are reconciled idempotently. Refunds reconcile atomically against the original charge. We never see or store full card numbers.",
  },
  {
    icon: Lock,
    title: "Authentication & Sessions",
    content: "HttpOnly session cookies with sameSite=lax and the secure flag in production. CSRF protection with double-submit tokens on every mutating request. Bcrypt password hashing. Optional TOTP and WebAuthn multi-factor authentication, persisted to the database.",
  },
  {
    icon: ShieldAlert,
    title: "Rate Limiting & Abuse Protection",
    content: "Per-route rate limits on login, signup, password reset, public invoice tokens, payments, imports, payroll webhooks, and settings changes. Per-tenant token-bucket limiter on top of per-IP and per-user limits.",
  },
  {
    icon: Link2,
    title: "Public Invoice Links",
    content: "Public invoice tokens use 256 bits of cryptographic entropy (randomBytes(32)). Each invoice has its own token. Tokens can be revoked.",
  },
  {
    icon: FileText,
    title: "Audit Logging",
    content: "Every financial and workflow mutation \u2014 invoice send, invoice revision, payment apply, payment refund, payout, timesheet transition, MFA change, import run, year-end close \u2014 is written to an append-only audit log scoped to your organization.",
  },
  {
    icon: Server,
    title: "Data Handling",
    content: "All traffic is HTTPS. PII is masked in application logs. We do not sell or share customer data with third parties.",
  },
  {
    icon: Database,
    title: "Marketing Hub — Prospect / Client Separation",
    content: "On the Business plan, Marketing Hub is included: marketing prospects and marketing companies live in physically separate database tables (marketing_prospects, marketing_companies) from your billing clients. No foreign keys cross that boundary, so a marketing lead cannot be silently invoiced or reported on as a client. Promoting a prospect to a billing client is an explicit, audited action — never an automatic side effect. This prevents cross-contamination between marketing and billing records by design.",
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--lux-bg)" }}>
      <MarketingNav />
      <SEO
        title="Security"
        fullTitle="Security at CherryWorks Pro"
        description="How CherryWorks Pro protects your data with tenant isolation, financial determinism, CSRF protection, rate limiting, and audit logging."
        path="/security"
      />
      <main className="flex-1 pt-[136px] pb-16 px-4">
        <div className="max-w-3xl mx-auto" style={{ color: "var(--lux-text)" }}>
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--lux-text)" }} data-testid="heading-security-title">
            Security at CherryWorks Pro
          </h1>
          <p className="text-sm mb-8" style={{ color: "var(--lux-text-muted)" }} data-testid="text-security-subtitle">
            Built for firms that handle their clients' money.
          </p>

          <div className="space-y-8 text-sm leading-relaxed" style={{ color: "var(--lux-text-secondary)" }}>
            {sections.map((section, idx) => {
              const Icon = section.icon;
              return (
                <section key={idx} data-testid={`section-security-${idx + 1}`}>
                  <div className="flex items-center gap-2.5 mb-2">
                    <Icon className="w-5 h-5 flex-shrink-0" style={{ color: "var(--lux-accent)" }} />
                    <h2 className="text-lg font-semibold" style={{ color: "var(--lux-text)" }}>
                      {idx + 1}. {section.title}
                    </h2>
                  </div>
                  <p className="pl-[30px]">{section.content}</p>
                </section>
              );
            })}

            <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--lux-border)" }}>
              <p className="text-center" style={{ color: "var(--lux-text-secondary)" }} data-testid="text-security-cta">
                Questions about security or compliance?{" "}
                <Link href="/contact">
                  <span className="font-bold underline cursor-pointer" style={{ color: "#cf3339" }} data-testid="link-security-contact">Contact our security team</span>
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
