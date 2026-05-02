import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import {
  HelpCircle, X, Search, Clock, FileText, DollarSign, BarChart3, Users,
  Receipt, ClipboardCheck, FolderKanban, Shield, ChevronRight, Zap,
  CreditCard, Upload, Settings, UserPlus, ArrowRight, BookOpen,
  Calculator, RefreshCw, Briefcase, LayoutDashboard, User,
  ChevronDown, ChevronUp, Minus, ThumbsUp, ThumbsDown, Sparkles,
  ArrowLeft, Lightbulb, Landmark, Megaphone, Lock,
} from "lucide-react";
import { HELP_PANEL_OPEN_EVENT } from "@/lib/help-context";
import { useBillingStatus } from "@/hooks/use-billing-status";

import { HELP_ARTICLES, type HelpArticle } from "@/lib/help-articles";

function formatBody(body: string): string {
  return body.replace(/\\n/g, '\n');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^[-—]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQuickAnswer(body: string): string {
  const clean = stripMarkdown(body);
  const periodMatch = clean.match(/^(.+?\.)(\s|$)/);
  if (periodMatch) return periodMatch[1];
  const chunk = clean.slice(0, 120);
  const lastSpace = chunk.lastIndexOf(' ');
  return (lastSpace > 60 ? chunk.slice(0, lastSpace) : chunk) + '...';
}

function RenderedMarkdown({ body }: { body: string }) {
  const formatted = formatBody(body);
  const proTipMatch = formatted.match(/💡\s*Pro tip:\s*([\s\S]*)$/i);
  const mainBody = proTipMatch ? formatted.slice(0, proTipMatch.index).trimEnd() : formatted;
  const proTip = proTipMatch ? proTipMatch[1].trim() : null;

  return (
    <div className="help-markdown">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-2" style={{ color: "var(--lux-text)" }}>{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mt-3.5 mb-1.5" style={{ color: "var(--lux-text)" }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1" style={{ color: "var(--lux-text)" }}>{children}</h3>,
          p: ({ children }) => <p className="text-sm mb-2.5" style={{ color: "var(--lux-text-secondary)", lineHeight: "1.7" }}>{children}</p>,
          ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3 space-y-1.5" style={{ color: "var(--lux-text-secondary)" }}>{children}</ol>,
          ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-3 space-y-1.5" style={{ color: "var(--lux-text-secondary)" }}>{children}</ul>,
          li: ({ children }) => <li className="text-sm" style={{ lineHeight: "1.7" }}>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--lux-text)" }}>{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="text-xs px-1.5 py-0.5 rounded-md font-mono" style={{ background: "var(--color-surface-1)", color: "#cf3339" }}>
              {children}
            </code>
          ),
        }}
      >
        {mainBody}
      </ReactMarkdown>
      {proTip && (
        <div
          className="mt-4 px-4 py-3.5 rounded-xl flex gap-2.5 items-start"
          style={{
            background: "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(251,191,36,0.04))",
            border: "1px solid rgba(245,158,11,0.18)",
          }}
        >
          <span className="text-base flex-shrink-0 mt-0.5">💡</span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: "#d97706" }}>Pro Tip</p>
            <p className="text-sm" style={{ color: "var(--lux-text-secondary)", lineHeight: "1.7" }}>{proTip}</p>
          </div>
        </div>
      )}
    </div>
  );
}


const CATEGORIES = [
  { name: "Getting Started", icon: Zap },
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Time Tracking", icon: Clock },
  { name: "Timesheets", icon: ClipboardCheck },
  { name: "Invoicing", icon: FileText },
  { name: "Estimates", icon: Calculator },
  { name: "Billing", icon: RefreshCw },
  { name: "Payments", icon: CreditCard },
  { name: "Expenses", icon: Receipt },
  { name: "Payouts", icon: DollarSign },
  { name: "Projects", icon: FolderKanban },
  { name: "Services", icon: Briefcase },
  { name: "Clients", icon: Users },
  { name: "Reports", icon: BarChart3 },
  { name: "Team", icon: UserPlus },
  { name: "Management", icon: Shield },
  { name: "Profile", icon: User },
  { name: "Settings", icon: Settings },
  { name: "Accounting", icon: BookOpen },
  { name: "Import", icon: Upload },
  { name: "Banking", icon: Landmark },
  { name: "Marketing", icon: Megaphone },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Getting Started": "#f59e0b",
  "Dashboard": "#6366f1",
  "Time Tracking": "#3b82f6",
  "Timesheets": "#8b5cf6",
  "Invoicing": "#cf3339",
  "Estimates": "#ec4899",
  "Billing": "#14b8a6",
  "Payments": "#22c55e",
  "Expenses": "#f97316",
  "Payouts": "#10b981",
  "Projects": "#0ea5e9",
  "Services": "#a855f7",
  "Clients": "#6366f1",
  "Reports": "#eab308",
  "Team": "#ef4444",
  "Management": "#64748b",
  "Profile": "#8b5cf6",
  "Settings": "#71717a",
  "Accounting": "#059669",
  "Import": "#0284c7",
  "Banking": "#0d9488",
  "Marketing": "#d946ef",
  "Support": "#f43f5e",
};

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  if (q.length < 3) return false;
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  if (qi === q.length && maxConsecutive >= Math.min(3, q.length)) return true;
  let dist = 0;
  const short = q.length <= t.length ? q : t;
  const long = q.length <= t.length ? t : q;
  if (Math.abs(short.length - long.length) > 2) return false;
  for (let i = 0; i < Math.min(short.length, long.length); i++) {
    if (short[i] !== long[i]) dist++;
  }
  dist += Math.abs(short.length - long.length);
  return dist <= 2 && q.length >= 4;
}

function fuzzySearch(article: HelpArticle, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  const words = q.split(/\s+/);
  return words.every(word => {
    const catColor = CATEGORIES.find(c => fuzzyMatch(c.name.toLowerCase(), word));
    return (
      fuzzyMatch(article.title, word) ||
      fuzzyMatch(article.keywords, word) ||
      fuzzyMatch(article.body, word) ||
      fuzzyMatch(article.category, word) ||
      (catColor ? article.category.toLowerCase() === catColor.name.toLowerCase() : false)
    );
  });
}

function ArticleCard({ article, onSelect, index, marketingLocked = false }: { article: HelpArticle; onSelect: (a: HelpArticle) => void; index: number; marketingLocked?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const catColor = CATEGORY_COLORS[article.category] || "#cf3339";
  const quickAnswer = useMemo(() => getQuickAnswer(article.body), [article.body]);
  const locked = marketingLocked && article.category === "Marketing";

  return (
    <div
      className="rounded-xl transition-all duration-200"
      style={{
        background: "var(--color-surface-1)",
        border: "1px solid var(--color-border-1)",
        animationDelay: `${index * 40}ms`,
        animationName: "helpCardSlideIn",
        animationDuration: "0.3s",
        animationTimingFunction: "ease-out",
        animationFillMode: "both",
      }}
      data-testid={`article-card-${article.id}`}
    >
      <button
        onClick={() => {
          if (expanded) {
            setExpanded(false);
          } else {
            setExpanded(true);
          }
        }}
        className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer group"
        style={{ background: "transparent", opacity: locked ? 0.7 : 1 }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${article.title} - ${article.category}${locked ? " (Available on Business plan)" : ""}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: `${catColor}18`, color: catColor }}
            >
              {article.category}
            </span>
            {locked && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 inline-flex items-center gap-1"
                style={{ background: "rgba(217,70,239,0.12)", color: "#d946ef" }}
                data-testid={`badge-locked-${article.id}`}
              >
                <Lock className="w-2.5 h-2.5" /> Business
              </span>
            )}
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--lux-text)" }}>{article.title}</p>
          {!expanded && (
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>{quickAnswer}</p>
          )}
        </div>
        <div className="flex-shrink-0 mt-1 transition-transform duration-200" style={{ color: "var(--lux-text-muted)" }}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? "2000px" : "0px", opacity: expanded ? 1 : 0 }}
      >
        <div className="px-4 pb-4">
          <div className="pt-2" style={{ borderTop: "1px solid var(--color-border-1)" }}>
            {locked ? (
              <div className="mt-2" data-testid={`article-locked-body-${article.id}`}>
                <MarketingUpsell variant="card" />
              </div>
            ) : (
              <>
                <div className="mt-2">
                  <RenderedMarkdown body={article.body} />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onSelect(article); }}
                  className="mt-3 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  style={{ color: "#cf3339" }}
                  data-testid={`article-read-more-${article.id}`}
                >
                  Read full article <ArrowRight className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketingUpsell({ variant = "banner" }: { variant?: "banner" | "card" }) {
  return (
    <div
      className={variant === "card" ? "rounded-xl p-4 mb-4" : "rounded-lg px-3 py-2.5 mb-3 flex items-start gap-2"}
      style={{
        background: "linear-gradient(135deg, rgba(217,70,239,0.10), rgba(217,70,239,0.04))",
        border: "1px solid rgba(217,70,239,0.25)",
      }}
      data-testid="banner-marketing-upsell"
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(217,70,239,0.15)" }}>
        <Lock className="w-3.5 h-3.5" style={{ color: "#d946ef" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold mb-0.5" style={{ color: "var(--lux-text)" }}>Marketing OS — Available on Business plan</p>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
          Upgrade to unlock campaigns, contacts, segments, and deliverability tools.
        </p>
      </div>
    </div>
  );
}

function ArticleDetailView({ article, onBack, allArticles, onSelect, marketingLocked = false }: {
  article: HelpArticle;
  onBack: () => void;
  allArticles: HelpArticle[];
  onSelect: (a: HelpArticle) => void;
  marketingLocked?: boolean;
}) {
  const [helpful, setHelpful] = useState<"up" | "down" | null>(null);
  const catColor = CATEGORY_COLORS[article.category] || "#cf3339";
  const locked = marketingLocked && article.category === "Marketing";

  const related = useMemo(() => {
    return allArticles
      .filter(a => a.category === article.category && a.id !== article.id)
      .slice(0, 3);
  }, [article, allArticles]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5" style={{ animation: "helpFadeIn 0.25s ease-out" }}>
      <button
        onClick={onBack}
        className="text-xs font-semibold mb-4 cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: "#cf3339" }}
        data-testid="button-back-articles"
        aria-label="Back to articles"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="flex items-center gap-2">
        <span
          className="inline-flex text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
          style={{ background: `${catColor}18`, color: catColor }}
        >
          {article.category}
        </span>
        {locked && (
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={{ background: "rgba(217,70,239,0.12)", color: "#d946ef" }}
            data-testid="badge-locked-detail"
          >
            <Lock className="w-2.5 h-2.5" /> Business
          </span>
        )}
      </div>

      <h3 className="text-lg font-bold mt-3 mb-4" style={{ color: "var(--lux-text)" }}>{article.title}</h3>
      {locked ? (
        <div data-testid="locked-detail-body">
          <MarketingUpsell variant="card" />
          <p className="text-xs leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
            The full article unlocks once Marketing OS is enabled on your plan.
          </p>
        </div>
      ) : (
        <RenderedMarkdown body={article.body} />
      )}

      <div className="mt-8 pt-4" style={{ borderTop: "1px solid var(--color-border-1)" }}>
        <p className="text-xs font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Was this helpful?</p>
        <div className="flex gap-2">
          <button
            onClick={() => setHelpful("up")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all"
            style={{
              background: helpful === "up" ? "rgba(34,197,94,0.12)" : "var(--color-surface-1)",
              border: `1px solid ${helpful === "up" ? "rgba(34,197,94,0.3)" : "var(--color-border-1)"}`,
              color: helpful === "up" ? "#16a34a" : "var(--lux-text-muted)",
            }}
            data-testid="button-helpful-yes"
            aria-label="Yes, this was helpful"
            aria-pressed={helpful === "up"}
          >
            <ThumbsUp className="w-3.5 h-3.5" /> Yes
          </button>
          <button
            onClick={() => setHelpful("down")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all"
            style={{
              background: helpful === "down" ? "rgba(239,68,68,0.12)" : "var(--color-surface-1)",
              border: `1px solid ${helpful === "down" ? "rgba(239,68,68,0.3)" : "var(--color-border-1)"}`,
              color: helpful === "down" ? "#dc2626" : "var(--lux-text-muted)",
            }}
            data-testid="button-helpful-no"
            aria-label="No, this was not helpful"
            aria-pressed={helpful === "down"}
          >
            <ThumbsDown className="w-3.5 h-3.5" /> No
          </button>
        </div>
        {helpful && (
          <p className="text-[11px] mt-2" style={{ color: "var(--lux-text-muted)", animation: "helpFadeIn 0.3s ease-out" }}>
            {helpful === "up" ? "Thanks for your feedback!" : "Sorry to hear that. Try CherryAssist for more help."}
          </p>
        )}
      </div>

      {related.length > 0 && (
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--color-border-1)" }}>
          <p className="text-xs font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Related Articles</p>
          <div className="space-y-2">
            {related.map(r => {
              const rColor = CATEGORY_COLORS[r.category] || "#cf3339";
              const rLocked = marketingLocked && r.category === "Marketing";
              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border-1)", opacity: rLocked ? 0.7 : 1 }}
                  data-testid={`related-article-${r.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ background: `${rColor}18`, color: rColor }}
                      >
                        {r.category}
                      </span>
                      {rLocked && <Lock className="w-2.5 h-2.5" style={{ color: "#d946ef" }} />}
                    </div>
                    <p className="text-xs font-medium mt-1" style={{ color: "var(--lux-text)" }}>{r.title}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--lux-text-muted)" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryGrid({ onSelectCategory, marketingLocked = false }: { onSelectCategory: (name: string) => void; marketingLocked?: boolean }) {
  const catsWithCount = CATEGORIES.map(cat => ({
    ...cat,
    count: HELP_ARTICLES.filter(a => a.category === cat.name).length,
  })).filter(c => c.count > 0);

  return (
    <div className="grid grid-cols-2 gap-2.5" data-testid="category-grid">
      {catsWithCount.map((cat, i) => {
        const Icon = cat.icon;
        const color = CATEGORY_COLORS[cat.name] || "#cf3339";
        const isLocked = marketingLocked && cat.name === "Marketing";
        return (
          <button
            key={cat.name}
            onClick={() => onSelectCategory(cat.name)}
            className="text-left p-3 rounded-xl cursor-pointer transition-all duration-200 group relative"
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-border-1)",
              animationDelay: `${i * 30}ms`,
              animationName: "helpCardSlideIn",
              animationDuration: "0.3s",
              animationTimingFunction: "ease-out",
              animationFillMode: "both",
              opacity: isLocked ? 0.75 : 1,
            }}
            data-testid={`category-card-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
            aria-label={isLocked ? `${cat.name} - Available on Business plan` : cat.name}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center mb-2 transition-transform duration-200 group-hover:scale-110"
              style={{ background: `${color}15` }}
            >
              <Icon className="w-4.5 h-4.5" style={{ color }} />
            </div>
            <div className="flex items-center gap-1">
              <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>{cat.name}</p>
              {isLocked && (
                <Lock className="w-2.5 h-2.5" style={{ color: "#d946ef" }} data-testid={`icon-locked-category-${cat.name.toLowerCase()}`} />
              )}
            </div>
            <span className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>
              {isLocked ? "Available on Business plan" : `${cat.count} article${cat.count !== 1 ? "s" : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CategoryArticles({ categoryName, onBack, onSelect, marketingLocked = false }: {
  categoryName: string;
  onBack: () => void;
  onSelect: (a: HelpArticle) => void;
  marketingLocked?: boolean;
}) {
  const articles = HELP_ARTICLES.filter(a => a.category === categoryName);
  const catColor = CATEGORY_COLORS[categoryName] || "#cf3339";
  const CatIcon = CATEGORIES.find(c => c.name === categoryName)?.icon || HelpCircle;
  const showUpsell = marketingLocked && categoryName === "Marketing";

  return (
    <div style={{ animation: "helpFadeIn 0.25s ease-out" }}>
      <button
        onClick={onBack}
        className="text-xs font-semibold mb-4 cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: "#cf3339" }}
        data-testid="button-back-categories"
        aria-label="Back to categories"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Categories
      </button>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${catColor}15` }}>
          <CatIcon className="w-4 h-4" style={{ color: catColor }} />
        </div>
        <div>
          <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--lux-text)" }}>
            {categoryName}
            {showUpsell && <Lock className="w-3 h-3" style={{ color: "#d946ef" }} />}
          </p>
          <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
        </div>
      </div>
      {showUpsell && <MarketingUpsell variant="card" />}
      <div className="space-y-2.5">
        {articles.map((article, i) => (
          <ArticleCard key={article.id} article={article} onSelect={onSelect} index={i} marketingLocked={marketingLocked} />
        ))}
      </div>
    </div>
  );
}

function HelpStatusBadge() {
  const [status, setStatus] = useState<"checking" | "ok" | "degraded" | "offline">("checking");
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch("/api/help/status");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (mounted) setStatus(data.status === "ok" ? "ok" : data.status === "degraded" ? "degraded" : "offline");
      } catch {
        if (mounted) setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => { mounted = false; clearInterval(id); };
  }, []);
  const cfg = {
    checking: { color: "#9ca3af", label: "Checking..." },
    ok: { color: "#22c55e", label: "Online" },
    degraded: { color: "#f59e0b", label: "Degraded" },
    offline: { color: "#ef4444", label: "Offline" },
  }[status];
  return (
    <div className="flex items-center gap-1" data-testid="help-status-badge">
      {status === "checking" ? (
        <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin" />
      ) : (
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
      )}
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  );
}

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [location] = useLocation();
  const { isBusinessPlus } = useBillingStatus();
  const marketingLocked = !isBusinessPlus;
  const searchRef = useRef<HTMLInputElement>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [fabPulse, setFabPulse] = useState(false);

  useEffect(() => {
    pulseTimerRef.current = setInterval(() => {
      setFabPulse(true);
      setTimeout(() => setFabPulse(false), 2000);
    }, 30000);
    return () => {
      if (pulseTimerRef.current) {
        clearInterval(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
    };
  }, []);

  const handleKeyboardShortcut = useCallback((e: KeyboardEvent) => {
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (!isEditable) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyboardShortcut);
    return () => document.removeEventListener("keydown", handleKeyboardShortcut);
  }, [handleKeyboardShortcut]);

  useEffect(() => {
    const handler = () => setOpen(true);
    document.addEventListener(HELP_PANEL_OPEN_EVENT, handler);
    return () => document.removeEventListener(HELP_PANEL_OPEN_EVENT, handler);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  const contextual = useMemo(() => {
    return HELP_ARTICLES.filter(a =>
      a.pages.some(p => {
        // "/" should only match the dashboard roots, not every page
        if (p === "/") return location === "/" || location === "/home" || location === "/dashboard";
        if (p === location) return true;
        // Match nested routes: /gl matches /gl/ledger, /admin/data matches /admin/data/clients,
        // but /gl should NOT match /gl-accounts (prevents prefix false-positives)
        return location.startsWith(p + "/") || location.startsWith(p + "?") || location.startsWith(p + "#");
      })
    );
  }, [location]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    return HELP_ARTICLES.filter(a => fuzzySearch(a, search));
  }, [search]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSelectedArticle(null);
    setSelectedCategory(null);
    setSearch("");
  }, []);

  const handleSelectArticle = useCallback((article: HelpArticle) => {
    if (marketingLocked && article.category === "Marketing") {
      setSelectedCategory("Marketing");
      setSelectedArticle(null);
      return;
    }
    setSelectedArticle(article);
    setSelectedCategory(null);
  }, [marketingLocked]);

  const handleBackFromArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  const handleBackFromCategory = useCallback(() => {
    setSelectedCategory(null);
  }, []);

  return (
    <>
      <style>{`
        @keyframes helpSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes helpSlideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        @keyframes helpFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes helpCardSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes helpBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes helpPulseRing {
          0% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes helpSearchGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(207,51,57,0); }
          50% { box-shadow: 0 0 0 3px rgba(207,51,57,0.15); }
        }
      `}</style>

      <button
        onClick={() => { if (open) handleClose(); else setOpen(true); }}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 cursor-pointer"
        style={{
          background: "linear-gradient(135deg, #cf3339, #e74c3c)",
          color: "white",
          boxShadow: fabPulse
            ? "0 4px 20px rgba(207,51,57,0.6), 0 0 0 6px rgba(207,51,57,0.15)"
            : "0 4px 20px rgba(207,51,57,0.4)",
          transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        }}
        data-testid="button-help"
        aria-label={open ? "Close Knowledge Base" : "Open Knowledge Base"}
      >
        {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
            animation: "helpBackdropIn 0.25s ease-out",
          }}
          onClick={handleClose}
          data-testid="help-backdrop"
        />
      )}

      <div
        className="fixed top-0 right-0 z-50 h-full w-full sm:w-[450px] flex flex-col"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "var(--color-surface-0)",
          borderLeft: "1px solid var(--color-border-1)",
          boxShadow: open ? "-12px 0 40px rgba(0,0,0,0.18)" : "none",
          transition: open
            ? "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)"
            : "transform 0.25s cubic-bezier(0.4,0,1,1)",
        }}
        data-testid="help-panel"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{
            borderBottom: "1px solid var(--color-border-1)",
            background: "linear-gradient(135deg, rgba(207,51,57,0.04), rgba(207,51,57,0.01))",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <HelpCircle className="w-5 h-5" style={{ color: "#cf3339" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-help-title">
                  Knowledge Base
                </h2>
                <HelpStatusBadge />
              </div>
              <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
                {HELP_ARTICLES.length} articles across {CATEGORIES.filter(c => HELP_ARTICLES.some(a => a.category === c.name)).length} categories
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOpen(false)}
              className="cursor-pointer p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              aria-label="Minimize Knowledge Base"
              data-testid="button-help-minimize"
            >
              <Minus className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
            </button>
            <button
              onClick={handleClose}
              className="cursor-pointer p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              aria-label="Close Knowledge Base"
              data-testid="button-help-close"
            >
              <X className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
            </button>
          </div>
        </div>

        {selectedArticle ? (
          <ArticleDetailView
            article={selectedArticle}
            onBack={handleBackFromArticle}
            allArticles={HELP_ARTICLES}
            onSelect={handleSelectArticle}
            marketingLocked={marketingLocked}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--color-border-1)" }}>
              <div
                className="relative rounded-xl transition-all duration-300"
                style={{
                  animation: searchFocused ? "helpSearchGlow 2s ease-in-out infinite" : "none",
                }}
              >
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200"
                  style={{ color: searchFocused ? "#cf3339" : "var(--lux-text-muted)" }}
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSelectedCategory(null); }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder='Search articles... Press ? to toggle'
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm"
                  style={{
                    background: "var(--color-surface-1)",
                    border: `1px solid ${searchFocused ? "rgba(207,51,57,0.3)" : "var(--color-border-1)"}`,
                    color: "var(--lux-text)",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  data-testid="input-help-search"
                />
              </div>
              {search.trim() && (
                <p
                  className="text-[10px] font-bold uppercase tracking-wider mt-2"
                  style={{ color: "var(--lux-text-muted)", animation: "helpFadeIn 0.2s ease-out" }}
                  data-testid="text-search-count"
                >
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{search}"
                </p>
              )}
            </div>

            <div className="px-5 py-3">
              {search.trim() ? (
                searchResults.length > 0 ? (
                  <div className="space-y-2.5">
                    {searchResults.map((article, i) => (
                      <ArticleCard key={article.id} article={article} onSelect={handleSelectArticle} index={i} marketingLocked={marketingLocked} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10" style={{ animation: "helpFadeIn 0.3s ease-out" }}>
                    <Search className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)", opacity: 0.3 }} />
                    <p className="text-sm font-medium mb-1" style={{ color: "var(--lux-text)" }}>No articles found</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Try different keywords or check the spelling</p>
                  </div>
                )
              ) : selectedCategory ? (
                <CategoryArticles
                  categoryName={selectedCategory}
                  onBack={handleBackFromCategory}
                  onSelect={handleSelectArticle}
                  marketingLocked={marketingLocked}
                />
              ) : (
                <>
                  {contextual.length > 0 ? (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "var(--lux-text-muted)" }}>
                        <Lightbulb className="w-3 h-3 inline-block mr-1 -mt-0.5" style={{ color: "#f59e0b" }} />
                        Relevant to this page
                      </p>
                      <div className="space-y-2.5 mb-6">
                        {contextual.map((article, i) => (
                          <ArticleCard key={article.id} article={article} onSelect={handleSelectArticle} index={i} marketingLocked={marketingLocked} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="mb-6 px-3 py-2.5 rounded-lg" style={{ background: "var(--lux-surface-subtle, rgba(0,0,0,0.02))", border: "1px dashed var(--lux-border)" }}>
                      <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        No articles yet for this page. Try searching above, or browse a category below.
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "var(--lux-text-muted)" }}>
                    Browse by category
                  </p>
                  <CategoryGrid onSelectCategory={setSelectedCategory} marketingLocked={marketingLocked} />
                </>
              )}
            </div>
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--color-border-1)" }}>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" style={{ color: "#cf3339" }} />
            <span className="text-[10px] font-medium" style={{ color: "var(--lux-text-muted)" }}>Powered by CherryAI</span>
          </div>
          <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>
            Press <kbd className="px-1 py-0.5 rounded text-[9px] font-mono font-bold" style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border-1)" }}>?</kbd> to toggle
          </span>
        </div>
      </div>
    </>
  );
}
