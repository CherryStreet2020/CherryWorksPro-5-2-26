import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  Clock, FileText, DollarSign, BarChart3, Users, Shield, CheckCircle, ArrowRight,
  ClipboardCheck, FolderKanban, Repeat, Upload, UserPlus, Globe, Zap, TrendingUp,
  ChevronRight, Receipt, FileStack, CreditCard, Send, Lock, Eye, X, Bot, BookOpen,
  Landmark, ScanLine, LayoutDashboard, Bell, Rocket, ScrollText, Database,
} from "lucide-react";
import { CherryLogo } from "@/components/shared/cherry-logo";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { SEO, SoftwareApplicationStructuredData } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("fade-in-visible"); obs.disconnect(); } }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function MockupShell({ url, activeNav, children }: { url: string; activeNav: string; children: React.ReactNode }) {
  const navItems = ["Dashboard","Clients","Projects","Time","Invoices","Payments","Payouts","Reports","Expenses","Team","Settings"];
  return (
    <div className="rounded-2xl overflow-hidden w-full" style={{ background: "rgba(11,18,34,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 40px rgba(207,51,57,0.03)" }}>
      <div className="flex items-center px-3 py-1.5" style={{ background: "rgba(7,13,24,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex gap-1.5 mr-3"><div className="w-2 h-2 rounded-full" style={{ background: "#ff5f57" }} /><div className="w-2 h-2 rounded-full" style={{ background: "#febc2e" }} /><div className="w-2 h-2 rounded-full" style={{ background: "#28c840" }} /></div>
        <div className="flex-1 flex justify-center"><span className="text-[11px] px-6 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.04)" }}>{url}</span></div>
      </div>
      <div className="flex">
        <div className="hidden lg:block w-[130px] flex-shrink-0 py-2 px-2" style={{ background: "rgba(7,13,24,0.7)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-1.5 mb-3"><BrandLockup iconSize={16} textSize="sm" /></div>
          {navItems.map(item => (
            <div key={item} className="flex items-center gap-1 px-1.5 py-[4px] rounded text-[10px]" style={{ background: item === activeNav ? "rgba(207,51,57,0.12)" : "transparent", color: item === activeNav ? "#f87171" : "rgba(255,255,255,0.3)" }}>
              <div className="w-2 h-2 rounded" style={{ background: item === activeNav ? "rgba(207,51,57,0.3)" : "rgba(255,255,255,0.06)" }} />{item}
            </div>
          ))}
          <div className="mt-3 mx-1.5 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "#cf3339", color: "#fff" }}>AM</div><div><p className="text-[12px] font-medium text-white">Alex M.</p><p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>ADMIN</p></div></div>
          </div>
        </div>
        <div className="flex-1 p-4">{children}</div>
      </div>
    </div>
  );
}

function TimeTrackingMockup() {
  return (
    <MockupShell url="cherryworkspro.com/time" activeNav="Time">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Time Tracking</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Week of Mar 23 &ndash; Mar 29, 2026</p></div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">{["Week","Month","Day"].map((v,i) => (<span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: i===0 ? "rgba(207,51,57,0.15)" : "transparent", color: i===0 ? "#f87171" : "rgba(255,255,255,0.25)" }}>{v}</span>))}</div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.2)", boxShadow: "0 0 12px rgba(207,51,57,0.15)" }}><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><span className="text-[11px] font-bold" style={{ color: "#f87171" }}>1h 23m</span></div>
        </div>
      </div>
      <div className="rounded-lg overflow-hidden mb-2" style={{ border: "1px solid rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>
        <div className="grid grid-cols-9 text-center py-1.5 px-1" style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {["PROJECT","SERVICE","Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (<span key={d} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{d}</span>))}
        </div>
        {[
          { proj: "Acme Redesign", svc: "UX Design", hours: [8,7.5,8,6,8,0,0], color: "#3b82f6" },
          { proj: "Acme Redesign", svc: "Dev", hours: [0,0.5,0,2,0,0,0], color: "#3b82f6" },
          { proj: "TechFlow API", svc: "Backend", hours: [0,0,0,0,0,0,0], color: "#22c55e" },
          { proj: "DataSync", svc: "Consulting", hours: [0,0,0,0,0,4,0], color: "#f59e0b" },
          { proj: "Internal", svc: "Admin", hours: [0,0,0,0,0,0,2], color: "#6b7280" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-9 items-center py-1.5 px-1" style={{ borderTop: "1px solid rgba(255,255,255,0.03)", background: i === 0 ? `rgba(59,130,246,0.03)` : "transparent" }}>
            <span className="text-[11px] font-medium truncate" style={{ color: r.color }}>{r.proj}</span>
            <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{r.svc}</span>
            {r.hours.map((h,j) => (<span key={j} className="text-center text-[12px] font-sans tabular-nums rounded" style={{ color: h > 0 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.08)", background: h >= 8 ? "rgba(34,197,94,0.06)" : h > 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>{h > 0 ? h : "\u2014"}</span>))}
          </div>
        ))}
        <div className="grid grid-cols-9 items-center py-1.5 px-1" style={{ background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[11px] font-bold col-span-2" style={{ color: "rgba(255,255,255,0.5)" }}>DAILY TOTAL</span>
          {[8,8,8,8,8,4,2].map((h,j) => (<span key={j} className="text-center text-[12px] font-bold font-sans tabular-nums" style={{ color: h >= 8 ? "#22c55e" : h > 0 ? "#f59e0b" : "rgba(255,255,255,0.08)" }}>{h}</span>))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="text-[11px] px-2 py-0.5 rounded-lg font-bold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.15)" }}>42h billable</span><span className="text-[11px] px-2 py-0.5 rounded-lg font-bold" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.15)" }}>4h internal</span></div>
        <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>46h total &middot; 91% utilization</span>
      </div>
    </MockupShell>
  );
}

function TimesheetMockup() {
  return (
    <MockupShell url="cherryworkspro.com/approvals" activeNav="Dashboard">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Timesheet Approvals</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Week ending Mar 29, 2026</p></div>
        <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>3 pending</span>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-6 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>
          {["","TEAM MEMBER","WEEK","HOURS","STATUS","ACTIONS"].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}
        </div>
        {[
          { init: "SK", name: "Sarah Kim", hours: "42.0h", status: "SUBMITTED", sC: "#3b82f6" },
          { init: "MR", name: "Mike Rivera", hours: "38.5h", status: "SUBMITTED", sC: "#3b82f6" },
          { init: "AL", name: "Anna Lopez", hours: "40.0h", status: "SUBMITTED", sC: "#3b82f6" },
          { init: "JT", name: "James Torres", hours: "44.0h", status: "APPROVED", sC: "#22c55e" },
          { init: "LC", name: "Li Chen", hours: "36.0h", status: "APPROVED", sC: "#22c55e" },
          { init: "RD", name: "Rob Dunagan", hours: "22.0h", status: "REJECTED", sC: "#ef4444" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <div><input type="checkbox" className="w-2 h-2 rounded opacity-30" readOnly checked={r.status==="SUBMITTED"} /></div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `${r.sC}20`, color: r.sC }}>{r.init}</div><span className="text-[12px] font-medium text-white">{r.name}</span></div>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Mar 23-29</span>
            <span className="text-[12px] font-sans tabular-nums font-medium text-white">{r.hours}</span>
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold w-fit" style={{ background: `${r.sC}12`, color: r.sC }}>{r.status}</span>
            <div className="flex gap-0.5">{r.status==="SUBMITTED" && (<><div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}><CheckCircle className="w-1.5 h-1.5" style={{ color: "#22c55e" }} /></div><div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}><X className="w-1.5 h-1.5" style={{ color: "#ef4444" }} /></div></>)}<div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Eye className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div></div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2"><div className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>Approve Selected (3)</div><div className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Reject Selected</div></div>
    </MockupShell>
  );
}

function InvoicingMockup() {
  return (
    <MockupShell url="cherryworkspro.com/invoices/INV-0047" activeNav="Invoices">
      <div className="relative">
        <div className="absolute top-4 right-4 -rotate-12 z-10">
          <div className="px-4 py-1.5 rounded-lg text-sm font-black uppercase tracking-widest" style={{ color: "#22c55e", border: "3px solid #22c55e", background: "rgba(34,197,94,0.08)", boxShadow: "0 0 20px rgba(34,197,94,0.15)" }}>PAID</div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <BrandLockup iconSize={16} textSize="sm" />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Invoice</span>
        </div>
        <div className="rounded-lg p-3 mb-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-[10px] font-bold uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Bill To</p><p className="text-[12px] font-bold text-white">Acme Corp</p><p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>123 Main St, San Francisco, CA</p></div>
            <div className="text-right"><p className="text-[10px] font-bold uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Invoice Details</p><p className="text-[11px] text-white"><span style={{ color: "rgba(255,255,255,0.4)" }}>#</span> INV-0047</p><p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Issued: Mar 1, 2026</p><p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Due: Mar 31, 2026</p></div>
          </div>
        </div>
        <div className="rounded-lg overflow-hidden mb-3" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid grid-cols-12 px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
            <span className="col-span-5 text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Description</span>
            <span className="col-span-2 text-[10px] font-bold uppercase text-right" style={{ color: "rgba(255,255,255,0.3)" }}>Hours</span>
            <span className="col-span-2 text-[10px] font-bold uppercase text-right" style={{ color: "rgba(255,255,255,0.3)" }}>Rate</span>
            <span className="col-span-3 text-[10px] font-bold uppercase text-right" style={{ color: "rgba(255,255,255,0.3)" }}>Amount</span>
          </div>
          {[
            { desc: "UX Design \u2014 Acme Redesign", hours: "42.0", rate: "$175", amt: "$7,350" },
            { desc: "Frontend Dev \u2014 Acme Redesign", hours: "22.0", rate: "$200", amt: "$4,400" },
            { desc: "Project Management", hours: "4.0", rate: "$150", amt: "$600" },
            { desc: "QA & Testing", hours: "2.0", rate: "$125", amt: "$250" },
          ].map((r,i) => (
            <div key={i} className="grid grid-cols-12 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              <span className="col-span-5 text-[11px] text-white">{r.desc}</span>
              <span className="col-span-2 text-[11px] font-sans tabular-nums text-right" style={{ color: "rgba(255,255,255,0.5)" }}>{r.hours}</span>
              <span className="col-span-2 text-[11px] font-sans tabular-nums text-right" style={{ color: "rgba(255,255,255,0.5)" }}>{r.rate}</span>
              <span className="col-span-3 text-[11px] font-sans tabular-nums font-medium text-right text-white">{r.amt}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <div className="w-48 space-y-1">
            <div className="flex justify-between"><span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Subtotal</span><span className="text-[11px] font-sans tabular-nums text-white">$12,600</span></div>
            <div className="flex justify-between"><span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>Discount (5%)</span><span className="text-[11px] font-sans tabular-nums" style={{ color: "#ef4444" }}>-$200</span></div>
            <div className="flex justify-between pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}><span className="text-[12px] font-bold text-white">Total</span><span className="text-[12px] font-bold font-sans tabular-nums" style={{ color: "#22c55e" }}>$12,400</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2"><span className="text-[10px] px-1.5 py-0.5 rounded-lg" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.15)" }}>Stripe Checkout</span><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Paid via ACH &middot; Mar 28, 2026</span></div>
      </div>
    </MockupShell>
  );
}

function ExpenseMockup() {
  return (
    <MockupShell url="cherryworkspro.com/expenses" activeNav="Expenses">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Expense Dashboard</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>March 2026 &middot; 5 team members</p></div>
        <div className="px-2 py-0.5 rounded-lg text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ New Expense</div>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "TOTAL", v: "$4,285", c: "white" },{ l: "APPROVED", v: "$1,135", c: "#22c55e" },{ l: "PENDING", v: "3", c: "#3b82f6" },{ l: "REIMBURSED", v: "$698", c: "#a855f7" }].map((s,i) => (
          <div key={i} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="flex gap-0.5 mb-1.5">{["All","Draft","Submitted","Approved","Rejected","Reimbursed"].map((f,i) => (<span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: i===0 ? "rgba(207,51,57,0.12)" : "rgba(255,255,255,0.03)", color: i===0 ? "#f87171" : "rgba(255,255,255,0.25)" }}>{f}</span>))}</div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        {[
          { date: "Mar 28", init: "SK", vendor: "Delta Airlines", cat: "Travel", amt: "$485", st: "APPROVED", c: "#22c55e", hasReceipt: true },
          { date: "Mar 27", init: "MR", vendor: "AWS", cat: "Software", amt: "\u20ac130", st: "SUBMITTED", c: "#3b82f6", hasReceipt: false },
          { date: "Mar 26", init: "AL", vendor: "Hilton Hotels", cat: "Travel", amt: "\u00a3312", st: "DRAFT", c: "#6b7280", hasReceipt: true },
          { date: "Mar 25", init: "JT", vendor: "Uber", cat: "Transport", amt: "$48", st: "REIMBURSED", c: "#a855f7", hasReceipt: true },
          { date: "Mar 24", init: "DD", vendor: "Jet Blue", cat: "Travel", amt: "$650", st: "APPROVED", c: "#22c55e", hasReceipt: true },
        ].map((r,i) => (
          <div key={i} className="flex items-center px-2 py-2 gap-2" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
            <span className="text-[11px] w-10" style={{ color: "rgba(255,255,255,0.35)" }}>{r.date}</span>
            <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: `${r.c}20`, color: r.c }}>{r.init}</div>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-medium text-white block truncate">{r.vendor}</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{r.cat}</span>
            </div>
            {r.hasReceipt && <div className="w-5 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.15)" }}><Receipt className="w-2.5 h-2.5" style={{ color: "#a855f7" }} /></div>}
            <span className="text-[11px] font-sans tabular-nums font-medium text-white w-12 text-right flex-shrink-0">{r.amt}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0" style={{ background: `${r.c}12`, color: r.c, boxShadow: r.st === "APPROVED" ? "0 0 6px rgba(34,197,94,0.2)" : "none" }}>{r.st}</span>
          </div>
        ))}
      </div>
    </MockupShell>
  );
}

function AccountingMockup() {
  return (
    <MockupShell url="cherryworkspro.com/gl/ledger" activeNav="Dashboard">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">General Ledger</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Year to Date &middot; Jan 1 &ndash; Mar 31, 2026</p></div>
        <div className="flex items-center gap-1">
          {["This Month","YTD","Last Year"].map((f,i) => (<span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: i===1 ? "rgba(207,51,57,0.15)" : "transparent", color: i===1 ? "#f87171" : "rgba(255,255,255,0.25)" }}>{f}</span>))}
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>Export CSV</span>
        </div>
      </div>
      <div className="rounded-lg overflow-hidden mb-2" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="px-2 py-1" style={{ background: "rgba(59,130,246,0.08)", borderBottom: "1px solid rgba(59,130,246,0.15)" }}>
          <span className="text-[10px] font-bold uppercase" style={{ color: "#60a5fa" }}>Assets</span>
        </div>
        {[
          { num: "1000", name: "Cash", dr: "$38,400", cr: "$14,340", bal: "$24,060" },
          { num: "1200", name: "Accounts Receivable", dr: "$87,450", cr: "$38,400", bal: "$49,050" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>{r.num}</span>
            <span className="text-[11px] font-medium text-white col-span-2">{r.name}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#22c55e" }}>{r.dr}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#ef4444" }}>{r.cr}</span>
            <span className="text-[11px] font-sans tabular-nums font-bold text-right text-white">{r.bal}</span>
          </div>
        ))}
        <div className="px-2 py-1" style={{ background: "rgba(245,158,11,0.08)", borderTop: "1px solid rgba(245,158,11,0.15)" }}>
          <span className="text-[10px] font-bold uppercase" style={{ color: "#fbbf24" }}>Liabilities</span>
        </div>
        {[
          { num: "2000", name: "Accounts Payable", dr: "$0", cr: "$2,340", bal: "$2,340" },
          { num: "2200", name: "Accrued Reimbursable", dr: "$485", cr: "$1,135", bal: "$650" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>{r.num}</span>
            <span className="text-[11px] font-medium text-white col-span-2">{r.name}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#22c55e" }}>{r.dr}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#ef4444" }}>{r.cr}</span>
            <span className="text-[11px] font-sans tabular-nums font-bold text-right text-white">{r.bal}</span>
          </div>
        ))}
        <div className="px-2 py-1" style={{ background: "rgba(34,197,94,0.08)", borderTop: "1px solid rgba(34,197,94,0.15)" }}>
          <span className="text-[10px] font-bold uppercase" style={{ color: "#4ade80" }}>Revenue</span>
        </div>
        <div className="grid grid-cols-6 items-center px-2 py-1" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
          <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>4000</span>
          <span className="text-[11px] font-medium text-white col-span-2">Service Revenue</span>
          <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#22c55e" }}>$0</span>
          <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#ef4444" }}>$82,200</span>
          <span className="text-[11px] font-sans tabular-nums font-bold text-right text-white">$82,200</span>
        </div>
        <div className="px-2 py-1" style={{ background: "rgba(168,85,247,0.08)", borderTop: "1px solid rgba(168,85,247,0.15)" }}>
          <span className="text-[10px] font-bold uppercase" style={{ color: "#c084fc" }}>Expenses</span>
        </div>
        {[
          { num: "5100", name: "Team Payout Costs", dr: "$14,340", cr: "$0", bal: "$14,340" },
          { num: "6001", name: "Travel", dr: "$1,135", cr: "$0", bal: "$1,135" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>{r.num}</span>
            <span className="text-[11px] font-medium text-white col-span-2">{r.name}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#22c55e" }}>{r.dr}</span>
            <span className="text-[11px] font-sans tabular-nums text-right" style={{ color: "#ef4444" }}>{r.cr}</span>
            <span className="text-[11px] font-sans tabular-nums font-bold text-right text-white">{r.bal}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg p-1.5 mb-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <p className="text-[10px] font-bold uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Auto-Generated Journal Entries</p>
        <div className="flex flex-wrap gap-1">
          {["Invoice Sent","Payment Received","Payout Completed","Expense Approved","Expense Reimbursed"].map((e,i) => (
            <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e" }}>{e}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Balanced</span>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>18 default accounts &middot; Double-entry &middot; Trial Balance</span>
      </div>
    </MockupShell>
  );
}

function BankReconMockup() {
  return (
    <MockupShell url="cherryworkspro.com/bank-reconciliation" activeNav="Dashboard">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Bank Reconciliation</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Mar 1 &ndash; Mar 31, 2026</p></div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>Import Statement</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>Reconcile</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "BANK BALANCE", v: "$48,230", c: "#3b82f6" },{ l: "BOOK BALANCE", v: "$48,230", c: "#22c55e" },{ l: "MATCHED", v: "47", c: "#22c55e" },{ l: "UNMATCHED", v: "3", c: "#f59e0b" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="rounded-lg p-2 mb-2" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5"><CheckCircle className="w-3 h-3" style={{ color: "#22c55e" }} /><span className="text-[11px] font-bold" style={{ color: "#22c55e" }}>Balanced</span></div>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>Difference: $0.00</span>
        </div>
      </div>
      <div className="flex gap-0.5 mb-1.5">{["All","Matched","Unmatched"].map((f,i) => (<span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: i===0 ? "rgba(207,51,57,0.12)" : "rgba(255,255,255,0.03)", color: i===0 ? "#f87171" : "rgba(255,255,255,0.25)" }}>{f}</span>))}</div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-6 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>
          {["DATE","DESCRIPTION","BANK AMT","MATCH","TYPE","STATUS"].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}
        </div>
        {[
          { date: "Mar 28", desc: "ACH Deposit - Acme Corp", amt: "+$12,400", match: "INV-0047", type: "Payment", st: "MATCHED", c: "#22c55e" },
          { date: "Mar 25", desc: "Wire Out - Mike Rivera", amt: "-$2,340", match: "PAY-0031", type: "Payout", st: "MATCHED", c: "#22c55e" },
          { date: "Mar 22", desc: "ACH Deposit - TechFlow", amt: "+\u20ac8,750", match: "INV-0048", type: "Payment", st: "MATCHED", c: "#22c55e" },
          { date: "Mar 20", desc: "Stripe Payout", amt: "+$3,150", match: "\u2014", type: "\u2014", st: "UNMATCHED", c: "#f59e0b" },
          { date: "Mar 18", desc: "Delta Airlines", amt: "-$485", match: "EXP-0089", type: "Expense", st: "MATCHED", c: "#22c55e" },
          { date: "Mar 15", desc: "Unknown ACH Credit", amt: "+$920", match: "\u2014", type: "\u2014", st: "UNMATCHED", c: "#f59e0b" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>{r.date}</span>
            <span className="text-[11px] font-medium text-white truncate">{r.desc}</span>
            <span className="text-[11px] font-sans tabular-nums font-medium" style={{ color: r.amt.startsWith("+") ? "#22c55e" : "#ef4444" }}>{r.amt}</span>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: r.match === "\u2014" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)" }}>{r.match}</span>
            <span className="text-[11px]" style={{ color: r.type === "\u2014" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.4)" }}>{r.type}</span>
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold w-fit" style={{ background: `${r.c}12`, color: r.c }}>{r.st}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>47 matched</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>3 unmatched</span>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>CSV &middot; OFX supported</span>
      </div>
    </MockupShell>
  );
}

function PayoutMockup() {
  return (
    <MockupShell url="cherryworkspro.com/payouts" activeNav="Payouts">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Payouts</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Track and record team member payments</p></div>
        <div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>+ Record Payout</div>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "TOTAL OWED", v: "$8,640", c: "#ef4444" },{ l: "PAID (ALL TIME)", v: "$42,300", c: "#22c55e" },{ l: "UNPAID HOURS", v: "86h", c: "#f59e0b" },{ l: "ACTIVE", v: "5", c: "#a855f7" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <p className="text-[11px] font-bold uppercase mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Outstanding Balances</p>
      {[
        { init: "SK", name: "Sarah Kim", detail: "24h unpaid", amt: "$3,600", method: "ACH" },
        { init: "MR", name: "Mike Rivera", detail: "18h unpaid", amt: "$2,340", method: "Zelle" },
        { init: "AL", name: "Anna Lopez", detail: "12h + $200 reimb", amt: "$1,700", method: "ACH" },
      ].map((r,i) => (
        <div key={i} className="flex items-center gap-2 p-1.5 mb-1 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "rgba(207,51,57,0.15)", color: "#f87171" }}>{r.init}</div>
          <div className="flex-1"><p className="text-[12px] font-medium text-white">{r.name}</p><p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{r.detail}</p></div>
          <span className="text-[12px] font-sans tabular-nums font-bold" style={{ color: "#ef4444" }}>{r.amt}</span>
          <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>{r.method}</span>
          <div className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "#cf3339", color: "#fff" }}>Pay</div>
        </div>
      ))}
    </MockupShell>
  );
}

function ProjectMockup() {
  return (
    <MockupShell url="cherryworkspro.com/projects/acme-redesign" activeNav="Projects">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Acme Corp Redesign</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Client: Acme Corp &middot; Active</p></div>
        <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>On Track</span>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "BUDGET", v: "200h", c: "white" },{ l: "LOGGED", v: "142h", c: "#3b82f6" },{ l: "REVENUE", v: "$24,800", c: "#22c55e" },{ l: "MARGIN", v: "42%", c: "#22c55e" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="flex gap-0.5 mb-2">{["Hours","Profitability","Time","Invoices","Services"].map((t,i) => (<span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: i===1 ? "rgba(207,51,57,0.12)" : "transparent", color: i===1 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{t}</span>))}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="text-[11px] font-bold mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Revenue vs Cost</p>
          <div className="flex items-end gap-2 h-10">
            <div className="flex-1 text-center"><div className="rounded-t mx-auto" style={{ width: "70%", height: "38px", background: "#22c55e" }} /><p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Revenue</p><p className="text-[11px] font-bold" style={{ color: "#22c55e" }}>$24.8K</p></div>
            <div className="flex-1 text-center"><div className="rounded-t mx-auto" style={{ width: "70%", height: "22px", background: "#ef4444" }} /><p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Cost</p><p className="text-[11px] font-bold" style={{ color: "#ef4444" }}>$14.4K</p></div>
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="text-[11px] font-bold mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Cost Breakdown</p>
          {[{ l: "Labor", v: "$12,800", pct: 89, c: "#f59e0b" },{ l: "Expenses", v: "$1,600", pct: 11, c: "#a855f7" }].map((r,i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <span className="text-[10px] w-10" style={{ color: "rgba(255,255,255,0.4)" }}>{r.l}</span>
              <div className="flex-1 h-[4px] rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.c }} /></div>
              <span className="text-[10px] font-sans tabular-nums" style={{ color: r.c }}>{r.v}</span>
            </div>
          ))}
          <div className="mt-1 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex justify-between"><span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Profit</span><span className="text-[11px] font-bold" style={{ color: "#22c55e" }}>$10,400 (42%)</span></div>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

function ReportsMockup() {
  return (
    <MockupShell url="cherryworkspro.com/reports" activeNav="Reports">
      <div className="mb-2"><p className="text-xs font-bold text-white">Reports</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Full reporting suite across every category</p></div>
      <div className="flex gap-0.5 mb-2 flex-wrap">{["Financial","Receivables","Operations","Team","Payouts","Expenses"].map((c,i) => (<span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: i===0 ? "rgba(207,51,57,0.15)" : "rgba(255,255,255,0.03)", color: i===0 ? "#f87171" : "rgba(255,255,255,0.25)" }}>{c}</span>))}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>Revenue by Month</p><span className="text-[10px] px-1.5 py-0.5 rounded-lg font-bold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.15)" }}>+12%</span></div>
          <div className="flex items-end gap-1 h-12">{[28,35,42,38,51,47,62].map((v,i) => (<div key={i} className="flex-1 flex flex-col items-center gap-0.5"><span className="text-[7px] font-bold" style={{ color: i===6 ? "#f87171" : "rgba(255,255,255,0.15)" }}>{v}K</span><div className="w-full rounded-t" style={{ height: `${v*0.8}%`, background: i===6 ? "rgba(207,51,57,0.6)" : `rgba(207,51,57,${0.15+i*0.06})`, boxShadow: i===6 ? "0 0 8px rgba(207,51,57,0.3)" : "none" }} /></div>))}</div>
          <div className="flex justify-between mt-1">{["Sep","Oct","Nov","Dec","Jan","Feb","Mar"].map(m => (<span key={m} className="text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>{m}</span>))}</div>
        </div>
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[11px] font-bold mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>AR Aging</p>
          {[{ l: "Current", pct: 60, c: "#22c55e", a: "$12.4K" },{ l: "1-30d", pct: 25, c: "#f59e0b", a: "$5.2K" },{ l: "31-60d", pct: 10, c: "#ef4444", a: "$2.1K" },{ l: "90d+", pct: 5, c: "#991b1b", a: "$1.1K" }].map((b,i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1"><span className="text-[10px] w-9 font-bold" style={{ color: b.c }}>{b.l}</span><div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${b.pct}%`, background: b.c, boxShadow: `0 0 6px ${b.c}40` }} /></div><span className="text-[10px] font-sans tabular-nums font-bold" style={{ color: b.c }}>{b.a}</span></div>
          ))}
        </div>
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[11px] font-bold mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Utilization</p>
          {[{ n: "Sarah K.", i: "SK", p: 92, c: "#22c55e" },{ n: "Mike R.", i: "MR", p: 85, c: "#22c55e" },{ n: "Anna L.", i: "AL", p: 68, c: "#f59e0b" },{ n: "James T.", i: "JT", p: 54, c: "#f59e0b" }].map((u,i) => (
            <div key={i} className="flex items-center gap-1 mb-1"><div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: `${u.c}20`, color: u.c }}>{u.i}</div><span className="text-[10px] w-10 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{u.n}</span><div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${u.p}%`, background: u.c, boxShadow: `0 0 6px ${u.c}40` }} /></div><span className="text-[10px] font-sans tabular-nums font-bold" style={{ color: u.c }}>{u.p}%</span></div>
          ))}
        </div>
        <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[11px] font-bold mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Profitability</p>
          {[{ p: "Acme Redesign", m: "42%", c: "#22c55e" },{ p: "TechFlow API", m: "33%", c: "#22c55e" },{ p: "DataSync", m: "-12%", c: "#ef4444" }].map((r,i) => (
            <div key={i} className="flex items-center justify-between py-1" style={{ borderBottom: i<2 ? "1px solid rgba(255,255,255,0.04)" : "none" }}><span className="text-[11px] text-white">{r.p}</span><span className="text-[11px] font-bold" style={{ color: r.c }}>{r.m}</span></div>
          ))}
        </div>
      </div>
    </MockupShell>
  );
}

function PortalMockup() {
  return (
    <div className="rounded-2xl overflow-hidden w-full" style={{ background: "#0b1222", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
      <div className="flex items-center px-3 py-1.5" style={{ background: "#070d18", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex gap-1.5 mr-3"><div className="w-2 h-2 rounded-full" style={{ background: "#ff5f57" }} /><div className="w-2 h-2 rounded-full" style={{ background: "#febc2e" }} /><div className="w-2 h-2 rounded-full" style={{ background: "#28c840" }} /></div>
        <div className="flex-1 flex justify-center"><span className="text-[11px] px-6 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.2)" }}>cherryworkspro.com/portal/abc123</span></div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div><div className="mb-1"><BrandLockup iconSize={16} textSize="sm" /></div><p className="text-[10px] font-bold text-white">Acme Corp &mdash; Client Portal</p></div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {[{ l: "OUTSTANDING", v: "$8,750", c: "#f59e0b" },{ l: "OVERDUE", v: "$5,200", c: "#ef4444" },{ l: "PAID (YTD)", v: "$42,300", c: "#22c55e" }].map((s,i) => (
            <div key={i} className="rounded p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[11px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-[10px] font-bold" style={{ color: s.c }}>{s.v}</p></div>
          ))}
        </div>
        <div className="rounded p-2 mb-2" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
          <p className="text-[12px] font-bold" style={{ color: "#ef4444" }}>{"\u26a0"} 1 overdue invoice &mdash; INV-0049 (&pound;5,200) is 8 days past due</p>
        </div>
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
          {[
            { num: "INV-0048", amt: "\u20ac8,750", st: "SENT", c: "#3b82f6", due: "Apr 4" },
            { num: "INV-0049", amt: "\u00a35,200", st: "OVERDUE", c: "#ef4444", due: "Mar 20" },
            { num: "INV-0047", amt: "$12,400", st: "PAID", c: "#22c55e", due: "Mar 31" },
          ].map((r,i) => (
            <div key={i} className="flex items-center px-2 py-1.5 gap-3" style={{ borderTop: i>0 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span className="text-[12px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>{r.num}</span>
              <span className="text-[12px] font-sans tabular-nums font-medium text-white flex-1">{r.amt}</span>
              <span className="text-[11px]" style={{ color: r.st==="OVERDUE" ? "#ef4444" : "rgba(255,255,255,0.35)" }}>Due {r.due}</span>
              <span className="px-1 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${r.c}12`, color: r.c }}>{r.st}</span>
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><FileText className="w-2 h-2" style={{ color: "rgba(255,255,255,0.3)" }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GlobalMockup() {
  return (
    <div className="rounded-2xl overflow-hidden w-full p-4" style={{ background: "#0b1222", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
      <div>
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-1.5 mb-2"><DollarSign className="w-4 h-4" style={{ color: "#22c55e" }} /><span className="text-[11px] font-bold text-white">Currencies</span></div>
          <div className="flex flex-wrap gap-1">
            {["$ USD","\u20ac EUR","\u00a3 GBP","$ CAD","\u00a5 JPY","R$ BRL","$ AUD","\u20b9 INR","\u20a3 CHF","kr SEK","$ NZD","$ MXN"].map((c,i) => (
              <span key={i} className="text-[12px] font-sans tabular-nums font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e" }}>{c}</span>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>30+ supported &middot; Auto-conversion &middot; Per-client billing currency</p>
        </div>
      </div>
    </div>
  );
}

function ImportMockup() {
  return (
    <MockupShell url="cherryworkspro.com/import" activeNav="Dashboard">
      <div className="mb-2"><p className="text-xs font-bold text-white">Import Wizard</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Migrate from any platform</p></div>
      <div className="flex items-center justify-center gap-1.5 mb-2">
        {["Select Platform","Upload Files","Preview","Execute"].map((s,i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: i<=1 ? "#cf3339" : "rgba(255,255,255,0.06)", color: i<=1 ? "#fff" : "rgba(255,255,255,0.25)" }}>{i+1}</div>
            <span className="text-[10px]" style={{ color: i<=1 ? "#f87171" : "rgba(255,255,255,0.2)" }}>{s}</span>
            {i<3 && <ChevronRight className="w-2 h-2" style={{ color: "rgba(255,255,255,0.1)" }} />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1 mb-2">
        {[{ f: "clients.csv", r: "47 clients" },{ f: "invoice_details.csv", r: "312 invoices" },{ f: "time_entries.csv", r: "2,847 entries" },{ f: "expenses.csv", r: "89 expenses" }].map((f,i) => (
          <div key={i} className="flex items-center gap-1 p-1 rounded" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)" }}>
            <span className="text-[12px]">{"\u2705"}</span><div className="flex-1"><p className="text-[11px] font-medium text-white">{f.f}</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>{f.r}</p></div>
          </div>
        ))}
      </div>
      <div className="rounded p-1.5 mb-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-3 gap-2">
          {[{ l: "Records", v: "3,295" },{ l: "Date range", v: "Jan 2024 \u2013 Mar 2026" },{ l: "Integrity", v: "SHA-256 \u2713" }].map((d,i) => (
            <div key={i}><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>{d.l}</p><p className="text-[11px] font-bold text-white">{d.v}</p></div>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5"><div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>Execute Import</div><div className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>Rollback</div></div>
    </MockupShell>
  );
}

function TeamMockup() {
  return (
    <MockupShell url="cherryworkspro.com/team" activeNav="Team">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Team</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>5 active members &middot; 1 pending invite</p></div>
        <div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>+ Invite Member</div>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-7 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>
          {["NAME","EMAIL","ROLE","TYPE","PAYMENT","ONBOARDING","ACTIONS"].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}
        </div>
        {[
          { init: "DD", name: "Alex Morgan", email: "alex@acme...", role: "ADMIN", type: "\u2014", pay: "\u2014", status: "Complete", sC: "#22c55e" },
          { init: "SK", name: "Sarah Kim", email: "sarah@acme...", role: "TEAM_MEMBER", type: "1099", pay: "ACH", status: "Complete", sC: "#22c55e" },
          { init: "MR", name: "Mike Rivera", email: "mike@tech...", role: "TEAM_MEMBER", type: "C2C", pay: "Wire", status: "Complete", sC: "#22c55e" },
          { init: "AL", name: "Anna Lopez", email: "anna@dev...", role: "TEAM_MEMBER", type: "W-2", pay: "Payroll", status: "Complete", sC: "#22c55e" },
          { init: "JT", name: "James Torres", email: "james@data...", role: "TEAM_MEMBER", type: "1099", pay: "Zelle", status: "Complete", sC: "#22c55e" },
          { init: "??", name: "rob@newco.com", email: "rob@newco...", role: "TEAM_MEMBER", type: "1099", pay: "\u2014", status: "Invited", sC: "#f59e0b" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-7 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: r.init === "??" ? "rgba(245,158,11,0.2)" : `${r.sC}20`, color: r.init === "??" ? "#f59e0b" : r.sC }}>{r.init}</div><span className="text-[12px] font-medium text-white truncate">{r.name}</span></div>
            <span className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{r.email}</span>
            <span className="text-[10px] font-bold" style={{ color: r.role === "ADMIN" ? "#a855f7" : "rgba(255,255,255,0.4)" }}>{r.role}</span>
            <span className="text-[11px]" style={{ color: r.type === "1099" ? "#3b82f6" : r.type === "C2C" ? "#f59e0b" : r.type === "W-2" ? "#22c55e" : "rgba(255,255,255,0.2)" }}>{r.type}</span>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>{r.pay}</span>
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold w-fit" style={{ background: `${r.sC}12`, color: r.sC }}>{r.status}</span>
            <div className="flex gap-0.5"><div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Eye className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div></div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>3 &times; 1099</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>1 &times; C2C</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>1 &times; W-2</span>
      </div>
    </MockupShell>
  );
}

function EstimatesMockup() {
  return (
    <MockupShell url="cherryworkspro.com/estimates" activeNav="Dashboard">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Estimates</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>8 estimates &middot; $124,500 total</p></div>
        <div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>+ New Estimate</div>
      </div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "SENT", v: "3", c: "#3b82f6" },{ l: "ACCEPTED", v: "4", c: "#22c55e" },{ l: "DECLINED", v: "1", c: "#ef4444" },{ l: "DRAFT", v: "2", c: "#6b7280" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-6 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>{["#","CLIENT","AMOUNT","STATUS","SENT",""].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}</div>
        {[
          { num: "EST-0012", client: "Acme Corp", amt: "$24,800", st: "ACCEPTED", c: "#22c55e", sent: "Mar 10" },
          { num: "EST-0013", client: "TechFlow Inc", amt: "\u20ac18,500", st: "SENT", c: "#3b82f6", sent: "Mar 18" },
          { num: "EST-0014", client: "Global Media", amt: "\u00a312,000", st: "SENT", c: "#3b82f6", sent: "Mar 22" },
          { num: "EST-0015", client: "StartupXYZ", amt: "$8,400", st: "DECLINED", c: "#ef4444", sent: "Mar 15" },
          { num: "EST-0016", client: "Meridian Labs", amt: "$32,000", st: "DRAFT", c: "#6b7280", sent: "\u2014" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-6 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>{r.num}</span>
            <span className="text-[12px] font-medium text-white">{r.client}</span>
            <span className="text-[12px] font-sans tabular-nums font-medium text-white">{r.amt}</span>
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold w-fit" style={{ background: `${r.c}12`, color: r.c }}>{r.st}</span>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>{r.sent}</span>
            <div className="flex gap-0.5 justify-end">
              <div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Eye className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div>
              {r.st === "ACCEPTED" && <div className="px-1 py-0.5 rounded text-[12px] font-bold" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>{"\u2192"} Invoice</div>}
              {r.st === "DRAFT" && <div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Send className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div>}
            </div>
          </div>
        ))}
      </div>
    </MockupShell>
  );
}

function RecurringMockup() {
  return (
    <MockupShell url="cherryworkspro.com/invoices/recurring" activeNav="Invoices">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Recurring Templates</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>4 active templates</p></div>
        <div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>+ New Template</div>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-7 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>{["CLIENT","AMOUNT","INTERVAL","NEXT GEN","AUTO-SEND","STATUS",""].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}</div>
        {[
          { client: "Acme Corp", amt: "$4,500/mo", int: "Monthly", next: "Apr 1", auto: "Yes", st: "Active", c: "#22c55e" },
          { client: "TechFlow Inc", amt: "\u20ac2,800/mo", int: "Monthly", next: "Apr 1", auto: "Yes", st: "Active", c: "#22c55e" },
          { client: "Global Media", amt: "\u00a38,000/qtr", int: "Quarterly", next: "Jul 1", auto: "No", st: "Active", c: "#22c55e" },
          { client: "StartupXYZ", amt: "$1,200/mo", int: "Monthly", next: "\u2014", auto: "Yes", st: "Paused", c: "#f59e0b" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-7 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
            <span className="text-[12px] font-medium text-white">{r.client}</span>
            <span className="text-[12px] font-sans tabular-nums font-medium text-white">{r.amt}</span>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>{r.int}</span>
            <span className="text-[11px]" style={{ color: r.next === "\u2014" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.4)" }}>{r.next}</span>
            <span className="text-[11px]" style={{ color: r.auto === "Yes" ? "#22c55e" : "rgba(255,255,255,0.3)" }}>{r.auto}</span>
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold w-fit" style={{ background: `${r.c}12`, color: r.c }}>{r.st}</span>
            <div className="flex gap-0.5 justify-end">
              <div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Eye className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div>
              <div className="w-3 h-3 rounded flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Zap className="w-1.5 h-1.5" style={{ color: "rgba(255,255,255,0.3)" }} /></div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>Total recurring: $15,500/mo equivalent</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>3 auto-send enabled</span>
      </div>
    </MockupShell>
  );
}

function SecurityMockup() {
  return (
    <MockupShell url="cherryworkspro.com/admin/audit" activeNav="Settings">
      <div className="mb-2"><p className="text-xs font-bold text-white">Audit Log</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Every financial event, tracked and immutable</p></div>
      <div className="grid grid-cols-3 gap-1 mb-2">
        {[{ l: "EVENTS TODAY", v: "47", c: "#3b82f6" },{ l: "USERS ACTIVE", v: "5", c: "#22c55e" },{ l: "SECURITY ALERTS", v: "0", c: "#22c55e" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        {[
          { time: "2:34 PM", user: "Alex M.", action: "INVOICE_SENT", detail: "INV-0048 \u00b7 \u20ac8,750 \u00b7 TechFlow", icon: "\ud83d\udce4", c: "#3b82f6" },
          { time: "2:31 PM", user: "Alex M.", action: "PAYOUT_AUTO_CREATED", detail: "$2,340 \u00b7 Mike Rivera", icon: "\ud83d\udcb0", c: "#a855f7" },
          { time: "2:28 PM", user: "Alex M.", action: "EXPENSE_APPROVED", detail: "$485 \u00b7 Delta Airlines \u00b7 Sarah Kim", icon: "\u2705", c: "#22c55e" },
          { time: "1:45 PM", user: "Sarah K.", action: "TIMESHEET_SUBMITTED", detail: "Week Mar 23-29 \u00b7 42.0h", icon: "\ud83d\udccb", c: "#3b82f6" },
          { time: "1:22 PM", user: "Mike R.", action: "EXPENSE_SUBMITTED", detail: "\u20ac129.99 \u00b7 AWS", icon: "\ud83d\udce8", c: "#3b82f6" },
          { time: "12:55 PM", user: "Alex M.", action: "PAYMENT_RECORDED", detail: "$12,400 \u00b7 Acme Corp \u00b7 INV-0047", icon: "\ud83d\udcb3", c: "#22c55e" },
          { time: "11:30 AM", user: "Anna L.", action: "TIME_ENTRY_CREATED", detail: "8h \u00b7 Acme Redesign \u00b7 UX Design", icon: "\u23f1", c: "#6b7280" },
          { time: "10:15 AM", user: "Alex M.", action: "USER_INVITED", detail: "rob@newco.com \u00b7 1099 Independent", icon: "\ud83d\udc64", c: "#a855f7" },
        ].map((r,i) => (
          <div key={i} className="flex items-center px-2 py-1.5 gap-2" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
            <span className="text-[11px] w-10 tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>{r.time}</span>
            <span className="text-[12px]">{r.icon}</span>
            <span className="text-[11px] font-medium w-12" style={{ color: "rgba(255,255,255,0.5)" }}>{r.user}</span>
            <span className="text-[10px] font-sans tabular-nums px-1 py-0.5 rounded" style={{ background: `${r.c}10`, color: r.c }}>{r.action}</span>
            <span className="text-[11px] flex-1 truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{r.detail}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>{"\ud83d\udd12"} Org-isolated</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>{"\ud83d\udee1"} Role-based access</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}>{"\ud83d\udcdd"} Immutable log</span>
      </div>
    </MockupShell>
  );
}

function CherryAssistMockup() {
  return (
    <div className="rounded-2xl overflow-hidden w-full max-w-md mx-auto" style={{ border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>
              <Bot className="w-4 h-4 text-white" />
              <span className="text-[12px] font-bold text-white">CherryAssist</span>
              <span className="ml-auto text-[10px] text-white/60">Online</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="p-3 space-y-2.5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="flex justify-end">
                <div className="rounded-lg px-3 py-2 max-w-[220px]" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.2)" }}>
                  <p className="text-[11px] text-white">How do I set up recurring invoices?</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 max-w-[250px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>Great question! Here's how to set up recurring invoices:</p>
                  <div className="mt-1.5 space-y-1">
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}><span className="font-bold" style={{ color: "#f87171" }}>1.</span> Go to Invoices and click "Recurring Templates"</p>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}><span className="font-bold" style={{ color: "#f87171" }}>2.</span> Click "+ New Template", select client, amount, and interval (monthly/quarterly)</p>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}><span className="font-bold" style={{ color: "#f87171" }}>3.</span> Toggle "Auto-send" to email invoices automatically on schedule</p>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}><CheckCircle className="w-2 h-2" style={{ color: "#22c55e" }} /></div>
                    <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>Verified answer</span>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="rounded-lg px-3 py-2 max-w-[220px]" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.2)" }}>
                  <p className="text-[11px] text-white">Can I pause a recurring template?</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 max-w-[250px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>Yes! Open the template and click "Pause". It will stop generating new invoices until you resume it. Existing invoices are unaffected.</p>
                </div>
              </div>
            </div>
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <div className="flex-1 rounded px-2 py-1 text-[11px]" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.25)" }}>Ask CherryAssist anything...</div>
        <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "rgba(207,51,57,0.15)" }}><Send className="w-2.5 h-2.5" style={{ color: "#f87171" }} /></div>
      </div>
    </div>
  );
}

function AIReceiptMockup() {
  return (
    <MockupShell url="cherryworkspro.com/expenses/scan" activeNav="Expenses">
      <div className="mb-2"><p className="text-xs font-bold text-white">AI Receipt Scanner</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Upload and extract in seconds</p></div>
      <div className="flex gap-3">
        <div className="w-[45%] rounded-xl p-3 flex flex-col items-center justify-center relative" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.12)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>
          <div className="absolute top-1.5 right-1.5 px-1 py-0.5 rounded text-[8px] font-bold" style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc" }}>SCANNED</div>
          <div className="w-full rounded-lg p-2 mb-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
            <div className="text-center mb-1"><Receipt className="w-5 h-5 mx-auto" style={{ color: "rgba(255,255,255,0.3)" }} /></div>
            <p className="text-[10px] font-bold text-center text-white mb-1">STAPLES</p>
            <div className="space-y-0.5">
              {["Office Paper x3......$45.00","Ink Cartridge........$89.50","USB Hub..............$34.00","Desk Organizer.......$29.00","Pens (12-pack).......$12.50","Sticky Notes.........$8.50","Binder Clips..........$6.00","Tape Dispenser.......$11.00","Folder Set...........$12.00"].map((l,i) => (
                <p key={i} className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{l}</p>
              ))}
              <div className="mt-1 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-[9px] font-mono font-bold text-white">TOTAL          $247.50</p>
                <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>03/15/2026  Store #4821</p>
              </div>
            </div>
          </div>
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>receipt_staples.jpg</span>
        </div>
        <div className="flex items-center flex-col gap-1"><ArrowRight className="w-4 h-4" style={{ color: "#cf3339" }} /><span className="text-[8px] font-bold" style={{ color: "rgba(207,51,57,0.5)" }}>AI</span></div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="px-2 py-0.5 rounded-lg text-[10px] font-bold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.15)", boxShadow: "0 0 8px rgba(34,197,94,0.1)" }}>AI Verified</div>
            <div className="flex items-center gap-0.5">
              <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: "98%", background: "linear-gradient(90deg, #22c55e, #4ade80)" }} /></div>
              <span className="text-[10px] font-bold" style={{ color: "#22c55e" }}>98%</span>
            </div>
          </div>
          {[
            { l: "Vendor", v: "Staples", c: "white" },
            { l: "Amount", v: "$247.50", c: "#22c55e" },
            { l: "Date", v: "Mar 15, 2026", c: "white" },
            { l: "Category", v: "Office Supplies", c: "#3b82f6" },
            { l: "Tax", v: "$0.00", c: "rgba(255,255,255,0.4)" },
            { l: "Payment", v: "Visa *4821", c: "rgba(255,255,255,0.4)" },
          ].map((f,i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{f.l}</span>
              <span className="text-[11px] font-medium" style={{ color: f.c }}>{f.v}</span>
            </div>
          ))}
          <div className="flex gap-1.5 mt-2">
            <div className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>Create Expense</div>
            <div className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>Edit Fields</div>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

function SmartDashboardMockup() {
  return (
    <MockupShell url="cherryworkspro.com/dashboard" activeNav="Dashboard">
      <div className="mb-2"><p className="text-xs font-bold text-white">Admin Dashboard</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>March 2026 Overview</p></div>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {[{ l: "TOTAL REVENUE", v: "$184,250", c: "white", d: "+12% MoM" },{ l: "COLLECTED", v: "$156,800", c: "#22c55e", d: "85.1%" },{ l: "OUTSTANDING", v: "$27,450", c: "#f59e0b", d: "6 invoices" },{ l: "OVERDUE", v: "$8,200", c: "#ef4444", d: "2 invoices" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p>
            <p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p>
            <p className="text-[10px]" style={{ color: s.c === "white" ? "rgba(255,255,255,0.25)" : `${s.c}80` }}>{s.d}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-1"><p className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>Revenue Trend</p><span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>+12%</span></div>
          <div className="flex items-end gap-0.5 h-10">
            {[
              { inv: 22, col: 18 },{ inv: 28, col: 24 },{ inv: 32, col: 28 },{ inv: 26, col: 25 },{ inv: 38, col: 30 },{ inv: 34, col: 31 },{ inv: 42, col: 35 },
            ].map((v,i) => (
              <div key={i} className="flex-1 flex flex-col gap-[1px] items-center">
                <div className="w-full rounded-t" style={{ height: `${v.inv * 0.9}%`, background: i===6 ? "#cf3339" : `rgba(207,51,57,${0.2+i*0.08})` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-0.5">{["Sep","Oct","Nov","Dec","Jan","Feb","Mar"].map(m => (<span key={m} className="text-[12px]" style={{ color: "rgba(255,255,255,0.2)" }}>{m}</span>))}</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="text-[11px] font-bold mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>AR Aging</p>
          {[{ l: "Current", pct: 55, c: "#22c55e", a: "$15.1K" },{ l: "1-30d", pct: 25, c: "#f59e0b", a: "$6.9K" },{ l: "31-60d", pct: 12, c: "#ef4444", a: "$3.3K" },{ l: "90d+", pct: 8, c: "#991b1b", a: "$2.1K" }].map((b,i) => (
            <div key={i} className="flex items-center gap-1 mb-0.5"><span className="text-[10px] w-8" style={{ color: "rgba(255,255,255,0.4)" }}>{b.l}</span><div className="flex-1 h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${b.pct}%`, background: b.c }} /></div><span className="text-[10px] font-sans tabular-nums" style={{ color: b.c }}>{b.a}</span></div>
          ))}
        </div>
      </div>
      <div className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <p className="text-[11px] font-bold mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Team Utilization</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {[{ n: "Sarah K.", p: 92, c: "#22c55e" },{ n: "Mike R.", p: 85, c: "#22c55e" },{ n: "Anna L.", p: 78, c: "#f59e0b" },{ n: "James T.", p: 64, c: "#f59e0b" }].map((u,i) => (
            <div key={i} className="flex items-center gap-1"><span className="text-[10px] w-10 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{u.n}</span><div className="flex-1 h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${u.p}%`, background: u.c }} /></div><span className="text-[10px] font-sans tabular-nums" style={{ color: u.c }}>{u.p}%</span></div>
          ))}
        </div>
      </div>
    </MockupShell>
  );
}

function PaymentRemindersMockup() {
  return (
    <div className="rounded-2xl overflow-hidden w-full" style={{ background: "#0b1222", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
      <div className="p-4 flex gap-4">
        <div className="flex-1 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-3 py-1.5 flex items-center gap-1" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <Send className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-[10px] font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>EMAIL PREVIEW</span>
          </div>
          <div className="p-3" style={{ background: "rgba(255,255,255,0.015)" }}>
            <div className="mb-2">
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>To: billing@acmecorp.com</p>
              <p className="text-[11px] font-bold text-white">Re: Friendly Reminder &mdash; Invoice INV-0049 is 7 days overdue</p>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-[11px] mb-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>Hi Acme Corp,</p>
              <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>This is a friendly reminder that Invoice <span className="font-bold text-white">INV-0049</span> for <span className="font-bold" style={{ color: "#ef4444" }}>&pound;5,200.00</span> was due on <span className="text-white">March 20, 2026</span> and is now 7 days overdue.</p>
              <div className="flex gap-1.5 mb-2">
                <div className="px-2 py-1 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>Pay Now</div>
                <div className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>View Invoice</div>
              </div>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>PDF attached &middot; Sent via CherryWorks Pro</p>
            </div>
          </div>
        </div>
        <div className="w-[100px] flex-shrink-0 flex flex-col items-center py-2">
          <p className="text-[10px] font-bold uppercase mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>Schedule</p>
          {[
            { day: "Day 3", active: true, sent: true },
            { day: "Day 7", active: true, sent: true },
            { day: "Day 14", active: false, sent: false },
            { day: "Day 30", active: false, sent: false },
          ].map((s,i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full flex items-center justify-center" style={{ background: s.sent ? "#22c55e" : s.active ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.06)" }}>
                {s.sent && <CheckCircle className="w-2 h-2 text-white" />}
              </div>
              <span className="text-[10px] font-bold mt-0.5" style={{ color: s.sent ? "#22c55e" : "rgba(255,255,255,0.25)" }}>{s.day}</span>
              {s.sent && <span className="text-[9px]" style={{ color: "#22c55e" }}>Sent</span>}
              {i < 3 && <div className="w-px h-4" style={{ background: "rgba(255,255,255,0.06)" }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupWizardMockup() {
  return (
    <MockupShell url="cherryworkspro.com/setup" activeNav="Dashboard">
      <div className="mb-2"><p className="text-xs font-bold text-white">Getting Started</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>4 of 5 steps complete</p></div>
      <div className="flex gap-3">
        <div className="w-[140px] flex-shrink-0 space-y-1">
          {[
            { s: "1", t: "Firm Profile", done: true },
            { s: "2", t: "Services & Rates", done: true },
            { s: "3", t: "First Client", done: true },
            { s: "4", t: "Invite Team", done: false, active: true },
            { s: "5", t: "First Invoice", done: false },
          ].map((step,i) => (
            <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: step.active ? "rgba(207,51,57,0.08)" : "transparent", border: step.active ? "1px solid rgba(207,51,57,0.15)" : "1px solid transparent" }}>
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: step.done ? "#22c55e" : step.active ? "#cf3339" : "rgba(255,255,255,0.06)", color: step.done || step.active ? "#fff" : "rgba(255,255,255,0.25)" }}>
                {step.done ? <CheckCircle className="w-2.5 h-2.5" /> : step.s}
              </div>
              <span className="text-[10px] font-medium" style={{ color: step.done ? "#22c55e" : step.active ? "#f87171" : "rgba(255,255,255,0.3)" }}>{step.t}</span>
            </div>
          ))}
          <div className="mt-2 rounded p-1.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center justify-between mb-1"><span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Progress</span><span className="text-[10px] font-bold" style={{ color: "#f87171" }}>80%</span></div>
            <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: "80%", background: "linear-gradient(90deg, #cf3339, #e74c3c)" }} /></div>
          </div>
        </div>
        <div className="flex-1 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
          <p className="text-[11px] font-bold text-white mb-0.5">Step 4: Invite Team Members</p>
          <p className="text-[10px] mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Add your first team member to start tracking time</p>
          <div className="space-y-1.5">
            <div>
              <p className="text-[10px] font-bold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Email Address</p>
              <div className="rounded px-2 py-1 text-[11px]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "white" }}>sarah@consulting.com</div>
            </div>
            <div>
              <p className="text-[10px] font-bold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Worker Type</p>
              <div className="rounded px-2 py-1 text-[11px] flex items-center justify-between" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color: "#3b82f6" }}>1099 Independent</span>
                <ChevronRight className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.2)", transform: "rotate(90deg)" }} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Role</p>
              <div className="rounded px-2 py-1 text-[11px] flex items-center justify-between" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>Team Member</span>
                <ChevronRight className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.2)", transform: "rotate(90deg)" }} />
              </div>
            </div>
          </div>
          <div className="flex gap-1 mt-2.5">
            <div className="px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>Send Invite</div>
            <div className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>Skip for Now</div>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

function AuditTrailMockup() {
  return (
    <MockupShell url="cherryworkspro.com/admin/audit" activeNav="Settings">
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-xs font-bold text-white">Audit Trail</p><p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Complete history of every action</p></div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>Export</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>Filter</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 mb-2">
        {[{ l: "TOTAL EVENTS", v: "1,247", c: "#3b82f6" },{ l: "TODAY", v: "23", c: "#22c55e" },{ l: "USERS", v: "5", c: "#a855f7" }].map((s,i) => (
          <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.l}</p><p className="text-xs font-bold" style={{ color: s.c }}>{s.v}</p></div>
        ))}
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="grid grid-cols-5 px-2 py-1" style={{ background: "rgba(255,255,255,0.03)" }}>
          {["TIMESTAMP","USER","ACTION","ENTITY","DETAILS"].map((h,i) => (<span key={i} className="text-[10px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>))}
        </div>
        {[
          { time: "Mar 28, 10:15am", user: "Sarah K.", action: "INVOICE_SENT", entity: "INV-0052", detail: "Sent to Acme Corp, $12,450.00", aC: "#3b82f6" },
          { time: "Mar 28, 09:30am", user: "Admin", action: "PAYMENT_APPLIED", entity: "PAY-0089", detail: "$5,000.00 applied to INV-0048", aC: "#22c55e" },
          { time: "Mar 27, 04:45pm", user: "Mike R.", action: "TIMESHEET_SUBMITTED", entity: "TS-0147", detail: "Week Mar 23-29, 38.5h", aC: "#a855f7" },
          { time: "Mar 27, 03:12pm", user: "Admin", action: "EXPENSE_APPROVED", entity: "EXP-0091", detail: "$485 Delta Airlines, Sarah K.", aC: "#22c55e" },
          { time: "Mar 27, 01:00pm", user: "Anna L.", action: "GL_ENTRY_POSTED", entity: "JE-0234", detail: "Manual adjustment, $1,200 DR/CR", aC: "#f59e0b" },
        ].map((r,i) => (
          <div key={i} className="grid grid-cols-5 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 1 ? "rgba(255,255,255,0.01)" : "transparent" }}>
            <span className="text-[10px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>{r.time}</span>
            <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>{r.user}</span>
            <span className="text-[10px] font-bold px-1 py-0.5 rounded w-fit" style={{ background: `${r.aC}10`, color: r.aC }}>{r.action}</span>
            <span className="text-[11px] font-sans tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>{r.entity}</span>
            <span className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{r.detail}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>Org-isolated</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>JSON payloads</span>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>Immutable &middot; Tamper-proof</span>
      </div>
    </MockupShell>
  );
}

const featureGroups: { id: string; icon: any; title: string; subtitle: string; description: string; highlights: string[]; mockup?: string }[] = [
  { id: "time", icon: Clock, title: "Time Tracking", subtitle: "Every hour, accounted for", description: "Three views (week, month, day), start/end time pickers, a floating timer widget, and one-click cell entry. Your team logs time the way that works for them.", highlights: ["Week, month, and day calendar views", "Start/end time pickers with auto-duration", "Floating timer widget for live tracking", "Billable vs non-billable classification", "Service category per entry", "Bulk select and delete"], mockup: "time" },
  { id: "invoicing", icon: FileText, title: "Invoicing", subtitle: "From billable hours to cash collected", description: "Generate invoices from unbilled time in seconds. Add discounts, tax, and custom lines. Send with PDF attachment. Track status from draft through paid. Multi-currency for global clients.", highlights: ["One-click invoice from billable hours", "Group by team member or combine", "Discount (% or fixed) and tax rate", "Email with PDF attachment", "Status: Draft \u2192 Sent \u2192 Partial \u2192 Paid \u2192 Void", "Multi-currency (30+ currencies)", "Recurring invoice templates", "Stripe Checkout integration"], mockup: "invoicing" },
  { id: "reports", icon: BarChart3, title: "Enterprise-Grade Reports & Dashboards", subtitle: "Better reporting than platforms charging ten times the price", description: "Comprehensive reporting suite, zero setup. Revenue trends, AR aging, utilization, profitability, WIP, cash flow, collections, payout tracking, expense analytics, and 1099 export.", highlights: ["Financial: Revenue, Cash Flow, Budget Burn, Collections", "Receivables: AR Aging, Overdue Detail, Invoice Status", "Operations: WIP, Timesheet Compliance, Profitability", "Team: Utilization, Labor by Worker Type, Earnings", "Payouts & Tax: Detail, Summary, 1099 Export", "Expenses: By Category, By Project, By Team Member"], mockup: "reports" },
  { id: "dashboard", icon: LayoutDashboard, title: "Smart Dashboard", subtitle: "Your entire business at a glance", description: "Two purpose-built dashboards — Admin sees revenue, AR aging, utilization, and overdue invoices. Team members see their hours, earnings, and active projects. Every metric is clickable for drill-down detail.", highlights: ["Admin dashboard with revenue and collections metrics", "AR aging buckets (Current, 30, 60, 90+ days) with drill-down", "Utilization tracking by team member with billable vs total hours", "Revenue by month chart (invoiced vs collected)", "Team member dashboard with personal hours and earnings", "Active project and overdue invoice quick-access lists"], mockup: "dashboard" },
  { id: "timesheets", icon: ClipboardCheck, title: "Timesheet Approval Workflow", subtitle: "Verified hours. Locked records. Clean invoices.", description: "Team members submit weekly timesheets. You approve or reject with a reason. Approved weeks lock automatically so invoices are always based on verified, immutable time.", highlights: ["Submit \u2192 Approve \u2192 Lock lifecycle", "Reject with mandatory reason", "Admin unlock with audit trail", "Bulk approve/reject", "Locked weeks prevent edits", "Pending count badge for admin"], mockup: "timesheets" },
  { id: "payouts", icon: DollarSign, title: "Payout Tracking", subtitle: "The feature no one else has", description: "When you send an invoice, CherryWorks Pro automatically creates a pending payout for each 1099 and Corp-to-Corp team member. Expense reimbursements create payouts too. W-2 employees are excluded \u2014 they're on your payroll.", highlights: ["Auto-created PENDING payout on invoice send", "Expense reimbursement auto-payouts", "Bill rate vs cost rate per team member per project", "Outstanding balance dashboard", "ACH, Zelle, Check, Wire tracking", "Void and re-issue payouts", "1099-ready export at year end"], mockup: "payouts" },
  { id: "estimates", icon: FileText, title: "Estimates & Proposals", subtitle: "Win work before you track it", description: "Create detailed estimates, send to clients with a branded public link, and convert accepted estimates into invoices with one click.", highlights: ["Line items, discounts, tax", "Branded portal link", "Client accepts or declines online", "Convert to invoice on acceptance", "Status: Draft \u2192 Sent \u2192 Accepted/Declined"], mockup: "estimates" },
  { id: "portal", icon: Users, title: "Client Portal", subtitle: "Professional, branded, self-service", description: "Every client gets a secure portal link to view invoices, check payment history, see outstanding balances, and download PDFs. Overdue alerts. No login required \u2014 secure token access.", highlights: ["Secure token-based access", "Invoice history with status badges", "Payment history and outstanding balance", "Overdue alerts with days-past-due", "PDF download for any invoice", "Branded with your firm's identity"], mockup: "portal" },
  { id: "expenses", icon: Receipt, title: "Expense Management", subtitle: "The complete expense lifecycle", description: "Create, categorize, submit, approve, and reimburse expenses \u2014 in any currency. Upload receipts, group into batch reports, and watch auto-reimbursement payouts appear the moment you approve.", highlights: ["Create with vendor, category, GL codes, project", "Upload receipt photos and PDFs", "Submit \u2192 Approve \u2192 Reimburse workflow", "Rejection with mandatory reason", "Batch expense reports", "Auto-reimbursement payouts on approval", "Multi-currency expense logging", "Expense cost flows into project profitability"], mockup: "expenses" },
  { id: "aireceipt", icon: ScanLine, title: "AI Receipt Scanner", subtitle: "Snap it. Scan it. Done.", description: "AI-powered receipt scanning extracts vendor, amount, date, and category from photos or PDFs instantly. No manual data entry \u2014 just upload and let AI do the work.", highlights: ["Upload receipt photos or PDFs", "AI extracts vendor name, amount, date, and category automatically", "Auto-matches to expense categories", "Supports multi-currency receipt scanning", "Works with any receipt format worldwide", "Attach scanned data directly to expense entries"], mockup: "aireceipt" },
  { id: "projects", icon: FolderKanban, title: "Project Command Center", subtitle: "Budget, team, profitability \u2014 one screen", description: "Every project gets a dedicated command center with budget tracking, team member hours, and profitability analysis that includes both labor cost and expense cost vs. revenue.", highlights: ["Budget hours with progress tracking", "Hours by team member visualization", "Profitability: revenue vs labor + expense cost", "Tabbed: Time, Invoices, Estimates, Services", "Assign team members with bill + cost rates", "Project-specific service filtering"], mockup: "projects" },
  { id: "global", icon: Globe, title: "Multi-Currency", subtitle: "One platform. Every currency.", description: "Invoice clients in 30+ currencies with live exchange rates. Each client gets their own billing currency. Expenses logged in local currency, converted automatically for reporting.", highlights: ["30+ currencies with live exchange rates", "Per-client billing currency", "Automatic conversion for reporting", "Multi-currency expense logging", "Multi-currency reporting rollups"], mockup: "global" },
  { id: "recurring", icon: Repeat, title: "Recurring Invoices", subtitle: "Set it and forget it", description: "Create templates for recurring engagements. Auto-generate and auto-send invoices on your schedule.", highlights: ["Monthly, quarterly, or custom intervals", "Auto-generate from templates", "Auto-send on schedule", "Pause and resume anytime"], mockup: "recurring" },
  { id: "team", icon: UserPlus, title: "Team Onboarding", subtitle: "From invite to productive in 5 minutes", description: "Invite any team member by email \u2014 choose their worker classification (1099, W-2, or Corp-to-Corp) at invite time. Smart onboarding adapts the wizard to the worker type.", highlights: ["Choose worker type: 1099, W-2, or Corp-to-Corp", "5-step wizard for team members", "3-step wizard for W-2 employees", "ACH or Zelle payment preference", "EIN, W-9, team member agreement capture", "Conditional fields by worker type"], mockup: "team" },
  { id: "setupwizard", icon: Rocket, title: "Up and Running in 5 Minutes", subtitle: "A guided setup that actually guides", description: "Five-step wizard walks you through everything \u2014 firm profile, services and rates, first client, team invites, and your first invoice. No onboarding calls, no outside help, no confusion. You are live on day one.", highlights: ["Step 1: Firm profile with address, currency, and tax settings", "Step 2: Define your services and billing rates", "Step 3: Add your first client", "Step 4: Invite team members with worker type classification", "Step 5: Generate and send your first invoice", "Progress tracking shows completion status"], mockup: "setupwizard" },
  { id: "accounting", icon: BookOpen, title: "Accounting & General Ledger", subtitle: "Double-entry accounting that runs itself", description: "A full general ledger with Chart of Accounts, journal entries, trial balance, and date-filtered reports. Five financial events auto-generate balanced journal entries so your books stay current without manual data entry.", highlights: ["Chart of Accounts with 18 seeded default accounts", "Auto-generated journal entries from 5 financial events", "Invoice sent, payment received, payout completed, expense approved, expense reimbursed", "Manual journal entry creation with live debit/credit balancing", "General Ledger report with date filters and expandable account rows", "Trial Balance report with as-of date and CSV export", "Accounts grouped by type: Assets, Liabilities, Equity, Revenue, Expenses", "One-click GL migration to replay all historical data"], mockup: "accounting" },
  { id: "bankrecon", icon: Landmark, title: "Bank Reconciliation", subtitle: "Match every transaction automatically", description: "Import bank statements in CSV or OFX format, and let our auto-matching algorithm reconcile every transaction against your invoices, payments, and payouts. Handle the rest with manual matching. One-click reconcile when balanced, with a full audit trail of every reconciliation.", highlights: ["Import bank statements (CSV/OFX)", "Auto-matching algorithm matches transactions to invoices, payments, and payouts", "Manual match for unmatched items", "Reconciliation status dashboard", "Date-range filtering", "Matched vs unmatched summary with totals", "One-click reconcile when balanced", "Full audit trail of reconciliation history"], mockup: "bankrecon" },
  { id: "import", icon: Upload, title: "Switch From Anything", subtitle: "Import wizards for every major platform", description: "Bring your data from FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, or Paymo. Upload your exports, preview with dry-run, execute with one click, and roll back if needed.", highlights: ["FreshBooks, QuickBooks, Harvest, Xero, Wave, BigTime, Scoro, Paymo", "Upload CSV/Excel exports", "SHA-256 integrity check", "Dry-run preview before executing", "Idempotent \u2014 re-run without duplicates", "Full rollback per import run", "5-minute migration for most firms"], mockup: "import" },
  { id: "reminders", icon: Bell, title: "Automated Payment Reminders", subtitle: "Get paid without the awkward follow-up", description: "Configure automatic email reminders for overdue invoices at intervals you choose. Professional branded emails include invoice PDF attachments and direct payment links. Rate-limited to one per invoice per day so clients are never spammed.", highlights: ["Configurable reminder intervals (3, 7, 14, 30 days overdue)", "Customizable email templates with merge variables", "Invoice PDF automatically attached to every reminder", "Direct payment link included for one-click pay", "Rate-limited to prevent over-sending", "Works with your custom SMTP for branded delivery"], mockup: "reminders" },
  { id: "security", icon: Shield, title: "Enterprise-Grade Security", subtitle: "Your data is sacred", description: "Session-based authentication, org-scoped data isolation, role-based access control, audit logging, rate-limited APIs, and CSRF protection.", highlights: ["Org-scoped tenant isolation", "Role-based access control", "Audit log for every financial mutation", "Rate-limited APIs", "CSRF and XSS protection"], mockup: "security" },
  { id: "audittrail", icon: ScrollText, title: "Complete Audit Trail", subtitle: "Every action. Every user. Every timestamp.", description: "Every financial mutation \u2014 invoice sent, payment applied, timesheet approved, expense submitted, GL entry posted \u2014 is logged with who did it, when, and full before-and-after details. Enterprise compliance without enterprise complexity.", highlights: ["Automatic logging of all financial events", "User attribution on every action", "Timestamped entries with full detail context", "Covers invoices, payments, timesheets, expenses, GL entries, and imports", "JSON detail payload for forensic-level audit", "Org-scoped isolation ensures complete data privacy"], mockup: "audittrail" },
  { id: "cherryassist", icon: Bot, title: "CherryAssist AI", subtitle: "24/7 intelligent support — included with Professional plans", description: "CherryAssist is your AI-powered support agent, trained on every feature, workflow, and report in CherryWorks Pro. Ask it anything — from setting up your first client to understanding complex profitability reports. Instant answers, around the clock, no tickets, no waiting.", highlights: ["Instant answers to any product question", "Available 24/7 — nights, weekends, holidays", "Trained on every feature, report, and workflow", "Contextual help inside the app", "No tickets, no email queues, no waiting", "Included on Professional, Business, and Enterprise plans"], mockup: "cherryassist" },
];

function ImportShowcase() {
  const platforms = [{ name: "FreshBooks", color: "#00b48a", href: "/compare" },{ name: "QuickBooks", color: "#2ca01c", href: "/switch-from-quickbooks" },{ name: "Harvest", color: "#f36c20", href: "/switch-from-harvest" },{ name: "Xero", color: "#13b5ea", href: "/switch-from-xero" },{ name: "Wave", color: "#1c3e5a", href: "/switch-from-wave" },{ name: "BigTime", color: "#ff6600", href: "/switch-from-bigtime" },{ name: "Scoro", color: "#0070c9", href: "/switch-from-scoro" },{ name: "Paymo", color: "#6b5ce7", href: "/switch-from-paymo" }];
  return (
    <section className="py-8 md:py-12" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 100%)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Switch from anything in under 5 minutes</h2>
          <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.5)" }}>Import wizards for every major platform. Upload, preview, execute.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto mb-12">
          {platforms.map((p,i) => (
            <Link key={i} href={p.href}>
              <div className="rounded-xl p-4 text-center transition-all hover:-translate-y-1 cursor-pointer" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid={`switch-card-${p.name.toLowerCase()}`}>
                <div className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center text-[11px] font-bold text-white" style={{ background: p.color }}>{p.name.slice(0,2).toUpperCase()}</div>
                <p className="text-xs font-medium text-white">{p.name}</p>
              </div>
            </Link>
          ))}
        </div>
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[{ s: "1", t: "Upload", d: "Export from your current tool. Upload CSV or Excel." },{ s: "2", t: "Preview", d: "Dry-run shows exactly what imports \u2014 counts, totals, issues." },{ s: "3", t: "Go Live", d: "One click. Idempotent. Fully reversible." }].map((s,i) => (
            <div key={i} className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="w-8 h-8 rounded-full mx-auto mb-3 flex items-center justify-center text-xs font-bold" style={{ background: "rgba(207,51,57,0.15)", color: "#f87171" }}>{s.s}</div>
              <h4 className="text-sm font-bold text-white mb-1">{s.t}</h4>
              <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const newBadgeIds = new Set(["accounting", "aireceipt", "expenses", "payouts"]);
const popularBadgeIds = new Set(["time", "invoicing", "dashboard"]);
const callouts: Record<string, string> = {
  time: "Other platforms charge extra for timer widgets and weekly views",
  invoicing: "Only CherryWorks Pro includes multi-currency invoicing at every tier",
  expenses: "Other platforms charge extra for expense management",
  accounting: "Only CherryWorks Pro includes a full general ledger at every tier",
  aireceipt: "Other platforms charge extra for AI receipt scanning",
  payouts: "Only CherryWorks Pro includes payout tracking at every tier",
  reports: "Other platforms charge extra for advanced reporting",
  dashboard: "Only CherryWorks Pro includes dual dashboards at every tier",
  bankrecon: "Other platforms charge extra for bank reconciliation",
  portal: "Only CherryWorks Pro includes client portals at every tier",
  team: "Other platforms charge per-user fees \u2014 CherryWorks Pro includes unlimited team members",
  recurring: "Other platforms charge extra for recurring invoice automation",
  security: "Only CherryWorks Pro includes enterprise-grade security at every tier",
  cherryassist: "Only CherryWorks Pro includes AI-powered support",
  audittrail: "Only CherryWorks Pro includes a complete audit trail at every tier",
  projects: "Other platforms charge extra for project profitability tracking",
  estimates: "Other platforms charge extra for estimates and proposals",
  reminders: "Other platforms charge extra for automated payment reminders",
  setupwizard: "Only CherryWorks Pro offers 5-minute guided setup at every tier",
  import: "Other platforms make migration a paid service",
  timesheets: "Other platforms charge extra for timesheet approval workflows",
  global: "Other platforms charge extra for multi-currency support",
};

function FeatureSection({ g, mockup, badge, callout }: { g: typeof featureGroups[0]; mockup?: React.ReactNode; badge?: "new" | "popular"; callout?: string }) {
  const fadeRef = useFadeIn();
  const hasMockup = !!mockup;
  return (
    <div ref={fadeRef} id={g.id} className="scroll-mt-32 fade-in-section" data-testid={`feature-section-${g.id}`}>
      {hasMockup ? (
        <div>
          <div className="fade-child stagger-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "rgba(207,51,57,0.1)" }}><g.icon className="w-5 h-5" style={{ color: "#cf3339" }} /></div>
              {badge === "new" && <span className="badge-new px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }} data-testid="badge-new">NEW</span>}
              {badge === "popular" && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }} data-testid="badge-popular">POPULAR</span>}
            </div>
            <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: "#cf3339" }}>{g.subtitle}</p>
          </div>
          <div className="flex flex-col lg:flex-row items-start gap-10 lg:gap-14">
            <div className="w-full lg:w-[40%] flex-shrink-0 fade-child stagger-2">
              <h2 className="text-2xl md:text-3xl font-bold mb-3 text-white">{g.title}</h2>
              <p className="text-lg leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>{g.description}</p>
              {callout && <p className="text-sm italic mb-5 flex items-start gap-1.5" style={{ color: "rgba(207,51,57,0.8)" }}><Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{callout}</p>}
              <ul className="space-y-2">
                {g.highlights.map((h,j) => (<li key={j} className="flex items-start gap-2 text-base" style={{ color: "rgba(255,255,255,0.55)" }}><CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#22c55e" }} />{h}</li>))}
              </ul>
              <Link href="/demo"><span className="inline-flex items-center gap-1.5 mt-6 text-sm font-semibold cursor-pointer transition-colors hover:opacity-80" style={{ color: "#f87171" }} data-testid="see-it-in-action">See it in action <ArrowRight className="w-3.5 h-3.5" /></span></Link>
            </div>
            <div className="w-full lg:w-[60%] fade-child stagger-3">{mockup}</div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-8 md:p-10 fade-child stagger-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-start gap-4 mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.1)" }}><g.icon className="w-5 h-5" style={{ color: "#cf3339" }} /></div>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#cf3339" }}>{g.subtitle}</p>
                <h2 className="text-2xl font-bold text-white">{g.title}</h2>
              </div>
              {badge === "new" && <span className="badge-new px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }} data-testid="badge-new">NEW</span>}
              {badge === "popular" && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }} data-testid="badge-popular">POPULAR</span>}
            </div>
          </div>
          <p className="text-lg leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>{g.description}</p>
          {callout && <p className="text-sm italic mb-5 flex items-start gap-1.5" style={{ color: "rgba(207,51,57,0.8)" }}><Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{callout}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 fade-child stagger-2">
            {g.highlights.map((h,j) => (<div key={j} className="flex items-start gap-2 text-base" style={{ color: "rgba(255,255,255,0.55)" }}><CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#22c55e" }} />{h}</div>))}
          </div>
          <Link href="/demo"><span className="inline-flex items-center gap-1.5 mt-6 text-sm font-semibold cursor-pointer transition-colors hover:opacity-80 fade-child stagger-3" style={{ color: "#f87171" }} data-testid="see-it-in-action">See it in action <ArrowRight className="w-3.5 h-3.5" /></span></Link>
        </div>
      )}
    </div>
  );
}

const featurePills = [
  { label: "Time Tracking", targetId: "time", color: "#3b82f6" },
  { label: "Invoicing", targetId: "invoicing", color: "#eab308" },
  { label: "Reports Suite", targetId: "reports", color: "#22c55e" },
  { label: "Smart Dashboard", targetId: "dashboard", color: "#3b82f6" },
  { label: "Timesheet Approval Workflow", targetId: "timesheets", color: "#8b5cf6" },
  { label: "Team Payouts", targetId: "payouts", color: "#f97316" },
  { label: "Estimates & Proposals", targetId: "estimates", color: "#06b6d4" },
  { label: "Client Portal", targetId: "portal", color: "#f43f5e" },
  { label: "Expense Management", targetId: "expenses", color: "#f59e0b" },
  { label: "AI Receipt Scanner", targetId: "aireceipt", color: "#ec4899" },
  { label: "Project Management", targetId: "projects", color: "#6366f1" },
  { label: "Multi-Currency", targetId: "global", color: "#06b6d4" },
  { label: "Recurring Invoices", targetId: "recurring", color: "#7c3aed" },
  { label: "Team Management", targetId: "team", color: "#84cc16" },
  { label: "Accounting & General Ledger", targetId: "accounting", color: "#14b8a6" },
  { label: "ACH Bank Transfers", targetId: "bankrecon", color: "#10b981" },
  { label: "Import Wizard", targetId: "import", color: "#64748b" },
  { label: "Payment Reminders", targetId: "reminders", color: "#d946ef" },
  { label: "Security & Encryption", targetId: "security", color: "#6b7280" },
  { label: "Audit Trail", targetId: "audittrail", color: "#ef4444" },
  { label: "CherryAssist AI", targetId: "cherryassist", color: "#cf3339" },
  { label: "1099 Compliance", targetId: "payouts", color: "#ef4444" },
  { label: "Marketing", targetId: "marketing", color: "#cf3339" },
];

function FeaturePillMarquee() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let animId: number;
    let pos = 0;
    const speed = 0.5;
    const tick = () => {
      if (!paused && container) {
        pos += speed;
        const half = container.scrollWidth / 2;
        if (pos >= half) pos = 0;
        container.scrollLeft = pos;
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [paused]);

  const pills = [...featurePills, ...featurePills];

  const handleClick = (targetId: string) => {
    const el = document.getElementById(targetId);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
  };

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-2 overflow-hidden"
      style={{ scrollbarWidth: "none" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="feature-pill-marquee"
    >
      {pills.map((pill, i) => (
        <button
          key={`${pill.label}-${i}`}
          data-testid={`pill-${pill.label.toLowerCase().replace(/\s+/g, "-")}`}
          onClick={() => handleClick(pill.targetId)}
          className="px-4 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap cursor-pointer transition-all duration-200 hover:scale-105 flex-shrink-0"
          style={{
            background: `${pill.color}20`,
            color: pill.color,
            border: `1px solid ${pill.color}40`,
            boxShadow: `0 0 8px ${pill.color}15`,
          }}
        >
          {pill.label}
        </button>
      ))}
    </div>
  );
}

export default function FeaturesPage() {
  const mockups: Record<string, React.ReactNode> = {
    cherryassist: <CherryAssistMockup />, time: <TimeTrackingMockup />, dashboard: <SmartDashboardMockup />,
    timesheets: <TimesheetMockup />, invoicing: <InvoicingMockup />,
    expenses: <ExpenseMockup />, aireceipt: <AIReceiptMockup />, accounting: <AccountingMockup />,
    bankrecon: <BankReconMockup />, payouts: <PayoutMockup />, projects: <ProjectMockup />,
    reports: <ReportsMockup />, global: <GlobalMockup />, portal: <PortalMockup />,
    reminders: <PaymentRemindersMockup />, import: <ImportMockup />,
    team: <TeamMockup />, setupwizard: <SetupWizardMockup />, estimates: <EstimatesMockup />,
    recurring: <RecurringMockup />, security: <SecurityMockup />, audittrail: <AuditTrailMockup />,
  };

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Features"
        fullTitle="Features — Every Tool Purpose-Built for Professional Services | CherryWorks Pro"
        description="Time tracking, invoicing, expenses, payouts, GL, AI support, and multi-currency — core features on every plan. Advanced ops tools on Professional and above."
        path="/features"
      />
      <SoftwareApplicationStructuredData />
      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight" data-testid="features-heading">Every feature your firm needs. Zero you don't.</h1>
            <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.65)" }}>One platform. No integrations to debug, no spreadsheets to reconcile, no per-user fees eating your margins. Purpose-built for firms that bill clients for their time.</p>
            <Link href="/pricing" style={{ color: "#cf3339", textDecoration: "underline", fontSize: "16px", marginTop: "8px", display: "inline-block" }}>View plans and pricing →</Link>
          </div>
        </div>
      </section>

      <section className="py-3 sticky top-[64px] z-40" data-testid="category-nav" style={{ background: "rgba(10,15,28,0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(16px)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeaturePillMarquee />
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
          {featureGroups.map((g) => (
            <FeatureSection
              key={g.id}
              g={g}
              mockup={g.mockup ? mockups[g.mockup] : undefined}
              badge={newBadgeIds.has(g.id) ? "new" : popularBadgeIds.has(g.id) ? "popular" : undefined}
              callout={callouts[g.id]}
            />
          ))}
        </div>
      </section>

      <ImportShowcase />

      <section id="marketing" className="scroll-mt-32 py-8 md:py-12" style={{ background: "#0a0f1c" }} data-testid="section-features-marketing-os">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3" style={{ background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.25)" }} data-testid="badge-features-marketing-os">
              Included in Business plan
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Marketing — Prospect / Client Separation</h2>
            <p className="mt-3 text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
              Marketing adds a full prospect-to-client layer on top of CherryWorks Pro — included in the Business plan, with no cross-contamination between marketing and billing records.
            </p>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              {[
                { icon: Users, title: "Contacts & Companies CRM", desc: "Track prospects and companies in their own tables, completely separate from billing clients. Tags, custom fields, activity timeline." },
                { icon: Send, title: "Campaigns & Sequences", desc: "Broadcast to a segment, or run multi-step automated outreach. Stops the moment a prospect replies or is promoted to a client." },
                { icon: Database, title: "Prospect / Client Separation", desc: "Marketing data lives in dedicated database tables — no foreign keys to your books, no cross-contamination between marketing and billing records." },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="p-7"
                    style={{ background: "rgba(207,51,57,0.03)", borderColor: "rgba(255,255,255,0.06)" }}
                    data-testid={`card-features-marketing-os-${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`}
                  >
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(220,38,38,0.12)" }}>
                      <Icon className="w-5 h-5" style={{ color: "#f87171" }} />
                    </div>
                    <h3 className="text-base font-bold text-white mb-2">{card.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{card.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-8 text-center">
            <Link href="/marketing">
              <span
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                data-testid="link-features-marketing-os"
              >
                Tour Marketing
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight">Ready to run your firm the way it deserves?</h2>
          <p className="mt-3 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>Start fresh or bring your data &mdash; the guided wizard gets you live in minutes. 14-day free trial.</p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 4px 30px rgba(207,51,57,0.4)" }}>Start Free Trial <ArrowRight className="w-4 h-4" /></span></Link>
            <Link href="/demo"><span className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer" style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>Schedule a Demo</span></Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
