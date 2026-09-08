
import { useFadeIn } from "@/hooks/use-fade-in";
import { Link } from "wouter";
import { ArrowRight, BookOpen, CheckCircle, Clock, LifeBuoy, Lock, Server, Shield, ShieldCheck, Upload, Users, Zap } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";


function DashboardMockup() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(11,18,34,0.85)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 25px 80px rgba(0,0,0,0.5), 0 0 60px rgba(207,51,57,0.06), inset 0 1px 0 rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
      <div className="flex items-center px-4 py-2" style={{ background: "rgba(7,13,24,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex gap-1.5 mr-4">
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#ff5f57" }} />
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#febc2e" }} />
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#28c840" }} />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="px-8 py-1 rounded-md text-xs" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)" }}>cherryworkspro.com/dashboard</div>
        </div>
      </div>
      <div className="flex">
        <div className="hidden md:block w-[160px] flex-shrink-0 py-3 px-3" style={{ background: "rgba(7,13,24,0.7)", borderRight: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)" }}>
          <div className="px-2 mb-4">
            <BrandLockup iconSize={20} textSize="sm" />
          </div>
          {["Dashboard", "Clients", "Projects", "Time", "Invoices", "Payments", "Payouts", "Reports", "Expenses", "Team"].map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-[5px] rounded text-[10px]" style={{ background: i === 0 ? "rgba(207,51,57,0.12)" : "transparent", color: i === 0 ? "#f87171" : "rgba(255,255,255,0.35)" }}>
              <div className="w-2.5 h-2.5 rounded" style={{ background: i === 0 ? "rgba(207,51,57,0.3)" : "rgba(255,255,255,0.08)" }} />
              {item}
            </div>
          ))}
          <div className="mt-4 mx-2 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold" style={{ background: "#cf3339", color: "#fff" }}>AM</div>
              <div>
                <p className="text-[10px] font-medium text-white">Alex M.</p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>ADMIN</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 p-3">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5 mb-3">
            {[
              { label: "REVENUE MTD", value: "$47,850", sub: "+14% vs last month", color: "#22c55e" },
              { label: "COLLECTED", value: "$38,200", sub: "", color: "#3b82f6" },
              { label: "OUTSTANDING", value: "$12,650", sub: "6 invoices", color: "#f59e0b" },
              { label: "OVERDUE", value: "$3,200", sub: "2 invoices", color: "#ef4444" },
              { label: "NET CASH", value: "$34,100", sub: "+11%", color: "#22c55e" },
              { label: "TEAM", value: "12", sub: "3 pending", color: "#a855f7" },
            ].map((kpi, i) => (
              <div key={i} className="kpi-card rounded-lg p-2 relative overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(8px)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 50%, transparent 60%)", animationName: "kpiShimmer", animationDuration: "3s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationDelay: `${i * 0.3}s` }} />
                <p className="text-[12px] font-bold uppercase tracking-wider mb-0.5 relative" style={{ color: "rgba(255,255,255,0.3)" }}>{kpi.label}</p>
                <p className="text-[13px] font-bold tabular-nums relative" style={{ color: kpi.color }}>{kpi.value}</p>
                {kpi.sub && <p className="text-[11px] relative" style={{ color: "rgba(255,255,255,0.25)" }}>{kpi.sub}</p>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Revenue Trend</p>
                <span className="text-[11px] px-1 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>+12%</span>
              </div>
              <svg viewBox="0 0 240 65" className="w-full">
                <defs>
                  <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#cf3339" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#cf3339" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0,40,80,120,160,200,240].map(x => (
                  <line key={x} x1={x} y1="0" x2={x} y2="65" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                ))}
                {[0,16,32,48,65].map(y => (
                  <line key={y} x1="0" y1={y} x2="240" y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
                ))}
                <path d="M0,55 C20,52 30,48 50,45 C70,42 80,46 100,40 C120,34 140,30 160,24 C180,18 200,14 220,11 L240,8" fill="none" stroke="#cf3339" strokeWidth="1.5" />
                <path d="M0,55 C20,52 30,48 50,45 C70,42 80,46 100,40 C120,34 140,30 160,24 C180,18 200,14 220,11 L240,8 L240,65 L0,65Z" fill="url(#rg)" />
                {[[0,55],[50,45],[100,40],[160,24],[240,8]].map(([x,y],i) => (
                  <circle key={i} cx={x} cy={y} r="2" fill="#cf3339" />
                ))}
              </svg>
              <div className="flex justify-between mt-1">
                {["Oct","Nov","Dec","Jan","Feb","Mar"].map(m => (
                  <span key={m} className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>{m}</span>
                ))}
              </div>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-[10px] font-bold uppercase mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Team Utilization</p>
              <div className="space-y-2">
                {[
                  { name: "Sarah Kim", init: "SK", pct: 92, color: "#22c55e" },
                  { name: "Mike Rivera", init: "MR", pct: 85, color: "#22c55e" },
                  { name: "Anna Lopez", init: "AL", pct: 68, color: "#f59e0b" },
                  { name: "James Torres", init: "JT", pct: 54, color: "#f59e0b" },
                  { name: "Li Chen", init: "LC", pct: 41, color: "#ef4444" },
                ].map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `${p.color}20`, color: p.color }}>{p.init}</div>
                    <span className="text-[12px] w-14 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{p.name}</span>
                    <div className="flex-1 h-[5px] rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${p.pct}%`, background: p.color }} />
                    </div>
                    <span className="text-[12px] font-sans tabular-nums w-6 text-right" style={{ color: p.color }}>{p.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] font-bold uppercase mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Needs Attention</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Pending Timesheets", value: "3", color: "#f59e0b" },
                { label: "Pending Payouts", value: "$2,450", color: "#ef4444" },
                { label: "Overdue Invoices", value: "1", color: "#ef4444" },
                { label: "Unbilled Hours", value: "42.5h", color: "#3b82f6" },
              ].map((a, i) => (
                <div key={i} className="flex items-center gap-2 p-1.5 rounded" style={{ background: `${a.color}08` }}>
                  <div className="w-1 h-6 rounded-full" style={{ background: a.color }} />
                  <div>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>{a.label}</p>
                    <p className="text-xs font-bold" style={{ color: a.color }}>{a.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustBadges() {
  const fadeRef = useFadeIn();
  const badges = [
    { icon: Lock, label: "AES-256 Encryption" },
    { icon: ShieldCheck, label: "Org-Scoped Isolation" },
    { icon: Server, label: "Daily Backups" },
    { icon: Shield, label: "MFA & Audit Logging" },
  ];
  return (
    <div ref={fadeRef} className="py-10 fade-in-section" style={{ background: "rgba(255,255,255,0.015)" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-4">
          {badges.map((b, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(207,51,57,0.1)", border: "1px solid rgba(207,51,57,0.15)" }}>
                <b.icon className="w-4 h-4" style={{ color: "#cf3339" }} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.55)" }}>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupSection() {
  const fadeRef = useFadeIn();
  return (
    <section ref={fadeRef} className="py-8 md:py-12 relative overflow-hidden fade-in-section" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 100%)" }}>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full opacity-10 pointer-events-none" style={{ background: "radial-gradient(circle, #22c55e 0%, transparent 70%)", filter: "blur(80px)" }} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Most firms are up and running before their coffee gets cold
          </h2>
          <p className="mt-4 text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.5)" }}>
            Starting fresh or switching from another platform &mdash; either way, a guided wizard walks you through every step. No implementation specialists. No training videos. No 6-week rollout.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto mb-14">
          <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}>
              <Zap className="w-7 h-7" style={{ color: "#22c55e" }} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Starting Fresh?</h3>
            <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              The setup wizard walks you through everything: firm profile, services, your first client, team invites. No existing data required. You'll be billing clients in minutes.
            </p>
          </div>
          <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.12)" }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
              <Upload className="w-7 h-7" style={{ color: "#3b82f6" }} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Switching Platforms?</h3>
            <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Import wizards for FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, and Paymo. Upload, preview, execute. Your history comes with you.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {[
            { step: "1", time: "60 sec", title: "Sign Up", desc: "Name, email, password. That's it. No sales call. No 'let us get back to you.'" },
            { step: "2", time: "3 min", title: "Setup Wizard", desc: "The guided wizard walks you through firm details, services, your first client, and team invites. Skip what you don't need." },
            { step: "3", time: "2 min", title: "Import or Build", desc: "Bring data from another platform, or start building from scratch. Either way, it takes minutes." },
            { step: "4", time: "Day 1", title: "You're Live", desc: "Your team tracks time. You generate invoices. Clients pay online. Reports run themselves. Payouts calculated automatically." },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center text-lg font-bold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>{s.step}</div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{s.time}</span>
              <h4 className="text-base font-bold text-white mt-3 mb-2">{s.title}</h4>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <p className="text-sm font-medium mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
            Switching from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, or Paymo? Import wizards included.
          </p>
          <Link href="/signup">
            <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}>
              Start Now — You'll Be Live Today <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

const PILLARS = [
  {
    icon: Clock, title: "Time & Billing", href: "/features",
    desc: "Track time, approve timesheets, turn approved hours into invoices — recurring, multi-currency, sent from your own mailbox.",
    points: ["Timer or manual entry, per-project rates", "Weekly approval workflow, locked after approval", "Invoices generated from approved time"],
  },
  {
    icon: BookOpen, title: "Books", href: "/features",
    desc: "A real general ledger under everything: every invoice, payment, expense and payout posts itself. Close periods. Reconcile the bank.",
    points: ["Full GL with journal entries and trial balance", "AR aging, cash flow, close periods", "AI receipt scanning → posted expense"],
  },
  {
    icon: Users, title: "Team & Payouts", href: "/features",
    desc: "1099 contractors, W-2 staff and corp-to-corp on one team. Payouts computed from what was actually billed and collected.",
    points: ["Unlimited users on every plan", "Payouts + reimbursements, one balance per person", "1099 export at year end"],
  },
  {
    icon: LifeBuoy, title: "Client Support", href: "/client-support", featured: true,
    desc: "A support desk that knows your clients, your projects and your billing. Cases, SLAs, a passwordless client portal, email-to-case.",
    points: ["Cases from email, portal or your team", "SLAs per client, business hours aware", "Support time flows straight to invoices"],
  },
];

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle, #cf3339 0%, transparent 70%)" }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8 md:pt-4 md:pb-10">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#f87171" }}>For agencies, consultancies and service firms</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-[1.08] tracking-tight" data-testid="home-h1">
            The professional services platform with a <span style={{ color: "#cf3339" }}>support desk built in</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
            Time, invoicing, books, payouts and client support in one system — so the hour your team spends on a client&rsquo;s ticket ends up on the invoice, in the ledger and in the payout, without anyone re-typing it.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-start gap-4">
            <Link href="/signup">
              <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)", boxShadow: "0 8px 30px rgba(207,51,57,0.35)" }} data-testid="hero-cta-signup">
                Start free — 14 days, unlimited users
                <ArrowRight className="w-4.5 h-4.5" />
              </span>
            </Link>
            <Link href="/demo">
              <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer transition-colors hover:bg-white/5" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }} data-testid="hero-cta-demo">
                Request a demo
              </span>
            </Link>
          </div>
          <p className="mt-4 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Flat pricing from $39/mo · No per-user fees · Import from 8 platforms</p>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <DashboardMockup />
      </div>
    </section>
  );
}

function FourPillars() {
  const fadeRef = useFadeIn();
  return (
    <section ref={fadeRef} className="py-12 md:py-16 fade-in-section" style={{ background: "#0a0f1c" }} data-testid="section-pillars">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">Four things every services firm runs on. One place.</h2>
          <p className="mt-4 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.5)" }}>Most tools do one of these and hand you a CSV for the rest. CherryWorks Pro does all four on the same records.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {PILLARS.map((p) => (
            <Link key={p.title} href={p.href}>
              <div className="h-full rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1 cursor-pointer" style={{ background: p.featured ? "linear-gradient(135deg, rgba(207,51,57,0.16), rgba(255,255,255,0.03))" : "rgba(255,255,255,0.03)", border: p.featured ? "1px solid rgba(207,51,57,0.45)" : "1px solid rgba(255,255,255,0.08)" }} data-testid={`pillar-${p.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                <div className="flex items-center gap-3 mb-3">
                  <p.icon className="w-6 h-6" style={{ color: "#cf3339" }} />
                  <h3 className="text-xl font-bold text-white">{p.title}</h3>
                  {p.featured && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md" style={{ background: "#cf3339", color: "#fff" }}>New</span>}
                </div>
                <p className="text-base leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>{p.desc}</p>
                <ul className="space-y-1.5">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}><CheckCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />{pt}</li>
                  ))}
                </ul>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function SupportSpotlight() {
  const fadeRef = useFadeIn();
  const steps = [
    { n: "1", title: "A client emails support", desc: "The message lands in your shared mailbox and becomes a case with a key like ABS-158 — no forwarding, no copy-paste." },
    { n: "2", title: "Your team works it", desc: "Priority, assignee, SLA clock (first response and resolution, business-hours aware), internal notes vs. client-visible replies, attachments." },
    { n: "3", title: "The client follows along", desc: "A branded portal, signed in by magic link — no passwords to reset. They see status, replies and their invoices in one place." },
    { n: "4", title: "The time gets billed", desc: "Hours logged on the case flow to the client&rsquo;s invoice and into payouts, like every other hour in the system." },
  ];
  return (
    <section ref={fadeRef} className="py-12 md:py-16 fade-in-section" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }} data-testid="section-support">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#f87171" }}>Client Support</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">The help desk that already knows who pays the invoice</h2>
            <p className="mt-4 text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Jira Service Management, Zendesk and Freshdesk were built for support departments. Your firm bills for support. CherryWorks Pro treats a case like what it is: client work with a clock, a contract and an invoice attached.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link href="/client-support"><span className="inline-flex items-center gap-2 px-6 py-3.5 text-base font-bold text-white rounded-xl cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }}>See Client Support <ArrowRight className="w-4 h-4" /></span></Link>
              <Link href="/switch-from-jira-service-management"><span className="inline-flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>Moving from Jira? Import your project</span></Link>
            </div>
          </div>
          <ol className="space-y-4">
            {steps.map((s) => (
              <li key={s.n} className="flex gap-4 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-black text-white" style={{ background: "#cf3339" }}>{s.n}</span>
                <div>
                  <h3 className="text-base font-bold text-white">{s.title}</h3>
                  <p className="text-sm leading-relaxed mt-1" style={{ color: "rgba(255,255,255,0.5)" }} dangerouslySetInnerHTML={{ __html: s.desc }} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function ProofStrip() {
  const facts = [
    { value: "Unlimited", label: "users on every plan" },
    { value: "19", label: "built-in reports across 6 categories" },
    { value: "8", label: "platforms you can import from" },
    { value: "$39", label: "per month, flat, to start" },
  ];
  return (
    <section className="py-10" style={{ background: "#0a0f1c", borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid="section-proof">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {facts.map((f) => (
          <div key={f.label}>
            <p className="text-3xl md:text-4xl font-black text-white">{f.value}</p>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>{f.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="py-12 md:py-16" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Run the whole firm on one set of records</h2>
        <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.55)" }}>Fourteen days free with everything on. Import your clients, projects, time and invoices from the tool you use today.</p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/signup"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)", boxShadow: "0 8px 30px rgba(207,51,57,0.35)" }}>Start free <ArrowRight className="w-5 h-5" /></span></Link>
          <Link href="/demo"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold rounded-xl cursor-pointer transition-colors hover:bg-white/5" style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.15)" }}>Request a demo</span></Link>
        </div>
        <p className="mt-5 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>You won&rsquo;t be charged until day 15 · Cancel anytime · Your data exports with you</p>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div>
      <MarketingNav />
      <SEO path="/" />
      <HeroSection />
      <FourPillars />
      <SupportSpotlight />
      <ProofStrip />
      <SetupSection />
      <TrustBadges />
      <CtaSection />
      <MarketingFooter />
    </div>
  );
}
