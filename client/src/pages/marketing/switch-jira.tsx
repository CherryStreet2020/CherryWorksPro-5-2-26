import { Link } from "wouter";
import { ArrowRight, CheckCircle, XCircle, Upload } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const painPoints = [
  { pain: "Priced per agent", fix: "Every plan here has unlimited users. Anyone on the team can pick up a case — the person who did the project work usually should." },
  { pain: "Support lives apart from billing", fix: "A case belongs to a client, a project and a rate. Hours logged on it are approved, invoiced and paid out with everything else." },
  { pain: "Another portal, another set of credentials", fix: "Your clients already have a portal for invoices and payments. Cases are in the same one, opened with a one-time link." },
  { pain: "Reports about tickets, not about the firm", fix: "Support shows up where you run the business: utilization, project profitability, payouts, AR." },
  { pain: "Built for IT departments", fix: "No queues, request types or automation rules to configure before a client can email you. Point the mailbox at it and the first case exists." },
];

const comparison: Array<{ feature: string; cw: boolean; jira: boolean | "partial" }> = [
  { feature: "Unlimited team members (no per-agent fee)", cw: true, jira: false },
  { feature: "Email-to-case from your existing mailbox", cw: true, jira: true },
  { feature: "Passwordless client portal (magic link)", cw: true, jira: "partial" },
  { feature: "SLAs per client, business-hours aware", cw: true, jira: true },
  { feature: "Time on a case flows to the client invoice", cw: true, jira: false },
  { feature: "Payouts to the team from case time", cw: true, jira: false },
  { feature: "Same portal shows the client's invoices and payments", cw: true, jira: false },
  { feature: "General ledger, AR aging, profitability reports", cw: true, jira: false },
  { feature: "Import existing issues, comments and attachments", cw: true, jira: true },
];

const steps = [
  "Connect: Support → Settings → enter your Jira site, project key, email and API token. The token is stored encrypted.",
  "Import: issues become cases (status, priority, reporter, comments, attachments), each keeping a reference to its Jira key.",
  "Switch the mailbox: point your support address at the connected Microsoft 365 mailbox. New emails become cases from that moment.",
  "Invite clients: each contact gets a portal link by email. No accounts to create on their side.",
];

export default function SwitchJiraPage() {
  const fadeRef = useFadeIn();
  return (
    <div>
      <MarketingNav />
      <SEO path="/switch-from-jira-service-management" />
      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#f87171" }}>Switch from Jira Service Management</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.08]" data-testid="switch-jira-h1">Jira runs a service desk. Your firm bills for service.</h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              If every support hour you deliver should end up on an invoice, a help desk that knows nothing about your clients&rsquo; contracts is the wrong shape. Move the project — issues, comments, attachments — into CherryWorks Pro and keep the email address.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link href="/demo"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }}>Request a demo <ArrowRight className="w-4 h-4" /></span></Link>
              <Link href="/client-support"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>See Client Support</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section ref={fadeRef} className="py-10 md:py-14 fade-in-section" style={{ background: "#0a0f1c" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight text-center mb-10">Where it stops fitting a services firm</h2>
          <div className="space-y-4">
            {painPoints.map((p) => (
              <div key={p.pain} className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex gap-3"><XCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#f87171" }} /><p className="text-base text-white font-semibold">{p.pain}</p></div>
                <div className="flex gap-3"><CheckCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#22c55e" }} /><p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{p.fix}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }} data-testid="section-comparison">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight text-center mb-8">Side by side</h2>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="grid grid-cols-[1fr_auto_auto] text-xs font-bold uppercase tracking-wider px-5 py-3" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>
              <span>Capability</span><span className="w-28 text-center">CherryWorks Pro</span><span className="w-28 text-center">Jira SM</span>
            </div>
            {comparison.map((c) => (
              <div key={c.feature} className="grid grid-cols-[1fr_auto_auto] items-center px-5 py-3 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)" }}>
                <span>{c.feature}</span>
                <span className="w-28 flex justify-center"><CheckCircle className="w-5 h-5" style={{ color: "#22c55e" }} /></span>
                <span className="w-28 flex justify-center">{c.jira === true ? <CheckCircle className="w-5 h-5" style={{ color: "rgba(255,255,255,0.4)" }} /> : c.jira === "partial" ? <span className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>with setup</span> : <XCircle className="w-5 h-5" style={{ color: "#f87171" }} />}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Jira Service Management capabilities as documented by Atlassian for its cloud plans; check your plan for specifics.</p>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "#0a0f1c" }} data-testid="section-import">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 justify-center mb-8"><Upload className="w-6 h-6" style={{ color: "#cf3339" }} /><h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Moving a project takes an afternoon</h2></div>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-4 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-black text-white" style={{ background: "#cf3339" }}>{i + 1}</span>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>{s}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-12 md:py-16" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Bring the project. Keep the email address.</h2>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/demo"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }}>Request a demo <ArrowRight className="w-5 h-5" /></span></Link>
            <Link href="/signup"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>Start free</span></Link>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
