import { Link } from "wouter";
import { ArrowRight, Zap, ExternalLink } from "lucide-react";
import { SiSlack, SiGooglesheets, SiStripe, SiGmail, SiHubspot, SiNotion } from "react-icons/si";
import { Users } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const apps = [
  {
    name: "Slack",
    icon: SiSlack,
    color: "#4A154B",
    zaps: ["Get notified when an invoice is paid", "Post project updates to a channel"],
  },
  {
    name: "Google Sheets",
    icon: SiGooglesheets,
    color: "#0F9D58",
    zaps: ["Export new invoices to a spreadsheet", "Sync client data automatically"],
  },
  {
    name: "QuickBooks",
    icon: null,
    color: "#2CA01C",
    label: "QB",
    zaps: ["Sync paid invoices to QuickBooks", "Import expenses for reconciliation"],
  },
  {
    name: "Stripe",
    icon: SiStripe,
    color: "#635BFF",
    zaps: ["Create payouts when invoices are approved", "Log Stripe payments as revenue"],
  },
  {
    name: "Gmail",
    icon: SiGmail,
    color: "#EA4335",
    zaps: ["Email clients when invoices are sent", "Get digest emails for overdue invoices"],
  },
  {
    name: "Microsoft Teams",
    icon: Users,
    color: "#5059C9",
    zaps: ["Post timesheet approvals to Teams", "Alert managers on expense submissions"],
  },
  {
    name: "HubSpot",
    icon: SiHubspot,
    color: "#FF7A59",
    zaps: ["Create CherryWorks Pro clients from HubSpot deals", "Sync revenue data to HubSpot"],
  },
  {
    name: "Notion",
    icon: SiNotion,
    color: "#ffffff",
    zaps: ["Log new projects in a Notion database", "Track invoices in a Notion table"],
  },
  {
    name: "Resend",
    icon: null,
    color: "#000000",
    label: "RS",
    zaps: ["Send marketing campaigns and sequence steps via Resend", "Deliver transactional emails through your Resend domain"],
  },
  {
    name: "Gmail / M365 OAuth",
    icon: SiGmail,
    color: "#EA4335",
    zaps: ["Connect a Gmail or Microsoft 365 mailbox to send from your own address", "Auto-recover sender health when sends start working again"],
  },
  {
    name: "Tracking Subdomain",
    icon: null,
    color: "#0075DD",
    label: "DNS",
    zaps: ["Use your own subdomain (e.g. links.yourbrand.com) for click and open tracking", "Keep marketing analytics on your domain — never a vendor's"],
  },
];

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen" style={{ background: "#060a14" }}>
      <SEO
        title="Integrations"
        fullTitle="Integrations — CherryWorks Pro | Zapier, Slack, Stripe & 6,000+ Apps"
        description="Connect CherryWorks Pro to Slack, Stripe, QuickBooks, Google Sheets, HubSpot, and 6,000+ apps via Zapier. REST API and webhooks included."
        path="/integrations"
      />
      <MarketingNav />

      <section className="pt-[100px] pb-8 md:pb-10 px-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle at 30% 30%, #cf3339 0%, transparent 50%), radial-gradient(circle at 70% 70%, #cf3339 0%, transparent 50%)" }} />
        <div className="max-w-4xl mx-auto text-center relative z-10 pt-8 md:pt-12">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-tight mb-6">
            Connect CherryWorks Pro to{" "}
            <span style={{ color: "#cf3339" }}>6,000+ apps</span>
          </h1>
          <p className="text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-10" style={{ color: "rgba(255,255,255,0.55)" }}>
            Automate your workflows by connecting CherryWorks Pro to the tools you already use — powered by Zapier. No code required.
          </p>
          <a
            href="https://zapier.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-xl text-base font-semibold transition-all hover:scale-[1.02]"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
            data-testid="link-zapier"
          >
            <ZapierLogo />
            Powered by Zapier
            <ExternalLink className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </a>
        </div>
      </section>

      <section className="pb-24 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">Popular connections</h2>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Automate the busywork between CherryWorks Pro and your favorite tools</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {apps.map((app) => (
              <div
                key={app.name}
                className="rounded-xl p-5 transition-all hover:scale-[1.02] group"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                data-testid={`card-integration-${app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${app.color}20` }}>
                    {app.icon ? (
                      <app.icon className="w-5 h-5" style={{ color: app.color }} />
                    ) : (
                      <span className="text-sm font-bold" style={{ color: app.color }}>{app.label}</span>
                    )}
                  </div>
                  <span className="text-base font-semibold text-white">{app.name}</span>
                </div>
                <div className="space-y-2">
                  {app.zaps.map((zap, j) => (
                    <div key={j} className="flex items-start gap-2">
                      <Zap className="w-3 h-3 mt-1 flex-shrink-0" style={{ color: "#f87171" }} />
                      <span className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{zap}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-24 px-4" data-testid="section-marketing-os-addon">
        <div className="max-w-3xl mx-auto text-center">
          <div className="rounded-2xl p-10" style={{ background: "linear-gradient(135deg, rgba(220,38,38,0.08), rgba(220,38,38,0.02))", border: "1px solid rgba(220,38,38,0.15)" }}>
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }} data-testid="badge-marketing-os-addon">Included in Business plan</span>
            <h3 className="text-2xl font-bold text-white mb-3">Marketing Hub — Prospect / Client Separation</h3>
            <p className="text-sm mb-6 max-w-lg mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
              Contacts &amp; companies CRM, tags, segments, campaigns, sequences, and an activity timeline — included in the Business plan. Marketing prospects live in separate database tables from your billing clients, so a marketing lead can never silently turn into an invoice — no cross-contamination between marketing and billing records, by design.
            </p>
            <Link href="/marketing">
              <span
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                data-testid="link-marketing-os"
              >
                Tour Marketing Hub
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="rounded-2xl p-10" style={{ background: "linear-gradient(135deg, rgba(220,38,38,0.08), rgba(220,38,38,0.02))", border: "1px solid rgba(220,38,38,0.15)" }}>
            <h3 className="text-2xl font-bold text-white mb-3">Start automating today</h3>
            <p className="text-sm mb-6 max-w-lg mx-auto" style={{ color: "rgba(255,255,255,0.5)" }}>
              REST API, webhooks, and Zapier integration are live on every Professional plan. Connect CherryWorks Pro to thousands of apps and automate your workflows.
            </p>
            <Link href="/signup">
              <span
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-lg cursor-pointer transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
                data-testid="button-start-trial-integrations"
              >
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function ZapierLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M15.54 8.46L13.41 10.59L15.54 12.71L13.41 14.84L15.54 16.97L17.66 14.84L19.79 16.97L21.92 14.84L19.79 12.71L21.92 10.59L19.79 8.46L17.66 10.59L15.54 8.46Z" fill="#FF4A00"/>
      <path d="M8.46 8.46L6.34 10.59L4.21 8.46L2.08 10.59L4.21 12.71L2.08 14.84L4.21 16.97L6.34 14.84L8.46 16.97L10.59 14.84L8.46 12.71L10.59 10.59L8.46 8.46Z" fill="#FF4A00"/>
      <path d="M12 2.08L9.88 4.21L12 6.34L14.12 4.21L12 2.08Z" fill="#FF4A00"/>
      <path d="M12 17.66L9.88 19.79L12 21.92L14.12 19.79L12 17.66Z" fill="#FF4A00"/>
    </svg>
  );
}
