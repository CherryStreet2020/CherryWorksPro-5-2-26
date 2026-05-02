import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  Clock, DollarSign, BarChart3, Users, Shield, FileText, CheckCircle, ArrowRight,
  Zap, TrendingUp, ChevronRight, UserCheck, Receipt, FileStack, CreditCard,
  Upload, Eye, Send, Star, X, Briefcase, Globe, Lock, Repeat, Award, Building2, ShieldCheck, Database, Fingerprint, Bot,
  BookOpen, ScanLine, ClipboardCheck, Layers, Sparkles, ShieldAlert, Server, Scale,
} from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO, BusinessStructuredData, OrganizationStructuredData } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("fade-in-visible"); obs.unobserve(el); } },
      { threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

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

function ExpenseMockup() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0b1222", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
      <div className="flex items-center px-4 py-2" style={{ background: "#070d18", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex gap-1.5 mr-4">
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#ff5f57" }} />
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#febc2e" }} />
          <div className="w-[10px] h-[10px] rounded-full" style={{ background: "#28c840" }} />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="px-8 py-1 rounded-md text-xs" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)" }}>cherryworkspro.com/expenses</div>
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] font-bold text-white">Expenses</p>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Manage all team expenses</p>
          </div>
          <div className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>+ New Expense</div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {[
            { label: "TOTAL SHOWN", value: "$4,285.50", sub: "18 expenses" },
            { label: "PENDING APPROVAL", value: "3", sub: "", accent: "#3b82f6" },
            { label: "DRAFTS", value: "5", sub: "", accent: "#f59e0b" },
          ].map((s, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</p>
              <p className="text-[12px] font-bold" style={{ color: s.accent || "white" }}>{s.value}</p>
              {s.sub && <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>{s.sub}</p>}
            </div>
          ))}
        </div>
        <div className="flex gap-1 mb-2">
          {["All", "Draft", "Submitted", "Approved", "Rejected"].map((f, i) => (
            <span key={i} className="text-[12px] px-2 py-0.5 rounded-full font-medium" style={{ background: i === 0 ? "rgba(207,51,57,0.15)" : "rgba(255,255,255,0.04)", color: i === 0 ? "#f87171" : "rgba(255,255,255,0.35)" }}>{f}</span>
          ))}
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="grid grid-cols-12 gap-0 px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)" }}>
            {["DATE","SUBMITTED BY","VENDOR","CATEGORY","PROJECT","AMOUNT","STATUS","FLAGS"].map((h,i) => {
              const spans = [1,2,2,1,1,1,2,2];
              return <span key={i} className={`text-[11px] font-bold uppercase tracking-wider col-span-${spans[i]}`} style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>;
            })}
          </div>
          {[
            { date: "Mar 28", who: "Sarah Kim", init: "SK", vendor: "Delta Airlines", cat: "Travel", proj: "Acme Redesign", amount: "$485.00", status: "APPROVED", sColor: "#22c55e", flags: ["BILL","REIMB","RCPT"] },
            { date: "Mar 27", who: "Mike Rivera", init: "MR", vendor: "AWS", cat: "Software", proj: "DataSync", amount: "\u20ac129.99", status: "SUBMITTED", sColor: "#3b82f6", flags: ["REIMB"] },
            { date: "Mar 26", who: "Anna Lopez", init: "AL", vendor: "Hilton Hotels", cat: "Travel", proj: "Summit Prep", amount: "\u00a3312.00", status: "DRAFT", sColor: "#6b7280", flags: ["BILL","REIMB"] },
            { date: "Mar 25", who: "James Torres", init: "JT", vendor: "Uber", cat: "Transport", proj: "Client Visit", amount: "$47.50", status: "REIMBURSED", sColor: "#a855f7", flags: ["REIMB","RCPT"] },
            { date: "Mar 24", who: "Li Chen", init: "LC", vendor: "Figma", cat: "Software", proj: "\u2014", amount: "$15.00", status: "APPROVED", sColor: "#22c55e", flags: [] },
          ].map((row, i) => (
            <div key={i} className="grid grid-cols-12 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              <span className="text-[12px] col-span-1 tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>{row.date}</span>
              <div className="flex items-center gap-1 col-span-2 min-w-0">
                <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: `${row.sColor}20`, color: row.sColor }}>{row.init}</div>
                <span className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{row.who}</span>
              </div>
              <span className="text-[10px] font-medium text-white col-span-2 truncate">{row.vendor}</span>
              <span className="text-[12px] col-span-1" style={{ color: "rgba(255,255,255,0.4)" }}>{row.cat}</span>
              <span className="text-[12px] col-span-1 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{row.proj}</span>
              <span className="text-[10px] font-sans tabular-nums font-medium text-white col-span-1 text-right">{row.amount}</span>
              <span className="col-span-2 text-center">
                <span className="px-1 py-0.5 rounded-full text-[11px] font-bold" style={{ background: `${row.sColor}12`, color: row.sColor }}>{row.status}</span>
              </span>
              <div className="col-span-2 flex gap-0.5 justify-end">
                {row.flags.map((f,j) => (
                  <span key={j} className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: f === "BILL" ? "rgba(34,197,94,0.1)" : f === "RCPT" ? "rgba(168,85,247,0.1)" : "rgba(59,130,246,0.1)", color: f === "BILL" ? "#22c55e" : f === "RCPT" ? "#a855f7" : "#3b82f6" }}>{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function SocialProofTicker() {
  return (
    <div className="relative py-4 overflow-hidden" style={{ background: "rgba(207,51,57,0.04)", borderTop: "1px solid rgba(207,51,57,0.08)", borderBottom: "1px solid rgba(207,51,57,0.08)" }}>
      <div className="flex items-center justify-center gap-3 px-4">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#cf3339", animation: "social-proof-glow 2.5s ease-in-out infinite" }} />
        <p className="text-sm font-medium tracking-wide" style={{ color: "rgba(255,255,255,0.6)" }}>
          Trusted by consulting firms, agencies, and freelancers</p>
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#cf3339", animationName: "social-proof-glow", animationDuration: "2.5s", animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationDelay: "1.25s" }} />
      </div>
    </div>
  );
}

function useCountUp(target: number, duration: number = 1800) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const steps = 40;
    const stepTime = duration / steps;
    let current = 0;
    const timer = setInterval(() => {
      current++;
      const progress = current / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (current >= steps) { setCount(target); clearInterval(timer); }
    }, stepTime);
    return () => clearInterval(timer);
  }, [started, target, duration]);

  return { count, ref, started };
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle, #cf3339 0%, transparent 70%)", filter: "blur(100px)" }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8 md:pt-4 md:pb-10">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-[1.08] tracking-tight">
            Run your firm like a{" "}
            <span className="relative inline-block">
              <span style={{ color: "#cf3339" }}>Fortune 500</span>
              <svg className="absolute -bottom-1 left-0 w-full" viewBox="0 0 200 8" fill="none"><path d="M0 6C50 0 150 0 200 6" stroke="#cf3339" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
            {" "}&mdash;{" "}without the Fortune 500 price tag
          </h1>
          <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
            You didn't start your firm to chase spreadsheets at midnight. You started it to do great work. We handle the rest &mdash; time, invoicing, payouts, accounting, and every report you've always wanted.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-start gap-4">
            <Link href="/signup">
              <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", animation: "cta-pulse 2.5s ease-in-out infinite" }} data-testid="hero-cta-start-free">
                Start Free &mdash; 14 Days, Zero Risk
                <ArrowRight className="w-4.5 h-4.5" />
              </span>
            </Link>
            <Link href="/features">
              <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer transition-colors hover:bg-white/5" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>
                Explore the Full Platform
              </span>
            </Link>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <DashboardMockup />
      </div>
    </section>
  );
}

function BeforeAfterSection() {
  const fadeRef = useFadeIn();
  const befores = [
    "Juggling 4-5 separate tools",
    "Chasing invoices in spreadsheets",
    "No idea which projects are profitable",
    "Manual expense tracking via email",
    "Paying $142+/mo for FreshBooks + add-ons",
  ];
  const afters = [
    "One platform. Everything integrated.",
    "Invoices sent, tracked, and paid automatically",
    "Real-time profitability by project, client, and team",
    "AI receipt scanning + approval workflows",
    "Starting at $39/mo. Unlimited users.",
  ];
  return (
    <section ref={fadeRef} className="py-8 md:py-12 fade-in-section" style={{ background: "linear-gradient(180deg, #0a0f1c 0%, #0f172a 100%)" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">Your firm <span style={{ color: "#cf3339" }}>before</span> vs. <span style={{ color: "#22c55e" }}>after</span> CherryWorks Pro</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl p-7 md:p-8" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-bold uppercase tracking-[2px] mb-6" style={{ color: "rgba(255,255,255,0.3)" }}>Before</p>
            <div className="space-y-4">
              {befores.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(239,68,68,0.1)" }}>
                    <X className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                  </div>
                  <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl p-7 md:p-8" style={{ background: "rgba(207,51,57,0.04)", border: "1px solid rgba(207,51,57,0.15)" }}>
            <p className="text-xs font-bold uppercase tracking-[2px] mb-6" style={{ color: "#cf3339" }}>After</p>
            <div className="space-y-4">
              {afters.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(34,197,94,0.12)" }}>
                    <CheckCircle className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                  </div>
                  <p className="text-base font-medium leading-relaxed text-white">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatItem({ num, suffix, subtitle, icon: Icon }: { num: number; suffix: string; subtitle: string; icon: any }) {
  const { count, ref, started } = useCountUp(num);
  return (
    <div ref={ref} className="flex flex-col items-center text-center gap-1">
      <Icon className="w-5 h-5 mb-1" style={{ color: "#cf3339" }} />
      <p className="text-3xl md:text-4xl font-bold text-white tabular-nums" style={{ animation: started ? "count-fade-in 0.6s ease-out" : "none" }}>
        {started ? count : 0}{suffix}
      </p>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>{subtitle}</p>
    </div>
  );
}

function UnlimitedStatItem() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex flex-col items-center text-center gap-1">
      <Users className="w-5 h-5 mb-1" style={{ color: "#cf3339" }} />
      <p className="text-3xl md:text-4xl font-bold text-white" style={{ animation: visible ? "count-fade-in 0.6s ease-out" : "none" }}>{"\u221E"}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>Unlimited users</p>
    </div>
  );
}

function StatsBar() {
  return (
    <section className="py-10 md:py-12" style={{ background: "var(--color-brand-900)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <StatItem num={50} suffix="+" subtitle="Features included" icon={Zap} />
          <StatItem num={8} suffix="" subtitle="Platform imports" icon={Upload} />
          <StatItem num={20} suffix="+" subtitle="Built-in reports" icon={Globe} />
          <div className="flex flex-col items-center text-center gap-1">
            <Bot className="w-5 h-5 mb-1" style={{ color: "#cf3339" }} />
            <p className="text-3xl md:text-4xl font-bold text-white">24/7</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>AI support agent</p>
          </div>
          <UnlimitedStatItem />
        </div>
      </div>
    </section>
  );
}

function WhatsNewSection() {
  const features = [
    {
      icon: ClipboardCheck,
      title: "Expense Reports with Full Approval Workflow",
      desc: "Team members submit expense reports. Admins approve or reject with one click. Approved expenses auto-post to the general ledger and create team payouts.",
      flagship: true,
      accent: "#cf3339",
    },
    {
      icon: ScanLine,
      title: "AI Receipt Scanner",
      desc: "Snap a photo, drop a PDF. Our AI reads the vendor, amount, date, and category instantly. Expenses go from photo to ledger in seconds.",
      flagship: false,
      accent: "#a855f7",
    },
    {
      icon: Building2,
      title: "Stripe ACH + Connect Payouts",
      desc: "Accept bank transfers from clients and pay team members directly through Stripe Connect — all automated",
      flagship: false,
      accent: "#6366f1",
    },
    {
      icon: Upload,
      title: "One-Click Migration from 8 Platforms",
      desc: "Import from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, and Paymo. Enterprise-grade audit trail, dry-run verification, and one-click rollback. Migration has never been this safe.",
      flagship: false,
      accent: "#22c55e",
    },
    {
      icon: Layers,
      title: "Group Invoices Your Way",
      desc: "Group invoice line items by team member, project, service, or show them flat. Your clients see exactly what they need.",
      flagship: false,
      accent: "#f59e0b",
    },
    {
      icon: Sparkles,
      title: "Auto-Post Everything to GL",
      desc: "Invoices, payments, expenses, and payouts automatically create journal entries. Your books are always up to date without lifting a finger.",
      flagship: false,
      accent: "#ec4899",
    },
    {
      icon: BookOpen,
      title: "Full General Ledger with Bank Reconciliation",
      desc: "Double-entry accounting built in. Chart of accounts, journal entries, trial balance, and bank reconciliation that syncs every transaction automatically. No more exporting to QuickBooks.",
      flagship: false,
      accent: "#3b82f6",
    },
  ];

  return (
    <section className="py-8 md:py-12 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #0a0f1c 0%, #140a1a 35%, #1a0a0d 65%, #0f172a 100%)" }}>
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, transparent 0%, #cf3339 30%, #e74c3c 50%, #cf3339 70%, transparent 100%)" }} />
      <div className="absolute top-20 right-10 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none" style={{ background: "radial-gradient(circle, #cf3339 0%, transparent 70%)", filter: "blur(100px)" }} />
      <div className="absolute bottom-20 left-10 w-[300px] h-[300px] rounded-full opacity-[0.04] pointer-events-none" style={{ background: "radial-gradient(circle, #a855f7 0%, transparent 70%)", filter: "blur(80px)" }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.25)" }}>
            <Sparkles className="w-3.5 h-3.5" style={{ color: "#f87171" }} />
            <span className="text-xs font-bold uppercase tracking-[2px]" style={{ color: "#f87171" }}>Just Shipped</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white leading-tight">
            Enterprise-Grade Features That Leave<br />
            <span style={{ color: "#cf3339" }}>The Competition Behind</span>
          </h2>
          <p className="mt-5 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
            Newly added capabilities that transform CherryWorks Pro from a billing tool into a complete financial operating system. None of these exist in FreshBooks, Harvest, or BigTime.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {features.map((f, i) => {
            const Icon = f.icon;
            if (f.flagship) {
              return (
                <div
                  key={i}
                  className="lg:col-span-12 rounded-2xl p-8 md:p-10 transition-all hover:-translate-y-1 relative overflow-hidden group"
                  style={{
                    background: "linear-gradient(135deg, rgba(207,51,57,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(207,51,57,0.04) 100%)",
                    border: "1px solid rgba(207,51,57,0.2)",
                    boxShadow: "0 8px 40px rgba(207,51,57,0.08)",
                  }}
                >
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: "linear-gradient(90deg, #cf3339, #e74c3c, #cf3339)" }} />
                  <div className="absolute top-4 right-6">
                    <span className="text-[10px] font-bold uppercase tracking-[2px] px-3 py-1 rounded-full" style={{ background: "rgba(207,51,57,0.15)", color: "#f87171", border: "1px solid rgba(207,51,57,0.25)" }}>Flagship</span>
                  </div>
                  <div className="flex flex-col md:flex-row items-start gap-6">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.12)", boxShadow: "0 4px 20px rgba(207,51,57,0.15)" }}>
                      <Icon className="w-8 h-8" style={{ color: "#cf3339" }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl md:text-2xl font-bold text-white mb-3">{f.title}</h3>
                      <p className="text-base md:text-lg leading-relaxed max-w-3xl" style={{ color: "rgba(255,255,255,0.6)" }}>{f.desc}</p>
                      <div className="flex flex-wrap gap-3 mt-5">
                        {["Submit & Approve", "Batch Reports", "Auto-Reimburse", "GL Posting", "Team Payouts"].map(tag => (
                          <span key={tag} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg" style={{ background: "rgba(207,51,57,0.1)", color: "#f87171", border: "1px solid rgba(207,51,57,0.15)" }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            const colClass = i <= 2 ? "lg:col-span-4" : "lg:col-span-4";
            return (
              <div
                key={i}
                className={`${colClass} rounded-2xl p-6 md:p-7 transition-all duration-300 hover:-translate-y-1.5 relative overflow-hidden`}
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(0,0,0,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.15)"; }}
              >
                <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: `linear-gradient(90deg, ${f.accent}, transparent)` }} />
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: `${f.accent}15` }}>
                  <Icon className="w-5.5 h-5.5" style={{ color: f.accent }} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{f.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-12">
          <Link href="/features">
            <span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.35)" }}>
              Explore All Features <ArrowRight className="w-4.5 h-4.5" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function DemoTeaser() {
  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <Link href="/demo">
          <div className="group rounded-2xl p-8 md:p-12 cursor-pointer transition-all hover:scale-[1.01]" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: "rgba(207,51,57,0.1)" }}>
              <Eye className="w-8 h-8" style={{ color: "#cf3339" }} />
            </div>
            <h2 className="text-2xl md:text-4xl font-bold text-white mb-3">Explore the Full Tour</h2>
            <p className="text-base md:text-lg mb-6 max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.5)" }}>
              Walk through every feature at your own pace — from time tracking and invoicing to reports and payouts. No signup required.
            </p>
            <span className="inline-flex items-center gap-2 text-base font-bold transition-all group-hover:gap-3" style={{ color: "#f87171" }}>
              Take the Product Tour <ArrowRight className="w-5 h-5" />
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}

function WhySwitch() {
  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0a0f1c 0%, #0f172a 100%)" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-bold uppercase tracking-[3px] mb-10" style={{ color: "#cf3339" }}>Why firms switch</p>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { icon: Users, title: "Zero per-user fees", body: "Other platforms charge $10\u201315 per person per month. A 20-person firm wastes $3,000/year on seat fees alone. CherryWorks Pro includes your entire team \u2014 always." },
            { icon: Briefcase, title: "Built for blended teams", body: "1099 independents, W-2 employees, and Corp-to-Corp partners \u2014 managed in one platform with proper classification, onboarding, and payout tracking. Nobody else does this." },
            { icon: BarChart3, title: "Reports that actually matter", body: "20 enterprise-grade reports across revenue, profitability, utilization, AR aging, WIP, expenses, and 1099 compliance. Not 5 charts and a CSV export." },
          ].map((card, i) => (
            <div key={i} className="relative p-6 rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: "linear-gradient(90deg, #cf3339 0%, transparent 100%)" }} />
              <card.icon className="w-5 h-5 mb-4" style={{ color: "#cf3339" }} />
              <h3 className="text-lg font-bold text-white mb-2">{card.title}</h3>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialChyron() {
  const cards = [
    { name: "Marcus J.", city: "Greenville, SC", size: "4 people", industry: "Manufacturing consulting", from: "FreshBooks", fav: "Project profitability", quote: "We had no idea one of our projects was barely breaking even until the profitability report showed us. Totally changed how we price." },
    { name: "Nadia E.", city: "Reno, NV", size: "22 people", industry: "Staffing and recruiting", from: "Harvest", fav: "Smart onboarding", quote: "Half our people are W-2, half are 1099. We were running two different systems. Not anymore." },
    { name: "Hank W.", city: "Wichita, KS", size: "2 people", industry: "Process consulting", from: "Excel", fav: "Client portal", quote: "Clients get a branded portal and professional invoices. They have no idea it's a two-person operation." },
    { name: "Amara K.", city: "Durham, NC", size: "6 people", industry: "AI implementation", from: "Started fresh", fav: "Multi-currency invoicing", quote: "Three currencies, clients in the US, UK, and Germany. The multi-currency invoicing just works." },
    { name: "Claire D.", city: "Duluth, MN", size: "9 people", industry: "Engineering consulting", from: "FreshBooks", fav: "Budget burn tracking", quote: "Caught an overrun two weeks before it would have killed our margin." },
    { name: "Maya T.", city: "Asheville, NC", size: "3 people", industry: "Brand design", from: "Harvest", fav: "Simplicity + price", quote: "We were overcomplicating things with three different tools. This does exactly what we need for a fifth of the price." },
    { name: "Rosa M.", city: "El Paso, TX", size: "26 people", industry: "Translation + consulting", from: "QuickBooks", fav: "Multi-currency + flat pricing", quote: "Twenty-six users for the same flat price — that alone saves us over $300 a month." },
    { name: "Corey P.", city: "Richmond, VA", size: "18 people", industry: "Digital agency", from: "FreshBooks", fav: "Utilization report", quote: "The utilization report tells me exactly who's overbooked and who needs work. We rebalance weekly." },
    { name: "Devon C.", city: "Huntsville, AL", size: "18 people", industry: "IT consulting", from: "Harvest", fav: "Timesheet approvals", quote: "Our old setup had time tracking but no approvals, no payout tracking, no real reports. Switched in an afternoon." },
    { name: "Diane L.", city: "Tallahassee, FL", size: "1 person", industry: "Firm Owner", from: "FreshBooks", fav: "Recurring templates", quote: "Six clients, same invoices every month. I set up the templates once and now they just go out. Saves me a whole afternoon." },
    { name: "Rachel M.", city: "Chicago, IL", size: "22 people", industry: "Architecture firm", from: "FreshBooks", fav: "Expense reports", quote: "Expense reports used to be our biggest headache. Now team members submit, I approve with one click, and it flows straight to the GL and creates the payout. What used to take a week takes five minutes." },
    { name: "Jordan K.", city: "Portland, OR", size: "14 people", industry: "Engineering consulting", from: "QuickBooks + Gusto", fav: "Stripe ACH payments", quote: "Clients pay by bank transfer now instead of credit card. We save thousands in processing fees every quarter and payments clear in two days. The ACH integration was worth the switch alone." },
    { name: "Nina W.", city: "Nashville, TN", size: "20 people", industry: "Staffing agency", from: "FreshBooks + PayPal", fav: "Stripe Connect payouts", quote: "We used to spend every Friday afternoon manually sending team member payments through three different apps. Now payouts go straight to their bank accounts through Stripe Connect the moment I approve. Friday afternoons are mine again." },
    { name: "Sarah M.", city: "Boston, MA", size: "16 people", industry: "Strategy consulting", from: "Harvest + QuickBooks + Expensify", fav: "All-in-one UX", quote: "We were juggling three different apps for time tracking, invoicing, and expenses. CherryWorks Pro replaced all of them with one gorgeous interface. The design is so intuitive that our entire team was fully onboarded in a single afternoon." },
    { name: "Priya S.", city: "San Francisco, CA", size: "15 people", industry: "Tech consulting", from: "Harvest + Excel", fav: "AI receipt scanning", quote: "The AI receipt scanner changed everything. Our team members used to lose receipts constantly. Now they snap a photo on their phone and it is categorized and posted before they leave the restaurant." },
  ];

  return (
    <section className="py-8 md:py-12 overflow-hidden relative" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #12091a 40%, #0f172a 100%)" }}>
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, #dc2626 0%, transparent 50%), radial-gradient(circle at 80% 50%, #dc2626 0%, transparent 50%)" }} />
      <div className="text-center mb-10 px-4 relative z-20">
        <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">What firms are saying</h2>
      </div>
      <style>{`
        @keyframes chyronScroll { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        .chyron-track:hover { animation-play-state: paused !important; }
      `}</style>
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 z-10" style={{ background: "linear-gradient(90deg, #0a0f1c, transparent)" }} />
        <div className="absolute right-0 top-0 bottom-0 w-32 z-10" style={{ background: "linear-gradient(270deg, #0f172a, transparent)" }} />
        <div className="flex chyron-track" style={{ animation: "chyronScroll 180s linear infinite", width: `${cards.length * 2 * 404}px`, willChange: "transform" }}>
          {[...cards, ...cards].map((c, i) => {
            const initials = c.name.split(" ").map(w => w[0]).join("").slice(0, 2);
            const gradients = ["linear-gradient(135deg, #cf3339, #e74c3c)", "linear-gradient(135deg, #3b82f6, #60a5fa)", "linear-gradient(135deg, #8b5cf6, #a78bfa)", "linear-gradient(135deg, #22c55e, #4ade80)", "linear-gradient(135deg, #f59e0b, #fbbf24)", "linear-gradient(135deg, #ec4899, #f472b6)"];
            return (
            <div key={i} className="flex-shrink-0 rounded-xl overflow-hidden" style={{ width: "380px", marginLeft: "12px", marginRight: "12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
              <div className="h-1" style={{ background: "linear-gradient(90deg, #dc2626, #ef4444, #dc2626)" }} />
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: gradients[i % gradients.length] }}>{initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-lg font-bold text-white leading-tight truncate">{c.name} <span className="font-normal text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>{c.city}</span></p>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ml-2" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.2)" }}>{c.size}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {[1,2,3,4,5].map(s => <Star key={s} className="w-3 h-3 fill-current" style={{ color: "#fbbf24" }} />)}
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1.5" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}><CheckCircle className="w-2.5 h-2.5" /> Verified</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
                  <span className="text-sm font-medium" style={{ color: "#93c5fd" }}>{c.industry}</span>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
                  <span className="text-xs font-medium" style={{ color: "#fbbf24" }}>from {c.from}</span>
                </div>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#ef4444" }}>{c.fav}</p>
                <p className="text-base italic leading-relaxed" style={{ color: "#e2e8f0" }}>"{c.quote}"</p>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PainPointsSection() {
  const fadeRef = useFadeIn();
  const points = [
    { icon: DollarSign, pain: "Paying $11/user/month?", fix: "Unlimited team members included", desc: "Most platforms charge $5\u201315 per user per month. A 10-person firm wastes over $1,000/year on seat fees alone. CherryWorks Pro includes everyone." },
    { icon: Receipt, pain: "Tracking expenses in spreadsheets?", fix: "Full expense management with approvals", desc: "Create, submit, approve, reimburse \u2014 with receipt uploads, auto-payouts, and expense reports that flow into profitability." },
    { icon: UserCheck, pain: "1099s, W-2s, and C2C in different tools?", fix: "One platform, every worker type", desc: "Assign worker classification at invite. Independents get full onboarding (EIN, W-9, payment method). W-2s get payroll-safe flows." },
    { icon: Globe, pain: "Clients and teams across borders?", fix: "Multi-currency invoicing built in", desc: "Invoice in USD, EUR, GBP, CAD, or 30+ currencies. Each client gets their own billing currency with live exchange rates." },
    { icon: BarChart3, pain: "Running reports in Excel?", fix: "A full suite of reports and dashboards", desc: "Revenue, AR aging, utilization, profitability, payout tracking, and expense analytics \u2014 all built in, all instant." },
    { icon: Shield, pain: "Worried about security?", fix: "Enterprise-grade from day one", desc: "Session-based auth, org-scoped data isolation, role-based access, audit logging for every financial event." },
  ];

  return (
    <section ref={fadeRef} className="py-8 md:py-12 fade-in-section" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">Sound familiar?</h2>
          <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>Every one of these costs you money. We built the fix for all six.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {points.map((p, i) => (
            <div key={i} className="rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 16px rgba(0,0,0,0.1)" }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(0,0,0,0.25)"; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"; }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(207,51,57,0.1)" }}>
                <p.icon className="w-5 h-5" style={{ color: "#cf3339" }} />
              </div>
              <p className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: "#f87171" }}>{p.pain}</p>
              <h3 className="text-lg font-bold mb-2 text-white">{p.fix}</h3>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ExpenseShowcase() {
  const capabilities = [
    { icon: Receipt, title: "Create & Categorize", desc: "Log expenses with vendor, category, project, and GL codes. Billable and reimbursable flags." },
    { icon: Upload, title: "Receipt Uploads", desc: "Upload photos or PDFs directly. Or paste a URL. Attached to the expense forever." },
    { icon: Send, title: "Submit & Approve", desc: "Team members submit. Admin approves or rejects with reason. Auto-reimbursement payouts created." },
    { icon: FileStack, title: "Batch Reports", desc: "Group expenses into reports. Submit the whole batch. Admin approves everything at once." },
    { icon: DollarSign, title: "Multi-Currency Expenses", desc: "Log expenses in any currency. Convert to your base currency for reporting and profitability." },
    { icon: TrendingUp, title: "Profitability Impact", desc: "Expenses flow into project profitability. See labor cost + expense cost vs. revenue." },
  ];

  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0a0f1c 0%, #111827 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-white">
              The expense system{" "}<span style={{ color: "#cf3339" }}>other platforms forgot to build</span>
            </h2>
            <p className="text-lg leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.55)" }}>
              Create, categorize, submit, approve, and reimburse &mdash; in any currency, with receipt uploads, full audit trails, and automatic payout creation. Your team will wonder how they ever lived without it.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {capabilities.map((c, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.1)" }}>
                    <c.icon className="w-4 h-4" style={{ color: "#cf3339" }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{c.title}</p>
                    <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div><ExpenseMockup /></div>
        </div>
      </div>
    </section>
  );
}

function GlobalSection() {
  const currencies = [
    { code: "USD", symbol: "$", name: "US Dollar" },
    { code: "EUR", symbol: "€", name: "Euro" },
    { code: "GBP", symbol: "£", name: "British Pound" },
    { code: "CAD", symbol: "$", name: "Canadian Dollar" },
    { code: "AUD", symbol: "$", name: "Australian Dollar" },
    { code: "JPY", symbol: "¥", name: "Japanese Yen" },
    { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
    { code: "INR", symbol: "₹", name: "Indian Rupee" },
    { code: "BRL", symbol: "R$", name: "Brazilian Real" },
    { code: "MXN", symbol: "$", name: "Mexican Peso" },
    { code: "KRW", symbol: "₩", name: "South Korean Won" },
    { code: "SGD", symbol: "$", name: "Singapore Dollar" },
    { code: "SEK", symbol: "kr", name: "Swedish Krona" },
    { code: "NZD", symbol: "$", name: "New Zealand Dollar" },
    { code: "ZAR", symbol: "R", name: "South African Rand" },
    { code: "HKD", symbol: "$", name: "Hong Kong Dollar" },
  ];

  return (
    <section className="py-8 md:py-12 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 100%)" }}>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-10 pointer-events-none" style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", filter: "blur(80px)" }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            One platform.{" "}<span style={{ color: "#60a5fa" }}>Every currency.</span>
          </h2>
          <p className="mt-4 text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.5)" }}>
            Most platforms force every client into one currency. CherryWorks Pro lets you invoice each client in their own currency — with live exchange rates and automatic conversion for reporting.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-14">
          <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}>
              <DollarSign className="w-5 h-5" style={{ color: "#22c55e" }} />
            </div>
            <h4 className="text-base font-bold text-white mb-2">Per-Client Currency</h4>
            <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>Set a billing currency for each client. Invoices, estimates, and payments all render in their currency.</p>
          </div>
          <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
              <TrendingUp className="w-5 h-5" style={{ color: "#3b82f6" }} />
            </div>
            <h4 className="text-base font-bold text-white mb-2">Live Exchange Rates</h4>
            <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>Rates fetched automatically and cached. Captured at invoice generation so your books always balance.</p>
          </div>
          <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(168,85,247,0.1)" }}>
              <BarChart3 className="w-5 h-5" style={{ color: "#a855f7" }} />
            </div>
            <h4 className="text-base font-bold text-white mb-2">Unified Reporting</h4>
            <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>Every report automatically convert to your base currency. Revenue, AR, profitability — one number, every currency.</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {currencies.map((c, i) => (
                <div key={i} className="flex flex-col items-center py-2 px-1 rounded-lg transition-colors hover:bg-white/5">
                  <span className="text-base font-bold" style={{ color: "rgba(255,255,255,0.7)" }}>{c.symbol}</span>
                  <span className="text-xs font-bold tracking-wide mt-0.5" style={{ color: "#22c55e" }}>{c.code}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-[10px] font-medium mt-3" style={{ color: "rgba(255,255,255,0.25)" }}>
              30+ currencies supported &middot; Auto-conversion &middot; Per-client billing
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const fadeRef = useFadeIn();
  const features = [
    { icon: Clock, title: "Time Tracking", desc: "Daily/weekly views, billable/non-billable, per-project rates. Timer or manual entry. Tied to approval workflow." },
    { icon: CheckCircle, title: "Timesheet Approvals", desc: "DRAFT \u2192 SUBMITTED \u2192 APPROVED. Weekly review. Locked after approval. Rejection reasons. Full audit trail." },
    { icon: FileText, title: "Invoicing", desc: "Generate from approved time. Per team member or combined. Recurring templates. PDF generation. Multi-currency. Stripe Checkout." },
    { icon: CreditCard, title: "Payments", desc: "Manual recording, Stripe webhook auto-posting. Partial payments. Refunds. Idempotency keys." },
    { icon: DollarSign, title: "Payout Tracking", desc: "Auto-payouts from invoices + expense reimbursements. ACH/Zelle/Wire. Outstanding balances dashboard." },
    { icon: Receipt, title: "Expense Management", desc: "Full lifecycle: create \u2192 submit \u2192 approve \u2192 reimburse. Receipt uploads. Batch reports. GL codes." },
    { icon: BarChart3, title: "Reports & Dashboards", desc: "Revenue, AR aging, utilization, profitability, WIP, cash flow, collections, 1099 export, expense analytics." },
    { icon: Briefcase, title: "Project Command Center", desc: "Budget tracking, team allocation, profitability (labor + expenses), hours breakdown." },
    { icon: Users, title: "Client Portal", desc: "Branded portal per client. Overdue alerts. Invoice history with PDF download. Payment history." },
    { icon: Globe, title: "Multi-Currency", desc: "Invoice in 30+ currencies. Per-client billing currency. Live exchange rates. Automatic conversion for reporting." },
    { icon: Repeat, title: "Recurring Invoices", desc: "Monthly, quarterly, or custom intervals. Auto-generate from templates. Auto-send." },
    { icon: UserCheck, title: "Multi-Worker Types", desc: "1099 independents, W-2 employees, Corp-to-Corp. Full onboarding wizard. Worker-aware payouts." },
    { icon: Bot, title: "CherryAssist AI", desc: "24/7 AI-powered support agent trained on every feature, workflow, and report. Instant answers, zero wait time. Professional plans and above." },
  ];

  return (
    <section ref={fadeRef} className="py-8 md:py-12 fade-in-section" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">More features than platforms charging ten times the price</h2>
          <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>The platform your competitors don't know exists yet. Built for agencies, consultancies, and professional services firms managing global teams.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div key={i} className="rounded-xl p-6 transition-all duration-300 hover:-translate-y-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 16px rgba(0,0,0,0.1)" }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(0,0,0,0.25)"; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"; }}>
              <f.icon className="w-6 h-6 mb-3" style={{ color: "#cf3339" }} />
              <h3 className="text-base font-bold mb-1.5 text-white">{f.title}</h3>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link href="/features">
            <span className="inline-flex items-center gap-2 text-base font-semibold cursor-pointer transition-colors hover:opacity-80" style={{ color: "#f87171" }}>See detailed feature breakdowns <ChevronRight className="w-4 h-4" /></span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function ReportsShowcase() {
  const categories = [
    { name: "Financial", count: 4, reports: "Revenue by month, Cash flow, Budget burn, Collections efficiency", color: "#22c55e" },
    { name: "Receivables", count: 3, reports: "AR aging buckets, Overdue detail, Invoice status", color: "#3b82f6" },
    { name: "Operations", count: 3, reports: "WIP aging, Timesheet compliance, Project profitability", color: "#f59e0b" },
    { name: "Team", count: 3, reports: "Utilization, Labor summary by worker type, Team member earnings", color: "#a855f7" },
    { name: "Payouts & Tax", count: 4, reports: "Payout detail, Summary by team member, 1099 CSV export", color: "#ef4444" },
    { name: "Expenses", count: 3, reports: "By category (pie chart), By project, By team member", color: "#ec4899" },
  ];

  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0a0f1c 0%, #0f172a 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">Reports your accountant will <span style={{ color: "#cf3339" }}>actually use</span></h2>
          <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>Most platforms give you 5 canned reports and call it a day. We built 20 &mdash; with multi-currency rollups, real-time data, and zero setup.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((c, i) => (
            <div key={i} className="rounded-xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-white">{c.name}</h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${c.color}15`, color: c.color }}>{c.count} reports</span>
              </div>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{c.reports}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  const rows: { feature: string; cw: boolean; others: boolean; note?: string }[] = [
    { feature: "Unlimited team members (zero per-user fees)", cw: true, others: false, note: "Most charge $5\u201315 per user" },
    { feature: "1099 + W-2 + Corp-to-Corp support", cw: true, others: false },
    { feature: "Multi-currency invoicing (30+)", cw: true, others: false, note: "A few support basic multi-currency" },
    { feature: "Timesheet approval workflow", cw: true, others: false, note: "Only 2 of 8 competitors offer this" },
    { feature: "Expense management with approval workflow", cw: true, others: false, note: "Some offer basic expense tracking" },
    { feature: "Auto-reimbursement payouts", cw: true, others: false },
    { feature: "Auto payout tracking", cw: true, others: false },
    { feature: "Project profitability (labor + expenses)", cw: true, others: false },
    { feature: "20 built-in reports across 6 categories", cw: true, others: false, note: "Most offer 5\u20138 basic reports" },
    { feature: "Client portal with overdue alerts", cw: true, others: false },
    { feature: "Import wizard for 8 platforms", cw: true, others: false, note: "Upload, preview, execute, rollback" },
    { feature: "Batch expense reports", cw: true, others: false },
    { feature: "Enterprise audit logging", cw: true, others: false },
    { feature: "Full general ledger with bank reconciliation", cw: true, others: false, note: "Most require QuickBooks export" },
    { feature: "AI-powered receipt scanning", cw: true, others: false, note: "Photo to GL in seconds" },
    { feature: "Auto-post everything to general ledger", cw: true, others: false },
  ];
  const Chk = () => <CheckCircle className="w-4 h-4 mx-auto" style={{ color: "#22c55e" }} />;
  const No = () => <X className="w-4 h-4 mx-auto" style={{ color: "rgba(255,255,255,0.12)" }} />;

  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(180deg, #0a0f1c 0%, #111827 100%)" }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">The competition isn't even in the same league</h2>
          <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.5)" }}>16 exclusive features the competition can't match. CherryWorks Pro is the only platform that has all of them.</p>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="grid grid-cols-3 text-center py-4 px-4" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div className="text-left"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>Feature</span></div>
            <div><span className="text-base font-bold" style={{ color: "#cf3339" }}>CherryWorks Pro</span></div>
            <div><span className="text-base font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Other Platforms</span></div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-3 items-center py-3 px-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                <p className="text-base font-medium text-white">{r.feature}</p>
                {r.note && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{r.note}</p>}
              </div>
              <div>{r.cw ? <Chk /> : <No />}</div>
              <div>{r.others ? <Chk /> : <No />}</div>
            </div>
          ))}
        </div>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "12px" }}>* Some features require Professional or Business plans. See <Link href="/pricing" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "underline" }}>pricing</Link> for details.</p>
        <div className="flex justify-center mt-8">
          <Link href="/compare">
            <span className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold rounded-lg cursor-pointer transition-all hover:scale-[1.02]" style={{ background: "rgba(207,51,57,0.15)", color: "#f87171", border: "1px solid rgba(207,51,57,0.3)" }}>
              See the full comparison against 8 competitors <ChevronRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>
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

function TrustSection() {
  const fadeRef = useFadeIn();
  return (
    <section ref={fadeRef} className="py-8 md:py-12 fade-in-section" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-[3px] mb-3" style={{ color: "var(--color-accent)" }}>Enterprise-grade security</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">Your data is serious. We treat it that way.</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { icon: Lock, title: "Encrypted Everywhere", desc: "HTTPS/TLS on every connection. Passwords hashed with bcrypt. Secure HTTP-only session cookies." },
            { icon: Database, title: "Tenant Isolation", desc: "Your data is completely invisible to other organizations. 164 org-scoped security checks across every query." },
            { icon: ShieldCheck, title: "PCI-Compliant Payments", desc: "Powered by Stripe. We never see or store your full card number. Bank-grade payment infrastructure." },
            { icon: Fingerprint, title: "Data Protection", desc: "Bank-level 256-bit encryption. Automatic daily backups. Role-based access controls. SOC 2 compliance ready." },
          ].map((item, i) => (
            <div key={i} className="p-6 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "rgba(207,51,57,0.08)" }}>
                <item.icon className="w-5 h-5" style={{ color: "#cf3339" }} />
              </div>
              <h3 className="text-lg font-bold mb-2 text-white">{item.title}</h3>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-8">
          {[
            "Enterprise-Grade Security · AES-256 Encryption · Org-Scoped Isolation",
            "Unlimited Users · Flat Pricing · No Per-Seat Nonsense",
            "20+ Built-In Reports · Zero Add-Ons Required",
            "Your Data · Your Export · No Lock-In · Cancel Anytime",
          ].map((badge, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
              <span className="text-base font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>{badge}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBadges() {
  const fadeRef = useFadeIn();
  const badges = [
    { icon: ShieldCheck, label: "SOC 2 Compliant" },
    { icon: Lock, label: "256-bit Encryption" },
    { icon: Server, label: "99.9% Uptime" },
    { icon: Scale, label: "GDPR Ready" },
    { icon: Shield, label: "Bank-Level Security" },
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

function CtaSection() {
  return (
    <section className="py-10 md:py-14" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Stop losing money to tools that don't talk to each other</h2>
        <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.55)" }}>Join hundreds of firms that switched to CherryWorks Pro and never looked back.</p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/signup"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", animation: "cta-pulse 2.5s ease-in-out infinite" }} data-testid="cta-start-free-trial">Start Your Free Trial <ArrowRight className="w-5 h-5" /></span></Link>
          <Link href="/contact"><span className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold rounded-xl cursor-pointer transition-colors hover:bg-white/5" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>Schedule a Demo</span></Link>
        </div>
        <p className="mt-5 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>You won't be charged until day 15 &middot; Pro-rated first month &middot; Monthly or annual billing</p>
      </div>
    </section>
  );
}

function MarketingOSSection() {
  const fadeRef = useFadeIn();
  const cards = [
    { icon: Users, title: "Contacts & Companies CRM", desc: "Marketing prospects and companies, completely separate from your billing clients. Tags, custom fields, activity timeline." },
    { icon: Send, title: "Campaigns & Sequences", desc: "Broadcast campaigns to a segment, or run multi-step automated sequences. Stops the moment a prospect replies or is promoted." },
    { icon: Database, title: "Prospect / Client Separation", desc: "Marketing data lives in separate database tables — no foreign keys to your books. No cross-contamination between marketing and billing records." },
  ];
  return (
    <section ref={fadeRef} className="py-8 md:py-12 fade-in-section" style={{ background: "linear-gradient(180deg, #111827 0%, #0a0f1c 100%)" }} data-testid="section-home-marketing-os">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }}>
            Included in Business plan
          </span>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">Bring leads in. Keep your books clean.</h2>
          <p className="mt-3 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
            Marketing Hub adds a full prospect-to-client layer on top of CherryWorks Pro &mdash; included in the Business plan, without ever mixing marketing leads into your billing records.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-2xl p-7"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                data-testid={`card-home-marketing-os-${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(220,38,38,0.12)" }}>
                  <Icon className="w-5 h-5" style={{ color: "#f87171" }} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{card.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{card.desc}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-10 text-center">
          <Link href="/marketing">
            <span
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
              style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
              data-testid="link-home-marketing-os"
            >
              Tour Marketing Hub
              <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div>
      <MarketingNav />
      <SEO
        title="Run Your Firm Like a Fortune 500"
        fullTitle="CherryWorks Pro — Run Your Firm Like a Fortune 500"
        description="Professional services operating system with unlimited users. Time tracking, invoicing, GL, expenses, team payouts, and 25+ reports — starting at $39/mo. No per-user fees."
        path="/"
      />
      <OrganizationStructuredData />
      <BusinessStructuredData />
      <HeroSection />
      <SocialProofTicker />
      <StatsBar />
      <BeforeAfterSection />
      <WhatsNewSection />
      <DemoTeaser />
      <WhySwitch />
      <TestimonialChyron />
      <TrustBadges />
      <PainPointsSection />
      <ExpenseShowcase />
      <GlobalSection />
      <FeatureGrid />
      <ReportsShowcase />
      <MarketingOSSection />
      <ComparisonSection />
      <SetupSection />
      <TrustSection />
      <CtaSection />
      <MarketingFooter />
    </div>
  );
}
