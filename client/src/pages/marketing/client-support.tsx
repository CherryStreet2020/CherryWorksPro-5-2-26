import { Link } from "wouter";
import { ArrowRight, CheckCircle, Inbox, KeyRound, Timer, Paperclip, Receipt, Upload, LifeBuoy } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { SEO, FAQStructuredData } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const capabilities = [
  { icon: Inbox, title: "Email becomes a case", desc: "Point your support address at CherryWorks Pro. Every message in that shared Microsoft 365 mailbox becomes a case with a key like ABS-158; replies that carry the key thread onto the same case, attachments included." },
  { icon: KeyRound, title: "A client portal with no passwords", desc: "Clients sign in with a one-time link sent to their email. They see their open and closed cases, reply, attach files, and read their invoices — in your branding, under your domain." },
  { icon: Timer, title: "SLAs per client, business-hours aware", desc: "First-response and resolution targets set per client, counted only inside the hours and timezone you define. The clock pauses when you are waiting on the client. Breaches alert the assignee before they happen." },
  { icon: Receipt, title: "Support time is billable time", desc: "Hours logged on a case are time entries like any other: approved on the timesheet, invoiced to the client, paid out to the person who did the work. No separate export, no reconciliation." },
  { icon: Paperclip, title: "Attachments, notes and history", desc: "Internal notes stay internal; client-visible replies go out by email and appear in the portal. Every status, priority and assignee change is on the case timeline." },
  { icon: Upload, title: "Import from Jira", desc: "Connect a Jira site with an API token and import a project — issues, comments and attachments — into cases. The connection is saved and encrypted, so a re-import is one click." },
];

const faqs = [
  { q: "Do my clients need an account?", a: "No. A client contact you invite receives a one-time sign-in link by email whenever they open the portal. There is nothing to install and no password to reset." },
  { q: "Which plans include Client Support?", a: "Support Cases, the client portal, SLAs and email-to-case are part of the platform on every plan. Unlimited users applies to your team; client contacts are not users." },
  { q: "Can I keep using my existing support email address?", a: "Yes. Connect the Microsoft 365 mailbox that receives it and set it as the support address; CherryWorks Pro reads the inbox and creates or updates cases. Outgoing replies are sent from that mailbox." },
  { q: "How does support time reach the invoice?", a: "Time logged on a case is a normal time entry attached to the client and project. It goes through the same approval and invoicing flow as project time, and the payout to the team member is computed from it." },
  { q: "What is imported from Jira?", a: "Issues with their summary, description, status, priority, reporter, comments and attachments, into cases that keep a reference to the original key." },
];

export default function ClientSupportPage() {
  const fadeRef = useFadeIn();
  return (
    <div>
      <MarketingNav />
      <SEO path="/client-support" />
      <FAQStructuredData faqs={faqs} />
      <section className="pt-[100px] pb-10 md:pb-14" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#f87171" }}>Client Support</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.08]" data-testid="client-support-h1">A support desk that bills</h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Cases, SLAs, a passwordless client portal and email-to-case — built into the same platform that tracks the time, sends the invoice and pays your team. Not a separate tool with a separate login and a separate bill.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link href="/demo"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }} data-testid="client-support-cta-demo">Request a demo <ArrowRight className="w-4 h-4" /></span></Link>
              <Link href="/signup"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>Start free</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section ref={fadeRef} className="py-12 md:py-16 fade-in-section" style={{ background: "#0a0f1c" }} data-testid="section-capabilities">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight text-center mb-12">Everything a client asks for, in the record that already knows them</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.map((c) => (
              <div key={c.title} className="rounded-xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <c.icon className="w-6 h-6 mb-3" style={{ color: "#cf3339" }} />
                <h3 className="text-base font-bold text-white mb-1.5">{c.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight text-center">Why not a help desk product?</h2>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              ["Help desks charge per agent", "CherryWorks Pro has unlimited users on every plan. Your whole team can take a case."],
              ["Help desks don't know your billing", "Here a case belongs to a client with a contract, a project with a budget and a rate card. The hour on the case is the hour on the invoice."],
              ["Help desks need another portal login", "Your clients already have a portal here for invoices and payments. Cases live in the same one, with the same one-time sign-in link."],
              ["Help desks report on tickets", "Here support shows up in utilization, profitability and payouts — the reports your firm actually runs on."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl p-6 flex gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <CheckCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />
                <div><h3 className="text-base font-bold text-white">{t}</h3><p className="text-sm mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16" style={{ background: "#0a0f1c" }} data-testid="section-faq">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight text-center mb-8">Questions firms ask</h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <summary className="text-base font-semibold text-white cursor-pointer">{f.q}</summary>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <LifeBuoy className="w-8 h-8 mx-auto mb-4" style={{ color: "#cf3339" }} />
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">See a case go from email to invoice</h2>
          <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.55)" }}>Twenty minutes, your own scenario, no slides.</p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/demo"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }}>Request a demo <ArrowRight className="w-5 h-5" /></span></Link>
            <Link href="/switch-from-jira-service-management"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>Switching from Jira?</span></Link>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
