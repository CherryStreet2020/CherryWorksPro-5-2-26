import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, Target, Eye, Zap, Layers, DollarSign, Award, User, Rocket, Star, Globe, CheckCircle, Database } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("fade-in-visible"); obs.unobserve(el); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

export default function AboutPage() {
  const storyRef = useFadeIn();
  const missionRef = useFadeIn();
  const timelineRef = useFadeIn();
  const principlesRef = useFadeIn();
  const statsRef = useFadeIn();
  const marketingOsRef = useFadeIn();

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="About"
        fullTitle="About CherryWorks Pro — Built for Professional Services Firms"
        description="Born inside a real consulting firm. CherryWorks Pro was built because we needed it — then we realized every firm like ours did too. 20+ years of industry experience."
        path="/about"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[3px] mb-4" style={{ color: "#cf3339" }}>Our story</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.1]" data-testid="about-heading">
              We didn't study the problem.{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>We lived it.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
              CherryWorks Pro was born inside a real consulting firm — not a product lab, not a startup incubator. 
              We built it because we needed it. Then we realized every firm like ours needed it too.
            </p>
          </div>
        </div>
      </section>

      <section className="pt-4 md:pt-8 pb-8 md:pb-12" style={{ background: "#0a0f1c" }}>
        <div ref={storyRef} className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="space-y-6 text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
            <p>
              We started as a consulting firm — managing enterprise technology projects for clients in manufacturing, IT, and operations. 
              Real clients. Real deadlines. Real teams of 1099 independents, W-2 employees, and Corp-to-Corp partners working side by side.
            </p>
            <p>
              For years, we used FreshBooks for invoicing and time tracking. It worked — until it didn't.
            </p>
            <p className="text-xl font-semibold text-white">
              The breaking point was team payouts.
            </p>
            <p>
              Every month, we'd reconcile invoices against time entries in a spreadsheet, calculate what we owed each team member, 
              send the payments across three different rails, then manually update another spreadsheet so we could file 1099s at year end. 
              One mistake anywhere in the chain and the whole thing broke.
            </p>
            <p>
              We looked at QuickBooks. Too complex for what we needed. Xero. Too generic. 
              Harvest plus Bill.com. Two tools duct-taped together that still couldn't track who got paid for what.
            </p>
            <p>
              Nothing was purpose-built for the workflow every services firm runs every single day: 
            </p>
            <p className="text-xl font-bold text-white pl-4" style={{ borderLeft: "3px solid #cf3339" }}>
              Log time → Invoice client → Collect payment → Pay team member
            </p>
            <p>
              So we built it. What started as an internal tool became something bigger when we showed it to other firm owners 
              and heard the same reaction every time:
            </p>
            <p className="text-xl font-semibold italic" style={{ color: "rgba(255,255,255,0.8)" }}>
              "Why doesn't this exist already?"
            </p>
            <p className="text-lg" style={{ color: "rgba(255,255,255,0.7)" }}>
              Now it does. And after thousands of client engagements, we've poured everything we've learned about 
              running a professional services firm into every feature, every report, and every workflow.
            </p>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div ref={missionRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <p className="text-sm font-bold uppercase tracking-[3px] text-center mb-4" style={{ color: "#cf3339" }}>Our mission</p>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-14 text-white" data-testid="mission-heading">Built on three pillars</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Layers,
                title: "Simplicity",
                tagline: "One platform, not five",
                desc: "Time tracking, invoicing, expenses, payouts, accounting, and reporting — all in one place. No integrations to maintain, no data syncing to debug, no tool-switching fatigue.",
                color: "#3b82f6",
                bg: "rgba(59,130,246,0.1)",
              },
              {
                icon: DollarSign,
                title: "Transparency",
                tagline: "No hidden fees, no per-user charges",
                desc: "Flat pricing on every plan. Unlimited users. No surprise overages. You know exactly what you'll pay before you sign up — and it stays that way.",
                color: "#22c55e",
                bg: "rgba(34,197,94,0.1)",
              },
              {
                icon: Award,
                title: "Professional Grade",
                tagline: "Enterprise features at startup prices",
                desc: "SOC 2 compliance, bank-level encryption, full general ledger, multi-currency support, and 20+ enterprise reports. The features Fortune 500 firms expect, at prices any firm can afford.",
                color: "#eab308",
                bg: "rgba(234,179,8,0.1)",
              },
            ].map((p, i) => (
              <div key={i} className="rounded-2xl p-7 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} data-testid={`mission-pillar-${i}`}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: p.bg }}>
                  <p.icon className="w-7 h-7" style={{ color: p.color }} />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{p.title}</h3>
                <p className="text-sm font-semibold mb-3" style={{ color: p.color }}>{p.tagline}</p>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
        <div ref={timelineRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <p className="text-sm font-bold uppercase tracking-[3px] text-center mb-4" style={{ color: "#cf3339" }}>Our journey</p>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-14 text-white" data-testid="timeline-heading">Company timeline</h2>
          <div className="relative">
            <div className="hidden md:block absolute top-1/2 left-0 right-0 h-px" style={{ background: "rgba(207,51,57,0.2)" }} />
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              {[
                { icon: Star, label: "Founded", desc: "Born inside a real consulting firm", color: "#cf3339" },
                { icon: User, label: "First Client", desc: "Our own firm, our own pain points", color: "#f59e0b" },
                { icon: Rocket, label: "Platform Launch", desc: "Internal tool becomes a product", color: "#3b82f6" },
                { icon: CheckCircle, label: "50+ Features", desc: "Every tool a firm needs, built in", color: "#22c55e" },
                { icon: Globe, label: "SaaS Launch", desc: "Available to every firm, everywhere", color: "#8b5cf6" },
              ].map((m, i) => (
                <div key={i} className="text-center relative" data-testid={`timeline-milestone-${i}`}>
                  <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center relative z-10" style={{ background: `${m.color}15`, border: `2px solid ${m.color}40` }}>
                    <m.icon className="w-5 h-5" style={{ color: m.color }} />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{m.label}</h3>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div ref={principlesRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <p className="text-sm font-bold uppercase tracking-[3px] text-center mb-4" style={{ color: "#cf3339" }}>Our principles</p>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-14 text-white">What we believe</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { icon: Target, title: "Purpose-built beats generic", description: "Software designed for one job outperforms software that tries to do everything. We build exclusively for professional services firms — agencies, consultancies, and every team that bills clients for time." },
              { icon: Eye, title: "Transparency is non-negotiable", description: "Your team members should know when their hours were invoiced and when to expect payment. Your clients should see exactly what they're paying for. No black boxes." },
              { icon: Zap, title: "Automate the paper trail", description: "Every financial event — invoice sent, payment received, payout recorded — creates an auditable record automatically. No manual tracking. No spreadsheet reconciliation. Ever." },
            ].map((v, i) => (
              <div key={i} className="text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: "rgba(207,51,57,0.1)" }}>
                  <v.icon className="w-7 h-7" style={{ color: "#cf3339" }} />
                </div>
                <h3 className="text-lg font-bold mb-3 text-white">{v.title}</h3>
                <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
        <div ref={statsRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center mb-16">
            {[
              { value: "20+", label: "Years of industry experience" },
              { value: "2,000+", label: "Engagements managed" },
              { value: "15+", label: "Industries served" },
              { value: "#1", label: "Fastest-rising PSA" },
            ].map((s, i) => (
              <div key={i}>
                <p className="text-3xl md:text-4xl font-bold text-white">{s.value}</p>
                <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }} data-testid="section-about-marketing-os">
        <div ref={marketingOsRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <p className="text-sm font-bold uppercase tracking-[3px] text-center mb-4" style={{ color: "#cf3339" }}>Beyond billing</p>
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-white" data-testid="about-marketing-os-heading">A prospect-to-client layer, on its own foundation</h2>
          <p className="text-base md:text-lg text-center max-w-2xl mx-auto mb-10" style={{ color: "rgba(255,255,255,0.55)" }}>
            Marketing is included in the Business plan and gives your firm a CRM, campaigns, and sequences — all on dedicated tables that prevent cross-contamination between marketing and billing records.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Layers, title: "Same firm, two clean halves", desc: "Marketing prospects belong to outreach. Billing clients belong to your books. Marketing keeps the line crisp without forcing you to run a second tool." },
              { icon: Database, title: "Prospect / Client Separation", desc: "Marketing data lives in dedicated database tables — no foreign keys to your books, no cross-contamination between marketing and billing records." },
              { icon: ArrowRight, title: "Promote when ready", desc: "When a prospect is ready to become a paying client, promote them into your billing world. Marketing history stays put; nothing leaks the other way." },
            ].map((p, i) => (
              <div key={i} className="rounded-2xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} data-testid={`card-about-marketing-os-${i}`}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(220,38,38,0.12)" }}>
                  <p.icon className="w-6 h-6" style={{ color: "#f87171" }} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{p.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{p.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/marketing">
              <span
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                data-testid="link-about-marketing-os"
              >
                Tour Marketing
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight">Ready to run your firm the way it deserves?</h2>
          <p className="mt-5 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>
            14-day free trial. Full access. Import your data or start fresh — either way, you'll be live in minutes.
          </p>
          <div className="mt-10">
            <Link href="/signup">
              <span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }} data-testid="cta-start-trial">
                Start Your Free Trial <ArrowRight className="w-5 h-5" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
