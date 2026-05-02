import { useState, useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import {
  Users, Building2, Tag, Filter, Send, Repeat, Activity, Upload,
  CheckCircle, ArrowRight, ChevronDown, Database, ShieldCheck, Mail,
  Calendar, Clock, Sparkles,
  Search, Reply, Eye, MousePointer, FileText,
} from "lucide-react";
import { SEO, FAQStructuredData } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("fade-in-visible");
          obs.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function ScreenshotShell({
  alt,
  url,
  icon: Icon,
  label,
  children,
}: {
  alt: string;
  url: string;
  icon: LucideIcon;
  label: string;
  children?: React.ReactNode;
}) {
  const hasChildren = children !== undefined && children !== null;
  return (
    <div
      className="rounded-2xl overflow-hidden w-full"
      style={{
        background: "rgba(11,18,34,0.8)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "0 25px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 40px rgba(207,51,57,0.03)",
      }}
      role="img"
      aria-label={alt}
    >
      <div
        className="flex items-center px-3 py-1.5"
        style={{ background: "rgba(7,13,24,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex gap-1.5 mr-3">
          <div className="w-2 h-2 rounded-full" style={{ background: "#ff5f57" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#febc2e" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#28c840" }} />
        </div>
        <div className="flex-1 flex justify-center">
          <span
            className="text-[11px] px-6 py-0.5 rounded"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.25)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {url}
          </span>
        </div>
      </div>
      {hasChildren ? (
        <div
          className="w-full p-3 md:p-4"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(207,51,57,0.10), transparent 55%), radial-gradient(circle at 70% 80%, rgba(99,102,241,0.08), transparent 55%), linear-gradient(135deg, #0b1220 0%, #111827 100%)",
          }}
        >
          {children}
        </div>
      ) : (
        <div
          className="flex items-center justify-center w-full"
          style={{
            aspectRatio: "16 / 10",
            background:
              "radial-gradient(circle at 30% 20%, rgba(207,51,57,0.10), transparent 55%), radial-gradient(circle at 70% 80%, rgba(99,102,241,0.08), transparent 55%), linear-gradient(135deg, #0b1220 0%, #111827 100%)",
          }}
        >
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                background: "rgba(220,38,38,0.12)",
                border: "1px solid rgba(220,38,38,0.22)",
              }}
            >
              <Icon className="w-7 h-7" style={{ color: "#f87171" }} />
            </div>
            <p className="text-base font-semibold text-white">{label}</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
              Live preview &middot; coming soon
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Mockup components — hand-built JSX previews used inside ScreenshotShell on
// the public Marketing landing page. Each mockup shows plausible fake data
// for a professional-services firm using CherryWorks Pro Marketing.
// ===========================================================================

function ContactsMockup() {
  const rows = [
    { name: "Sarah Chen", email: "sarah@beaconstrategy.com", company: "Beacon Strategy Partners", tag: { label: "warm-lead", color: "#cf3339" }, lifecycle: "SQL", lifecycleColor: "#22c55e", lastTouch: "2h ago" },
    { name: "David Park", email: "david@northwind-arch.com", company: "Northwind Architects", tag: { label: "newsletter", color: "#3b82f6" }, lifecycle: "MQL", lifecycleColor: "#3b82f6", lastTouch: "Yesterday" },
    { name: "Maya Rodriguez", email: "maya@lumenstudio.co", company: "Lumen Studio", tag: { label: "demo-requested", color: "#22c55e" }, lifecycle: "SQL", lifecycleColor: "#22c55e", lastTouch: "Yesterday" },
    { name: "James Greene", email: "james@greene-pyne.com", company: "Greene & Pyne LLC", tag: { label: "warm-lead", color: "#cf3339" }, lifecycle: "Lead", lifecycleColor: "#a855f7", lastTouch: "3d ago" },
    { name: "Priya Shah", email: "priya@foundryeng.io", company: "Foundry Engineering", tag: { label: "cold-list", color: "#6b7280" }, lifecycle: "Lead", lifecycleColor: "#a855f7", lastTouch: "Apr 19" },
    { name: "Tomas Reyes", email: "tomas@helixadvisory.com", company: "Helix Advisory", tag: { label: "newsletter", color: "#3b82f6" }, lifecycle: "Customer", lifecycleColor: "#f59e0b", lastTouch: "Apr 14" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <p className="text-[12px] font-bold text-white">Contacts</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>247 prospects · 18 added this week</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Search className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.35)" }} />
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Search prospects…</span>
          </div>
          <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ Add Contact</div>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.2)" }}>Lifecycle: Lead</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" }}>Status: Working</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>+ Filter</span>
        <div className="flex-1" />
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>Import CSV</span>
      </div>
      <div className="rounded-md overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="grid grid-cols-[1.4fr_1.6fr_1.3fr_1fr_0.7fr_0.7fr] gap-2 px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          {["NAME", "EMAIL", "COMPANY", "TAG", "STAGE", "LAST"].map((h) => (
            <span key={h} className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>{h}</span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_1.6fr_1.3fr_1fr_0.7fr_0.7fr] gap-2 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0" style={{ background: `${r.lifecycleColor}25`, color: r.lifecycleColor }}>{r.name.split(" ").map((p) => p[0]).join("")}</div>
              <span className="text-[11px] font-medium text-white truncate">{r.name}</span>
            </div>
            <span className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.55)" }}>{r.email}</span>
            <span className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{r.company}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold w-fit truncate" style={{ background: `${r.tag.color}18`, color: r.tag.color, border: `1px solid ${r.tag.color}30` }}>{r.tag.label}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold w-fit" style={{ background: `${r.lifecycleColor}15`, color: r.lifecycleColor }}>{r.lifecycle}</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{r.lastTouch}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Showing 6 of 247 prospects</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.18)" }}>Prospect / Client Separation</span>
        </div>
      </div>
    </div>
  );
}

function CompaniesMockup() {
  const firms = [
    { name: "Beacon Strategy Partners", domain: "beaconstrategy.com", industry: "Consulting", prospects: 32, last: "2h ago", color: "#cf3339" },
    { name: "Northwind Architects", domain: "northwind-arch.com", industry: "Architecture", prospects: 18, last: "Yesterday", color: "#3b82f6" },
    { name: "Lumen Studio", domain: "lumenstudio.co", industry: "Design", prospects: 9, last: "Yesterday", color: "#22c55e" },
    { name: "Greene & Pyne LLC", domain: "greene-pyne.com", industry: "Legal", prospects: 14, last: "3d ago", color: "#a855f7" },
    { name: "Foundry Engineering", domain: "foundryeng.io", industry: "Engineering", prospects: 6, last: "Apr 19", color: "#f59e0b" },
    { name: "Helix Advisory", domain: "helixadvisory.com", industry: "Consulting", prospects: 11, last: "Apr 14", color: "#ec4899" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <p className="text-[12px] font-bold text-white">Companies</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>42 firms · 90 prospects across all accounts</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Search className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.35)" }} />
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Search firms…</span>
          </div>
          <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ Add Company</div>
        </div>
      </div>
      <div className="rounded-md overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="grid grid-cols-[1.6fr_1fr_0.7fr_0.7fr] gap-2 px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          {["COMPANY", "INDUSTRY", "PROSPECTS", "LAST ACT."].map((h) => (
            <span key={h} className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>{h}</span>
          ))}
        </div>
        {firms.map((f, i) => (
          <div key={i} className="grid grid-cols-[1.6fr_1fr_0.7fr_0.7fr] gap-2 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: `${f.color}20`, color: f.color, border: `1px solid ${f.color}30` }}>{f.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-white truncate">{f.name}</p>
                <p className="text-[9px] truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{f.domain}</p>
              </div>
            </div>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>{f.industry}</span>
            <div className="flex items-center gap-1">
              <Users className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span className="text-[10px] font-semibold tabular-nums text-white">{f.prospects}</span>
            </div>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{f.last}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Showing 6 of 42 firms</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.18)" }}>No billing data attached</span>
      </div>
    </div>
  );
}

function TagsMockup() {
  const tags = [
    { label: "warm-lead", count: 84, color: "#cf3339", trend: "+12 this week" },
    { label: "newsletter", count: 312, color: "#3b82f6", trend: "+47 this week" },
    { label: "demo-requested", count: 47, color: "#22c55e", trend: "+8 this week" },
    { label: "cold-list", count: 156, color: "#6b7280", trend: "static" },
  ];
  const recent = [
    { who: "Sarah Chen", action: "tagged warm-lead", when: "2h ago" },
    { who: "David Park", action: "untagged cold-list", when: "Yesterday" },
    { who: "12 prospects", action: "bulk-tagged newsletter", when: "Yesterday" },
    { who: "Maya Rodriguez", action: "tagged demo-requested", when: "Apr 22" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Tags</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>4 tags in use · 599 prospect tag assignments</p>
        </div>
        <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ New Tag</div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {tags.map((t, i) => (
          <div key={i} className="rounded-md p-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${t.color}20`, color: t.color, border: `1px solid ${t.color}40` }}>{t.label}</span>
              <span className="text-[14px] font-bold tabular-nums" style={{ color: t.color }}>{t.count}</span>
            </div>
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (t.count / 312) * 100)}%`, background: t.color }} />
            </div>
            <p className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{t.trend}</p>
          </div>
        ))}
      </div>
      <div className="rounded-md p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Recent activity</p>
        <div className="space-y-1">
          {recent.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Tag className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }} />
                <span className="font-medium text-white truncate">{r.who}</span>
                <span className="truncate" style={{ color: "rgba(255,255,255,0.5)" }}>· {r.action}</span>
              </div>
              <span className="flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{r.when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SegmentsMockup() {
  const segments = [
    { name: "New leads (last 7 days)", count: 38, active: false },
    { name: "Stale prospects > 60 days", count: 412, active: false },
    { name: "MQLs by industry: Consulting", count: 248, active: true },
    { name: "Demo no-shows", count: 17, active: false },
  ];
  const rules = [
    { label: "lifecycle", op: "=", val: "MQL", color: "#3b82f6" },
    { label: "industry", op: "=", val: "Consulting", color: "#a855f7" },
    { label: "tag", op: "includes", val: "warm-lead", color: "#cf3339" },
    { label: "last_touch", op: ">", val: "30 days", color: "#f59e0b" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Segments</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>4 saved · reuse across campaigns &amp; sequences</p>
        </div>
        <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ New Segment</div>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <div className="rounded-md overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[9px] font-bold uppercase tracking-wider px-2 py-1.5" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.04)" }}>Saved</p>
          {segments.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-1 px-2 py-1.5" style={{ background: s.active ? "rgba(207,51,57,0.10)" : "transparent", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", borderLeft: s.active ? "2px solid #cf3339" : "2px solid transparent" }}>
              <span className="text-[10px] font-medium truncate" style={{ color: s.active ? "#f87171" : "rgba(255,255,255,0.7)" }}>{s.name}</span>
              <span className="text-[9px] font-bold tabular-nums flex-shrink-0" style={{ color: s.active ? "#f87171" : "rgba(255,255,255,0.45)" }}>{s.count}</span>
            </div>
          ))}
        </div>
        <div className="rounded-md p-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-white truncate">MQLs by industry: Consulting</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>LIVE</span>
          </div>
          <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>Match all</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {rules.map((r, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: `${r.color}15`, color: r.color, border: `1px solid ${r.color}30` }}>
                {r.label} <span style={{ color: "rgba(255,255,255,0.5)" }}>{r.op}</span> {r.val}
              </span>
            ))}
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px dashed rgba(255,255,255,0.15)" }}>+ Rule</span>
          </div>
          <div className="rounded p-1.5 flex items-center justify-between" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.6)" }}>Live count</span>
            <span className="text-[14px] font-bold tabular-nums" style={{ color: "#22c55e" }}>248 prospects</span>
          </div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(207,51,57,0.12)", color: "#f87171", border: "1px solid rgba(207,51,57,0.2)" }}>Send campaign</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" }}>Enroll in sequence</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignsMockup() {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Campaigns</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>2,159 emails sent in April · 36% avg open</p>
        </div>
        <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ New Campaign</div>
      </div>
      {/* Sent campaign */}
      <div className="rounded-md p-2.5 mb-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>SENT</span>
            <p className="text-[11px] font-bold text-white truncate">Quarterly Client Update</p>
          </div>
          <span className="text-[10px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>Apr 22, 9:00 AM</span>
        </div>
        <p className="text-[10px] mb-2 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>Subject: <span className="text-white">What service firms got wrong about Q1 forecasting →</span></p>
        <div className="flex items-center gap-1.5 mb-2">
          <Filter className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.4)" }} />
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Segment: <span className="font-semibold text-white">All newsletter subscribers</span></span>
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>· 1,847 recipients</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "DELIVERED", value: "1,841", icon: Send, color: "#22c55e" },
            { label: "OPENS", value: "38%", icon: Eye, color: "#3b82f6" },
            { label: "CLICKS", value: "11%", icon: MousePointer, color: "#a855f7" },
            { label: "REPLIES", value: "23", icon: Reply, color: "#f59e0b" },
          ].map((s, i) => {
            const I = s.icon;
            return (
              <div key={i} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center gap-1 mb-0.5">
                  <I className="w-2.5 h-2.5" style={{ color: s.color }} />
                  <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>{s.label}</p>
                </div>
                <p className="text-[12px] font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              </div>
            );
          })}
        </div>
      </div>
      {/* Draft campaign */}
      <div className="rounded-md p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>DRAFT</span>
            <p className="text-[11px] font-bold text-white truncate">Webinar invite: Forecasting for Service Firms</p>
          </div>
          <span className="text-[10px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>Scheduled May 14, 9:00 AM</span>
        </div>
        <p className="text-[10px] mb-2 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>Subject: <span className="text-white">A 30-min playbook your CFO can run on Monday</span></p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Filter className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>Segment: <span className="font-semibold text-white">MQLs by industry: Consulting</span></span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>· 312 recipients</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>Edit</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Send now</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SequencesMockup() {
  const steps = [
    { day: 0, name: "Welcome + intro deck", sent: 412, open: "64%", reply: "" },
    { day: 2, name: "Case study: Beacon Strategy", sent: 387, open: "52%", reply: "" },
    { day: 5, name: "Pricing primer", sent: 341, open: "47%", reply: "" },
    { day: 9, name: "Demo offer", sent: 298, open: "41%", reply: "23 replies" },
    { day: 14, name: "Final check-in", sent: 261, open: "36%", reply: "" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Sequences</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>1 active · 412 prospects enrolled</p>
        </div>
        <div className="px-2 py-1 rounded-md text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>+ New Sequence</div>
      </div>
      <div className="rounded-md p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Repeat className="w-3 h-3 flex-shrink-0" style={{ color: "#f87171" }} />
            <p className="text-[11px] font-bold text-white truncate">New lead nurture (5-step)</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>ACTIVE</span>
          </div>
          <span className="text-[10px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>412 enrolled</span>
        </div>
        <div className="space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded p-1.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="w-7 h-7 rounded-md flex flex-col items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.12)", border: "1px solid rgba(207,51,57,0.25)" }}>
                <span className="text-[7px] uppercase font-bold leading-none" style={{ color: "#f87171" }}>DAY</span>
                <span className="text-[10px] font-bold tabular-nums leading-none mt-0.5" style={{ color: "#f87171" }}>{s.day}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-white truncate">Step {i + 1} · {s.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>{s.sent} sent</span>
                  <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#3b82f6" }}><Eye className="w-2 h-2" /> {s.open} open</span>
                  {s.reply && <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#f59e0b" }}><Reply className="w-2 h-2" /> {s.reply}</span>}
                </div>
              </div>
              <Mail className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <ShieldCheck className="w-3 h-3 flex-shrink-0" style={{ color: "#22c55e" }} />
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>Auto-stops on: <span className="text-white font-semibold">reply</span> · <span className="text-white font-semibold">unsubscribe</span> · <span className="text-white font-semibold">promotion to billing client</span></span>
        </div>
      </div>
    </div>
  );
}

function ActivityMockup() {
  const events = [
    { icon: Reply, color: "#f59e0b", title: "Reply received", detail: "from sarah@beaconstrategy.com on “Demo offer”", when: "9:42 AM" },
    { icon: Eye, color: "#3b82f6", title: "Email opened", detail: "“Pricing primer” by david@northwind-arch.com", when: "9:18 AM" },
    { icon: Tag, color: "#22c55e", title: "Tag added", detail: "demo-requested → james@greene-pyne.com", when: "8:51 AM" },
    { icon: Repeat, color: "#a855f7", title: "Sequence step sent", detail: "“Welcome + intro deck” → 12 prospects", when: "Yesterday 4:30 PM" },
    { icon: Send, color: "#cf3339", title: "Campaign sent", detail: "“Quarterly Client Update” → 1,847 recipients", when: "Yesterday 2:15 PM" },
    { icon: Upload, color: "#ec4899", title: "Bulk import", detail: "87 prospects added from consulting-leads-q2.csv", when: "Apr 22" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Activity</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Audited stream · last 24 hours</p>
        </div>
        <div className="flex items-center gap-1">
          {["All", "Replies", "Opens", "Sends", "Tags"].map((f, i) => (
            <span key={f} className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: i === 0 ? "rgba(207,51,57,0.12)" : "rgba(255,255,255,0.03)", color: i === 0 ? "#f87171" : "rgba(255,255,255,0.45)", border: `1px solid ${i === 0 ? "rgba(207,51,57,0.25)" : "rgba(255,255,255,0.06)"}` }}>{f}</span>
          ))}
        </div>
      </div>
      <div className="rounded-md p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="relative">
          <div className="absolute left-[11px] top-1 bottom-1 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="space-y-2">
            {events.map((e, i) => {
              const I = e.icon;
              return (
                <div key={i} className="flex items-start gap-2 relative">
                  <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 z-10" style={{ background: `${e.color}18`, border: `1px solid ${e.color}40` }}>
                    <I className="w-2.5 h-2.5" style={{ color: e.color }} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-white truncate">{e.title}</p>
                      <span className="text-[9px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>{e.when}</span>
                    </div>
                    <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{e.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportMockup() {
  const steps = ["Upload", "Map", "Review", "Done"];
  const mappings = [
    { csv: "first_name", field: "First Name", auto: true },
    { csv: "last_name", field: "Last Name", auto: true },
    { csv: "email_address", field: "Email", auto: true },
    { csv: "company", field: "Company", auto: true },
    { csv: "phone_mobile", field: "Phone", auto: true },
    { csv: "lead_source", field: "Tag: source-{value}", auto: false },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[12px] font-bold text-white">Import contacts</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Step 2 of 4 · Map your columns</p>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.18)" }}>Won't touch billing clients</span>
      </div>
      {/* Wizard steps */}
      <div className="flex items-center gap-1 mb-2">
        {steps.map((s, i) => {
          const active = i === 1;
          const done = i < 1;
          return (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: active ? "#cf3339" : done ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.06)", border: `1px solid ${active ? "#cf3339" : done ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}` }}>
                {done ? <CheckCircle className="w-2 h-2" style={{ color: "#22c55e" }} /> : <span className="text-[8px] font-bold" style={{ color: active ? "white" : "rgba(255,255,255,0.4)" }}>{i + 1}</span>}
              </div>
              <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: active ? "#f87171" : done ? "#22c55e" : "rgba(255,255,255,0.4)" }}>{s}</span>
              {i < steps.length - 1 && <div className="flex-1 h-px" style={{ background: i < 1 ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)" }} />}
            </div>
          );
        })}
      </div>
      {/* File summary */}
      <div className="rounded-md p-2 mb-2 flex items-center gap-2" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)" }}>
        <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ background: "rgba(59,130,246,0.15)" }}>
          <FileText className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-white truncate">consulting-leads-q2.csv</p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>247 rows · 6 KB · uploaded just now</p>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>5 auto-mapped</span>
      </div>
      {/* Mapping table */}
      <div className="rounded-md overflow-hidden mb-2" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 px-2 py-1.5 items-center" style={{ background: "rgba(255,255,255,0.04)" }}>
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>CSV column</span>
          <span />
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>System field</span>
          <span />
        </div>
        {mappings.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center px-2 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <span className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{m.csv}</span>
            <ArrowRight className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-[10px] font-medium text-white truncate">{m.field}</span>
            {m.auto ? (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold flex-shrink-0" style={{ color: "#22c55e" }}><CheckCircle className="w-2.5 h-2.5" /> auto</span>
            ) : (
              <span className="text-[9px] px-1 py-0.5 rounded font-semibold flex-shrink-0" style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc" }}>custom</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Dedupe by email · skip 3 already-existing rows</span>
        <span className="text-[10px] px-2 py-1 rounded-md font-bold text-white inline-flex items-center gap-1" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", boxShadow: "0 2px 8px rgba(207,51,57,0.3)" }}>Continue → Review <ArrowRight className="w-2.5 h-2.5" /></span>
      </div>
    </div>
  );
}


const featureSections: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  screenshotAlt: string;
  screenshotUrl: string;
}[] = [
  {
    id: "contacts",
    icon: Users,
    eyebrow: "Contacts",
    title: "A real CRM for the people you’re trying to win",
    description:
      "Every prospect, every interaction. Names, emails, phone numbers, custom fields, tags — and a complete history of every campaign, sequence step, and reply.",
    bullets: [
      "Unlimited prospects, separate from billing clients",
      "Custom fields, notes, and tags",
      "Inline edit, bulk select, bulk tag",
      "Promote a prospect into a billing client when they’re ready",
    ],
    screenshotAlt: "Marketing Contacts page showing brand-scoped contact list with search, lifecycle and lead-status filters, and Import CSV / Add Contact actions",
    screenshotUrl: "cherryworkspro.com/marketing/contacts",
  },
  {
    id: "companies",
    icon: Building2,
    eyebrow: "Companies",
    title: "Group contacts by the firm they work for",
    description:
      "A lightweight company record per prospect organization. Industry, domain, notes — and every contact at that company in one view.",
    bullets: [
      "Unlimited companies",
      "Group prospects by employer",
      "Industry, domain, custom fields",
      "Roll up activity across the whole account",
    ],
    screenshotAlt: "Marketing Companies page showing the brand-scoped company list view with Add Company action",
    screenshotUrl: "cherryworkspro.com/marketing/companies",
  },
  {
    id: "tags",
    icon: Tag,
    eyebrow: "Tags",
    title: "Label every prospect by source, stage, or fit",
    description:
      "Create as many tags as you need. Attach them to any contact. Use them to power segments, campaigns, and sequences.",
    bullets: [
      "Unlimited tags · color-coded",
      "Bulk tag from any list view",
      "Live counts per tag",
      "Drives segments and campaign targeting",
    ],
    screenshotAlt: "Marketing Tags page showing the brand-scoped tag list with create-tag action",
    screenshotUrl: "cherryworkspro.com/marketing/tags",
  },
  {
    id: "segments",
    icon: Filter,
    eyebrow: "Segments",
    title: "Save the queries you reuse every week",
    description:
      "Combine tags, company attributes, and last-touch dates. Save the result as a segment. Send a campaign or enroll a sequence with one click.",
    bullets: [
      "Compose AND/OR rules on tags, fields, and activity",
      "Live counts as you build",
      "Reuse across campaigns and sequences",
      "Edit anytime — segments stay dynamic",
    ],
    screenshotAlt: "Marketing Segments page showing saved segments and the New Segment action",
    screenshotUrl: "cherryworkspro.com/marketing/segments",
  },
  {
    id: "campaigns",
    icon: Send,
    eyebrow: "Campaigns",
    title: "One-off broadcasts to a segment, scheduled or sent now",
    description:
      "Compose your email, pick a segment, preview the recipient count, and send. Track opens, replies, and bounces in the activity feed.",
    bullets: [
      "Plain-text or rich HTML",
      "Live recipient count preview",
      "Schedule for a future send time",
      "Open, click, reply, and bounce tracking",
    ],
    screenshotAlt: "Marketing Campaigns page showing the brand-scoped campaign list with New Campaign action",
    screenshotUrl: "cherryworkspro.com/marketing/campaigns",
  },
  {
    id: "sequences",
    icon: Repeat,
    eyebrow: "Sequences",
    title: "Multi-step automated outreach that knows when to stop",
    description:
      "Drip a series of emails over days or weeks. Sequences pause the moment a prospect replies, unsubscribes, or is promoted to a billing client.",
    bullets: [
      "Unlimited steps with custom day delays",
      "Auto-stops on reply, unsubscribe, or promotion",
      "Per-step open/reply analytics",
      "Re-enroll segments any time",
    ],
    screenshotAlt: "Marketing Sequences page showing the brand-scoped sequence list with New Sequence action and helper text about chaining email steps with delays",
    screenshotUrl: "cherryworkspro.com/marketing/sequences",
  },
  {
    id: "activity",
    icon: Activity,
    eyebrow: "Activity Timeline",
    title: "Every touch, in order, on one page",
    description:
      "Open a contact and see every email sent, every open, every reply, every tag change, every sequence step — in chronological order. No more piecing the story together.",
    bullets: [
      "Unified timeline per contact and per company",
      "Filter by event type",
      "Click any event to jump to the source",
      "Audited — never deleted, never silently changed",
    ],
    screenshotAlt: "Marketing Activity firehose page showing the brand-scoped event stream",
    screenshotUrl: "cherryworkspro.com/marketing/activity",
  },
  {
    id: "import",
    icon: Upload,
    eyebrow: "CSV Import",
    title: "Bring your existing list in 60 seconds",
    description:
      "Upload a CSV, map your columns, preview the result, and run. Dedupes by email and refuses to overwrite a billing client by accident.",
    bullets: [
      "Smart column auto-mapping",
      "Live preview before commit",
      "Dedupe by email and domain",
      "Never touches your billing clients table",
    ],
    screenshotAlt: "Marketing Import Contacts wizard showing the four-step Upload / Map / Review / Done flow with a CSV upload dropzone",
    screenshotUrl: "cherryworkspro.com/marketing/contacts/import",
  },
];

const faqs = [
  {
    q: "What is Marketing Hub on CherryWorks Pro?",
    a: "Marketing Hub is a full prospect-to-client layer built into CherryWorks Pro: contacts and companies CRM, tags, segments, campaigns, sequences, an activity timeline, and bulk contact import. It is included in the Business plan — no separate add-on charge — and shares your team, your branding, and your audit log with the rest of the product.",
  },
  {
    q: "How is this different from a generic CRM like HubSpot?",
    a: "Marketing Hub is built for professional services firms that already use CherryWorks Pro for billing. It shares your team, your branding, and your audit log — but it physically separates marketing prospects from billing clients so you can never invoice a lead by accident. Generic CRMs don’t know the difference between a prospect and a client; we do.",
  },
  {
    q: "How does Marketing Hub keep marketing data separate from my books?",
    a: "Marketing prospects and marketing companies live in physically separate database tables from your billing clients. There are no foreign keys between the two, so a marketing lead can never silently be invoiced, reported on, or paid out as a client. Promoting a prospect into a billing client is an explicit, audited step you take — never an automatic side effect. The result: no cross-contamination between marketing and billing records, by design. We label this guarantee Prospect / Client Separation.",
  },
  {
    q: "Can I send real email campaigns from Marketing Hub?",
    a: "Yes. Compose a campaign, pick a segment, and Marketing Hub sends through your configured sender. You get open, click, reply, and bounce tracking, plus the full activity feed per contact.",
  },
  {
    q: "Do sequences stop automatically when someone replies?",
    a: "Yes. Sequences auto-stop on reply, unsubscribe, or when a prospect is promoted to a billing client — so you never accidentally drip a cold-email sequence to a paying customer.",
  },
  {
    q: "Can I import my existing list?",
    a: "Yes. The CSV importer maps your columns, dedupes by email, previews the result, and refuses to overwrite anything in your billing clients table. Bring 1,000 or 100,000 leads — same flow.",
  },
  {
    q: "Which plan do I need for Marketing Hub?",
    a: "Marketing Hub is included in the Business plan. Pick Business at signup (or upgrade from Starter or Professional any time) and Marketing Hub turns on for your whole firm with no separate add-on charge.",
  },
  {
    q: "Is there a free trial?",
    a: "Your CherryWorks Pro subscription includes a 14-day free trial. Start the trial on the Business plan and you can use Marketing Hub from day one.",
  },
];

export default function MarketingLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const heroRef = useFadeIn();
  const separationRef = useFadeIn();
  const faqRef = useFadeIn();
  const ctaRef = useFadeIn();

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Marketing Hub"
        fullTitle="Marketing Hub — CRM, Campaigns & Sequences for Professional Services Firms | CherryWorks Pro"
        description="Marketing Hub adds a full prospect-to-client CRM to CherryWorks Pro: contacts, companies, tags, segments, campaigns, sequences, activity timeline, and CSV import — with strict Prospect / Client Separation. Included in the Business plan."
        path="/marketing"
      />
      <FAQStructuredData faqs={faqs} />

      {/* Hero */}
      <section
        className="pt-[120px] pb-12 md:pb-16"
        style={{ background: "linear-gradient(135deg, #0a0f1c 0%, #111827 50%, #1a0a0a 100%)" }}
      >
        <div ref={heroRef} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center fade-in-section">
          <span
            className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4"
            style={{
              background: "rgba(220,38,38,0.15)",
              color: "#f87171",
              border: "1px solid rgba(220,38,38,0.25)",
            }}
            data-testid="badge-marketing-os-addon"
          >
            Included in Business plan
          </span>
          <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight" data-testid="marketing-os-heading">
            Marketing Hub
          </h1>
          <p className="mt-3 text-xl md:text-2xl font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
            A real CRM for professional services firms — that never touches your books.
          </p>
          <p className="mt-5 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.6)" }}>
            Contacts, companies, tags, segments, campaigns, sequences, an activity timeline, and CSV import.
            Built right on top of CherryWorks Pro. Built to keep marketing data and billing data in completely
            separate worlds.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signup">
              <span
                className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]"
                style={{
                  background: "linear-gradient(135deg, #cf3339, #e74c3c)",
                  boxShadow: "0 4px 30px rgba(207,51,57,0.4)",
                }}
                data-testid="button-marketing-os-hero-signup"
              >
                Start Free Trial <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
            <Link href="/pricing">
              <span
                className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
                data-testid="link-marketing-os-hero-pricing"
              >
                See pricing detail
              </span>
            </Link>
          </div>
          <p className="mt-3 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            14-day free trial · Included in the Business plan · Pick Business at signup or upgrade any time
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {[
              { label: "Contacts", id: "contacts" },
              { label: "Companies", id: "companies" },
              { label: "Tags", id: "tags" },
              { label: "Segments", id: "segments" },
              { label: "Campaigns", id: "campaigns" },
              { label: "Sequences", id: "sequences" },
              { label: "Activity Timeline", id: "activity" },
              { label: "CSV Import", id: "import" },
            ].map((f) => (
              <a
                key={f.id}
                href={`#${f.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(f.id);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    if (typeof window !== "undefined" && window.history?.replaceState) {
                      window.history.replaceState(null, "", `#${f.id}`);
                    }
                  }
                }}
                className="text-xs px-3 py-1.5 rounded-full font-medium cursor-pointer transition-colors hover:bg-white/10 hover:text-white"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.65)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                data-testid={`pill-feature-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {f.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Differentiator: Prospect / Client Separation */}
      <section className="py-10 md:py-14" style={{ background: "rgba(255,255,255,0.02)" }} data-testid="section-separation">
        <div ref={separationRef} className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <div
            className="rounded-2xl p-7 md:p-10"
            style={{
              background: "linear-gradient(135deg, rgba(207,51,57,0.08) 0%, rgba(255,255,255,0.02) 100%)",
              border: "1px solid rgba(207,51,57,0.18)",
              boxShadow: "var(--lux-card-shadow)",
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8 items-center">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(220,38,38,0.18)" }}
                  >
                    <ShieldCheck className="w-5 h-5" style={{ color: "#f87171" }} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#f87171" }}>
                    The differentiator
                  </span>
                </div>
                <h2
                  className="text-3xl md:text-4xl font-bold text-white tracking-tight"
                  data-testid="heading-prospect-client-separation"
                >
                  Prospect / Client Separation
                </h2>
                <p className="mt-4 text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Marketing prospects live in <span className="font-semibold text-white">physically separate database tables</span> from
                  your billing clients. There are no foreign keys between the two, so a marketing lead can never silently be invoiced,
                  reported on, or paid out as a client.
                </p>
                <p className="mt-3 text-base leading-relaxed font-semibold" style={{ color: "#f87171" }} data-testid="text-cross-contamination">
                  No cross-contamination between marketing and billing records — by design.
                </p>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Promoting a prospect into a billing client is an explicit, audited step you take. Never an automatic
                  side effect. Never a sync job that ran at 2am.
                </p>
              </div>
              <div>
                <div
                  className="rounded-xl p-5"
                  style={{
                    background: "rgba(7,13,24,0.6)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className="rounded-lg p-3"
                      style={{
                        background: "rgba(168,85,247,0.06)",
                        border: "1px solid rgba(168,85,247,0.2)",
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <Database className="w-3.5 h-3.5" style={{ color: "#a855f7" }} />
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#c4b5fd" }}>
                          Marketing
                        </span>
                      </div>
                      <p className="text-[11px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                        marketing_contacts
                      </p>
                      <p className="text-[11px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                        marketing_companies
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.65)" }}>
                        marketing_activity
                      </p>
                    </div>
                    <div
                      className="rounded-lg p-3"
                      style={{
                        background: "rgba(34,197,94,0.06)",
                        border: "1px solid rgba(34,197,94,0.2)",
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <Database className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#86efac" }}>
                          Billing
                        </span>
                      </div>
                      <p className="text-[11px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                        clients
                      </p>
                      <p className="text-[11px] font-mono mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                        invoices
                      </p>
                      <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.65)" }}>
                        payouts
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 text-center">
                    <span
                      className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        color: "#f87171",
                        border: "1px solid rgba(239,68,68,0.2)",
                      }}
                    >
                      No foreign keys · No silent sync
                    </span>
                  </div>
                  <p
                    className="mt-3 text-center text-[11px] leading-relaxed"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    Promotion is the only bridge — and it’s a deliberate, audited action.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature breakdown */}
      <section className="py-12 md:py-16" style={{ background: "#0a0f1c" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mb-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            The full Marketing Hub tour
          </h2>
          <p className="mt-3 text-lg max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
            Eight surfaces. Everything you need to bring leads in and walk them to a signed engagement — included in the Business plan.
          </p>
        </div>

        <div className="space-y-16 md:space-y-20">
          {featureSections.map((section, i) => (
            <FeatureBlock
              key={section.id}
              section={section}
              reversed={i % 2 === 1}
            />
          ))}
        </div>
      </section>

      {/* Use cases */}
      <section className="py-10 md:py-14" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center tracking-tight">
            Built for the way professional services firms actually grow
          </h2>
          <p className="mt-3 text-center text-base max-w-2xl mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
            Three patterns we see every week. Marketing Hub handles all of them out of the box.
          </p>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: Sparkles,
                title: "Tax-season nurture",
                desc: "Import last year’s leads, segment by tier, drip a 5-step educational sequence, and watch warm replies show up two weeks before the deadline.",
              },
              {
                icon: Mail,
                title: "Webinar follow-up",
                desc: "Tag webinar attendees on import, send a same-day thank-you campaign, then enroll them in a discovery-call sequence that auto-stops the moment they reply.",
              },
              {
                icon: Clock,
                title: "Referral pipeline",
                desc: "Tag every referral, watch the activity timeline, and promote the qualified ones into billing clients with a single audited click.",
              },
            ].map((u) => {
              const Icon = u.icon;
              return (
                <div
                  key={u.title}
                  className="rounded-2xl p-6"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    boxShadow: "var(--lux-card-shadow)",
                  }}
                  data-testid={`card-usecase-${u.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                    style={{ background: "rgba(220,38,38,0.12)" }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "#f87171" }} />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{u.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {u.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing strip */}
      <section className="py-10 md:py-14" style={{ background: "#0a0f1c" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            className="rounded-2xl p-7 md:p-9 relative"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              boxShadow: "var(--lux-card-shadow)",
            }}
          >
            <div
              className="absolute -top-3 left-7 px-3 py-0.5 rounded-full text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
            >
              Included
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-8 items-start">
              <div>
                <h3 className="text-xl font-bold text-white">Marketing Hub — included in the Business plan</h3>
                <p className="text-base mt-2 mb-4 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  The full prospect-to-client layer on top of CherryWorks Pro. Bring leads in, segment them, run
                  campaigns and sequences, and promote them into billing clients on your terms.
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
                  <span className="font-semibold" style={{ color: "#f87171" }}>
                    Prospect / Client Separation:
                  </span>{" "}
                  marketing prospects live in separate database tables from your billing clients — no foreign keys, no
                  cross-contamination between marketing and billing records, by design.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-y-2 gap-x-4">
                  {[
                    "Contacts & Companies CRM",
                    "Tags & Segments",
                    "Campaigns",
                    "Sequences",
                    "Activity timeline",
                    "Bulk contacts import",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#22c55e" }} />
                      <span className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="md:border-l md:pl-8" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <p className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: "#f87171" }}>
                  Included in
                </p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-white">Business</span>
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: "#cf3339" }}>
                  No separate add-on charge
                </p>
                <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.45)" }}>
                  Pick the Business plan and Marketing Hub turns on for your whole firm from day one.
                </p>
                <Link href="/pricing">
                  <span
                    className="block text-center px-4 py-3 text-sm font-semibold rounded-lg cursor-pointer transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "white" }}
                    data-testid="button-marketing-os-pricing-signup"
                  >
                    See Business plan pricing
                  </span>
                </Link>
                <p className="text-xs text-center mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                  14-day free trial · Marketing Hub included on Business
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-10 md:py-14" style={{ background: "#0a0f1c" }}>
        <div ref={faqRef} className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section">
          <h2
            className="text-2xl md:text-3xl font-bold text-center mb-10 text-white tracking-tight"
            data-testid="heading-marketing-os-faq"
          >
            Marketing Hub FAQ
          </h2>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                data-testid={`marketing-os-faq-item-${i}`}
              >
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  data-testid={`button-marketing-os-faq-${i}`}
                >
                  <span className="text-sm font-semibold" style={{ color: "#ffffff" }}>
                    {faq.q}
                  </span>
                  <ChevronDown
                    className="w-4 h-4 flex-shrink-0 ml-3 transition-transform duration-200"
                    style={{
                      color: "rgba(255,255,255,0.4)",
                      transform: openFaq === i ? "rotate(180deg)" : "none",
                    }}
                  />
                </button>
                {openFaq === i && (
                  <div
                    className="px-5 py-4"
                    style={{ background: "#0a0f1c", borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                      {faq.a}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="py-12 md:py-16"
        style={{ background: "linear-gradient(135deg, #1a0505 0%, #0a0f1c 50%, #1a0a0a 100%)" }}
      >
        <div ref={ctaRef} className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center fade-in-section">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Bring leads in. Keep your books clean.
          </h2>
          <p className="mt-3 text-lg" style={{ color: "rgba(255,255,255,0.6)" }}>
            Start your CherryWorks Pro free trial on the Business plan and Marketing Hub is on from day one. 14 days, full access.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup">
              <span
                className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03]"
                style={{
                  background: "linear-gradient(135deg, #cf3339, #e74c3c)",
                  boxShadow: "0 4px 30px rgba(207,51,57,0.4)",
                }}
                data-testid="button-marketing-os-final-signup"
              >
                Start Free Trial <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
            <Link href="/contact">
              <span
                className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold rounded-xl cursor-pointer"
                style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}
                data-testid="link-marketing-os-final-contact"
              >
                Talk to Sales
              </span>
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function FeatureBlock({
  section,
  reversed,
}: {
  section: (typeof featureSections)[number];
  reversed: boolean;
}) {
  const ref = useFadeIn();
  const Icon = section.icon;
  return (
    <div
      ref={ref}
      id={section.id}
      className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 fade-in-section scroll-mt-24"
      data-testid={`section-feature-${section.id}`}
    >
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center ${reversed ? "md:[&>*:first-child]:order-2" : ""}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(220,38,38,0.12)" }}
            >
              <Icon className="w-5 h-5" style={{ color: "#f87171" }} />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#f87171" }}>
              {section.eyebrow}
            </span>
          </div>
          <h3 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{section.title}</h3>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
            {section.description}
          </p>
          <ul className="mt-5 space-y-2">
            {section.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#22c55e" }} />
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div data-testid={`mockup-${section.id}`}>
          <ScreenshotShell
            icon={section.icon}
            label={section.title}
            alt={section.screenshotAlt}
            url={section.screenshotUrl}
          >
            {section.id === "contacts" ? <ContactsMockup /> :
             section.id === "companies" ? <CompaniesMockup /> :
             section.id === "tags" ? <TagsMockup /> :
             section.id === "segments" ? <SegmentsMockup /> :
             section.id === "campaigns" ? <CampaignsMockup /> :
             section.id === "sequences" ? <SequencesMockup /> :
             section.id === "activity" ? <ActivityMockup /> :
             section.id === "import" ? <ImportMockup /> : null}
          </ScreenshotShell>
        </div>
      </div>
    </div>
  );
}
