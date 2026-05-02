import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, X, Send, Lock, Sparkles, Clock, FileText, Calculator, Receipt, BookOpen, BarChart3, ChevronDown, ChevronUp, Search, MessageSquare, Minus, Trash2, CreditCard, Users, Globe, RefreshCw, ThumbsDown, ArrowLeft, Headphones, CheckCircle, AlertCircle, Loader2, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCSRFToken } from "@/lib/queryClient";

import { HELP_ARTICLES as ARTICLES, type HelpArticle } from "@/lib/help-articles";


interface Message {
  role: "assistant" | "user";
  content: string;
  articles?: HelpArticle[];
}

function searchArticles(query: string): HelpArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const stopWords = new Set(["how", "do", "i", "the", "a", "an", "is", "are", "what", "does", "can", "my", "me", "to", "in", "for", "of", "it", "this", "that", "with"]);
  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (words.length === 0) {
    const fallback = ARTICLES.filter(a => {
      const hay = `${a.title} ${a.keywords}`.toLowerCase();
      return hay.includes(q);
    });
    return fallback.slice(0, 5);
  }
  const scored = ARTICLES.map(a => {
    let score = 0;
    const titleLower = a.title.toLowerCase();
    const keywordsLower = a.keywords.toLowerCase();
    const categoryLower = a.category.toLowerCase();
    const bodyLower = a.body.toLowerCase();
    if (titleLower.includes(q)) score += 25;
    if (keywordsLower.includes(q)) score += 20;
    for (const w of words) {
      if (titleLower.includes(w)) score += 10;
      if (keywordsLower.includes(w)) score += 8;
      if (categoryLower.includes(w)) score += 5;
      if (bodyLower.includes(w)) score += 1;
      for (const kw of a.keywords.split(" ")) {
        if (kw === w) score += 5;
        else if (kw.startsWith(w) || w.startsWith(kw)) score += 2;
      }
    }
    return { article: a, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score >= 5).slice(0, 5).map(s => s.article);
}

function formatResponse(articles: HelpArticle[], _query: string): string {
  if (articles.length === 0) {
    return "";
  }
  if (articles.length === 1) {
    return "Here's what I found about that:";
  }
  return `I found ${articles.length} relevant articles for you. Here's what I think you're looking for:`;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Time Tracking": "#3b82f6",
  "Timesheets": "#6366f1",
  "Invoicing": "#f59e0b",
  "Payments": "#22c55e",
  "Expenses": "#ef4444",
  "Payouts": "#a855f7",
  "Projects": "#0ea5e9",
  "Clients": "#14b8a6",
  "Reports": "#8b5cf6",
  "Team": "#f97316",
  "Settings": "#6b7280",
  "Import": "#ec4899",
  "Getting Started": "#10b981",
  "Accounting": "#0891b2",
  "Estimates": "#d946ef",
  "Billing": "#f59e0b",
  "Management": "#64748b",
  "Services": "#06b6d4",
  "Dashboard": "#8b5cf6",
  "Profile": "#f97316",
  "Banking": "#0d9488",
  "Support": "#f43f5e",
};

function ArticleCard({ article, onThumbsDown }: { article: HelpArticle; onThumbsDown?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const catColor = CATEGORY_COLORS[article.category] || "#6b7280";
  const snippet = article.body.length > 80 ? article.body.slice(0, 80) + "..." : article.body;

  const toggle = () => setExpanded(prev => !prev);
  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      className="rounded-xl overflow-hidden cursor-pointer transition-all"
      style={{
        background: "var(--lux-bg)",
        border: "1px solid var(--lux-border)",
        boxShadow: expanded ? "var(--lux-card-shadow)" : (hovered ? "0 4px 15px rgba(0,0,0,0.1)" : "none"),
      }}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`article-card-${article.id}`}
    >
      <div className="px-3.5 py-2.5 flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: `${catColor}15`, color: catColor }}
            >
              {article.category}
            </span>
          </div>
          <p className="text-[12px] font-semibold leading-snug" style={{ color: "var(--lux-text)" }}>{article.title}</p>
          {!expanded && (
            <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>{snippet}</p>
          )}
        </div>
        <div className="flex-shrink-0 mt-1">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3.5 pb-3" style={{ animation: "ca-fadeIn 0.2s ease-out" }}>
          <div className="pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
            <div className="text-[12px] leading-relaxed space-y-2" style={{ color: "var(--lux-text-secondary)" }}>
              {article.body.replace(/\\n/g, '\n').split('\n\n').map((paragraph, pi) => (
                <p key={pi}>
                  {paragraph.split(/\*\*(.*?)\*\*/g).map((part, j) =>
                    j % 2 === 1 ? <span key={j} className="font-semibold" style={{ color: "var(--lux-text)" }}>{part}</span> : part
                  )}
                </p>
              ))}
            </div>
            {onThumbsDown && (
              <div className="flex items-center justify-end mt-2 pt-2" style={{ borderTop: "1px solid var(--lux-border)" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onThumbsDown(); }}
                  className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md cursor-pointer transition-all hover:opacity-80"
                  style={{ color: "var(--lux-text-muted)" }}
                  title="Not helpful — contact support"
                  data-testid={`button-thumbsdown-${article.id}`}
                >
                  <ThumbsDown className="w-3 h-3" />
                  Not helpful
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.12)` }}>
        <Bot className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
      </div>
      <div
        className="rounded-xl px-4 py-3"
        style={{ background: "var(--lux-bg)", backdropFilter: "blur(12px)", borderTopLeftRadius: "4px" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--lux-text-muted)", animation: "ca-typingDot 1.4s ease-in-out infinite" }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--lux-text-muted)", animation: "ca-typingDot 1.4s ease-in-out 0.2s infinite" }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--lux-text-muted)", animation: "ca-typingDot 1.4s ease-in-out 0.4s infinite" }} />
        </div>
      </div>
    </div>
  );
}

const QUICK_QUESTIONS: { q: string; icon: typeof Clock }[] = [
  { q: "How do I track time?", icon: Clock },
  { q: "How do invoices work?", icon: FileText },
  { q: "How do estimates work?", icon: Calculator },
  { q: "How do I scan receipts with AI?", icon: Receipt },
  { q: "How does the General Ledger work?", icon: BookOpen },
  { q: "What reports are available?", icon: BarChart3 },
  { q: "How do recurring invoices work?", icon: RefreshCw },
  { q: "How do I set up banking?", icon: CreditCard },
  { q: "How does the client portal work?", icon: Globe },
  { q: "How do I manage my team?", icon: Users },
  { q: "What's the Manager role?", icon: Shield },
  { q: "How do I import data from other platforms?", icon: Globe },
  { q: "How do I use the REST API?", icon: Globe },
];

const MANAGER_QUICK_ACTIONS = [
  "Promote a team member to Manager",
  "Review team member timesheets for approval",
  "View project profitability metrics",
  "Access the dashboard filtered for my team",
  "Understand cost field scrubbing",
];

const IMPORT_QUICK_ACTIONS = [
  "Start the multi-platform import wizard",
  "Learn which platforms are supported (QB, Xero, Wave, etc.)",
  "Import GL opening balances from my old system",
  "Migrate projects and team assignments",
  "Understand the import field mapping process",
];

const API_QUICK_ACTIONS = [
  "Enable the REST API on my account",
  "Create and manage API keys",
  "Set up webhooks to automate workflows",
  "Understand rate limits and best practices",
  "Connect CherryWorks Pro to Zapier or Make",
];

const PAYOUT_QUICK_ACTIONS = [
  "Set up Stripe Connect for team payouts",
  "Help a team member create a Stripe Connect account",
  "Pay a team member via Stripe Connect",
  "Understand payout auto-generation",
];

const GL_QUICK_ACTIONS = [
  "Set up my chart of accounts",
  "Create a manual journal entry",
  "View the trial balance report",
  "Review account ledger history",
  "Understand auto-posting rules",
];

const SUPPORT_QUICK_ACTIONS = [
  "Contact CherryWorks Pro support",
  "Report a bug or issue",
  "Request a feature",
];

const FEATURED_ARTICLES_NEW = [
  "gl-1",
  "mgr-1",
  "imp-1",
  "api-1",
  "pay-3",
];

function getFeaturedArticles() {
  return ARTICLES.filter(a => FEATURED_ARTICLES_NEW.includes(a.id));
}

type PanelView = "chat" | "support-form" | "support-confirmation";

interface SupportFormData {
  subject: string;
  message: string;
}

function SupportForm({ userName, userEmail, orgName, onSubmit, onBack, submitting }: {
  userName: string;
  userEmail: string;
  orgName: string;
  onSubmit: (data: SupportFormData) => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !submitting;

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(var(--lux-accent-rgb, 139,92,246),0.08) transparent", animation: "ca-fadeIn 0.3s ease-out" }}>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[11px] font-medium mb-4 cursor-pointer transition-colors hover:opacity-80"
        style={{ color: "var(--lux-text-secondary)" }}
        data-testid="button-support-back"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to chat
      </button>

      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.15)" }}>
          <Headphones className="w-6 h-6" style={{ color: "#f43f5e" }} />
        </div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--lux-text)" }}>Contact Support</h3>
        <p className="text-[11px] mt-1" style={{ color: "var(--lux-text-muted)" }}>We typically respond within one business day</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Name</label>
          <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text-secondary)" }} data-testid="text-support-name">
            {userName}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Email</label>
          <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text-secondary)" }} data-testid="text-support-email">
            {userEmail}
          </div>
        </div>

        {orgName && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Organization</label>
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text-secondary)" }} data-testid="text-support-org">
              {orgName}
            </div>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Brief description of your issue"
            className="w-full rounded-lg px-3 py-2 text-[12px] bg-transparent outline-none"
            style={{ border: "1px solid var(--lux-border)", color: "var(--lux-text)", caretColor: "var(--lux-accent)" }}
            data-testid="input-support-subject"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--lux-text-muted)" }}>Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Describe what you need help with..."
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-[12px] bg-transparent outline-none resize-none"
            style={{ border: "1px solid var(--lux-border)", color: "var(--lux-text)", caretColor: "var(--lux-accent)", scrollbarWidth: "thin", scrollbarColor: "rgba(var(--lux-accent-rgb, 139,92,246),0.08) transparent" }}
            data-testid="input-support-message"
          />
        </div>

        <button
          onClick={() => canSubmit && onSubmit({ subject: subject.trim(), message: message.trim() })}
          disabled={!canSubmit}
          className="w-full py-2.5 rounded-xl text-[12px] font-bold text-white cursor-pointer transition-all hover:scale-[1.01] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: canSubmit ? "var(--gradient-brand)" : "var(--lux-bg)" }}
          data-testid="button-support-submit"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              Submit Support Request
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SupportConfirmation({ referenceId, emailSent, onBack }: { referenceId: string; emailSent: boolean; onBack: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center" style={{ animation: "ca-fadeIn 0.3s ease-out" }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.15)" }}>
        <CheckCircle className="w-8 h-8" style={{ color: "#22c55e" }} />
      </div>
      <h3 className="text-[15px] font-bold mb-2" style={{ color: "var(--lux-text)" }}>Request Submitted</h3>
      <p className="text-[12px] leading-relaxed mb-4" style={{ color: "var(--lux-text-muted)" }}>
        Your support request has been received. Our team will get back to you within one business day.
      </p>

      <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
        <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--lux-text-muted)" }}>Reference Number</p>
        <p className="text-[14px] font-bold" style={{ fontFamily: "monospace", color: "var(--lux-text)" }} data-testid="text-support-reference">{referenceId}</p>
      </div>

      {!emailSent && (
        <div className="flex items-center gap-1.5 mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.12)" }}>
          <AlertCircle className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
          <p className="text-[10px]" style={{ color: "#f59e0b" }}>Email delivery pending. Your request was saved and will be reviewed.</p>
        </div>
      )}

      <button
        onClick={onBack}
        className="text-[12px] font-medium cursor-pointer transition-colors hover:opacity-80"
        style={{ color: "var(--lux-text-secondary)" }}
        data-testid="button-support-done"
      >
        Back to CherryAssist
      </button>
    </div>
  );
}

function CherryAssistStatusBadge() {
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
    <div className="flex items-center gap-1.5" data-testid="assist-status-badge">
      {status === "checking" ? (
        <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin" />
      ) : (
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
      )}
      <p className="text-[11px]" style={{ color: cfg.color }}>{cfg.label}</p>
    </div>
  );
}

export function CherryAssist() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [planTier, setPlanTier] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const [pulseVisible, setPulseVisible] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("chat");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportResult, setSupportResult] = useState<{ referenceId: string; emailSent: boolean } | null>(null);
  const [searchHistoryLog, setSearchHistoryLog] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetch("/api/billing/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setPlanTier(data.planTier); setOrgName(data.orgName || ""); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openSupportForm = useCallback(() => {
    setPanelView("support-form");
  }, []);

  const handleSupportSubmit = useCallback(async (data: SupportFormData) => {
    setSupportSubmitting(true);
    try {
      const csrfToken = getCSRFToken();
      const res = await fetch("/api/support-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
        credentials: "include",
        body: JSON.stringify({
          subject: data.subject,
          message: data.message,
          pageUrl: window.location.href,
          searchHistory: searchHistoryLog.slice(-5).join(", ") || null,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setSupportResult(result);
        setPanelView("support-confirmation");
      }
    } catch {
    } finally {
      setSupportSubmitting(false);
    }
  }, [searchHistoryLog]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!open) {
        setPulseVisible(true);
        pulseTimeoutRef.current = setTimeout(() => setPulseVisible(false), 2000);
      }
    }, 30000);
    return () => {
      clearInterval(interval);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, [open]);

  const handleSlashKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "/" && !open) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    }
  }, [open]);

  useEffect(() => {
    document.addEventListener("keydown", handleSlashKey);
    return () => document.removeEventListener("keydown", handleSlashKey);
  }, [handleSlashKey]);

  const isAllowed = planTier && !["TRIAL", "STARTER"].includes(planTier);

  const handleSend = (query?: string) => {
    const q = (query || input).trim();
    if (!q) return;
    if (!query) setInput("");
    setSearchHistoryLog(prev => [...prev, q]);
    const userMsg: Message = { role: "user", content: q };
    setMessages(prev => [...prev, userMsg]);
    setTyping(true);

    if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
    sendTimeoutRef.current = setTimeout(() => {
      const results = searchArticles(q);
      const response = formatResponse(results, q);
      setMessages(prev => [...prev, { role: "assistant", content: response, articles: results }]);
      setTyping(false);
    }, 400 + Math.random() * 300);
  };

  useEffect(() => {
    return () => {
      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
    };
  }, []);

  const clearChat = () => {
    setMessages([]);
    setInput("");
  };

  if (loading) return null;

  return (
    <>
      <style>{`
        @keyframes ca-slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ca-fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ca-typingDot {
          0%, 60%, 100% { opacity: 0.25; transform: scale(1); }
          30% { opacity: 1; transform: scale(1.3); }
        }
        @keyframes ca-pulse {
          0% { box-shadow: 0 0 0 0 rgba(var(--lux-accent-rgb, 139,92,246),0.5); }
          70% { box-shadow: 0 0 0 14px rgba(var(--lux-accent-rgb, 139,92,246),0); }
          100% { box-shadow: 0 0 0 0 rgba(var(--lux-accent-rgb, 139,92,246),0); }
        }
        @keyframes ca-gradientBorder {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes ca-onlinePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .ca-msg-enter { animation: ca-fadeIn 0.3s ease-out; }
      `}</style>

      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
        style={{
          background: "var(--gradient-brand)",
          boxShadow: pulseVisible ? undefined : (open ? "none" : `0 4px 30px rgba(var(--lux-accent-rgb, 139,92,246),0.5)`),
          animation: pulseVisible ? "ca-pulse 2s ease-in-out" : undefined,
        }}
        data-testid="button-cherry-assist"
        aria-label={open ? "Close CherryAssist" : "Open CherryAssist"}
      >
        {open ? <X className="w-6 h-6 text-white" /> : <Bot className="w-6 h-6 text-white" />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-[420px] max-h-[620px] rounded-2xl overflow-hidden flex flex-col"
          style={{
            background: "var(--lux-surface)",
            boxShadow: `var(--lux-card-shadow), 0 0 40px rgba(var(--lux-accent-rgb, 139,92,246),0.08)`,
            animation: "ca-slideUp 0.3s ease-out",
          }}
          data-testid="panel-cherry-assist"
        >
          <div
            className="p-[1px] rounded-2xl"
            style={{
              background: "var(--gradient-brand)",
              backgroundSize: "300% 300%",
              animation: "ca-gradientBorder 4s ease infinite",
            }}
          >
            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--lux-surface)", maxHeight: "618px" }}>

              <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ background: "var(--lux-bg)", borderBottom: "1px solid var(--lux-border)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.12)` }}>
                  <Bot className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "var(--lux-text)" }}>CherryAssist</p>
                  <CherryAssistStatusBadge />
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button onClick={clearChat} className="cursor-pointer p-1.5 rounded-lg transition-colors hover:opacity-80" title="Clear chat" data-testid="button-clear-chat">
                      <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                    </button>
                  )}
                  <button onClick={() => setOpen(false)} className="cursor-pointer p-1.5 rounded-lg transition-colors hover:opacity-80" title="Minimize" data-testid="button-minimize-assist">
                    <Minus className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                  </button>
                  <button onClick={() => setOpen(false)} className="cursor-pointer p-1.5 rounded-lg transition-colors hover:opacity-80" data-testid="button-close-assist">
                    <X className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                  </button>
                </div>
              </div>

              {!isAllowed ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.1)` }}>
                    <Lock className="w-8 h-8" style={{ color: "var(--lux-accent)" }} />
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ color: "var(--lux-text)" }}>CherryAssist is a Professional feature</h3>
                  <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--lux-text-muted)" }}>
                    Get instant AI-powered answers to any question about CherryWorks Pro. Available 24/7 on Professional, Business, and Enterprise plans.
                  </p>
                  <a
                    href="/pricing"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-all hover:scale-[1.02]"
                    style={{ background: "var(--gradient-brand)" }}
                    data-testid="link-upgrade-assist"
                  >
                    <Sparkles className="w-4 h-4" /> Upgrade to Professional
                  </a>
                  <p className="text-xs mt-4" style={{ color: "var(--lux-text-muted)" }}>Starting at $89/mo</p>
                </div>
              ) : panelView === "support-form" ? (
                <SupportForm
                  userName={user?.name || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || user?.email || ""}
                  userEmail={user?.email || ""}
                  orgName={orgName}
                  onSubmit={handleSupportSubmit}
                  onBack={() => setPanelView("chat")}
                  submitting={supportSubmitting}
                />
              ) : panelView === "support-confirmation" && supportResult ? (
                <SupportConfirmation
                  referenceId={supportResult.referenceId}
                  emailSent={supportResult.emailSent}
                  onBack={() => { setPanelView("chat"); setSupportResult(null); }}
                />
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(var(--lux-accent-rgb, 139,92,246),0.08) transparent" }}>
                    {messages.length === 0 && !typing && (
                      <div className="ca-msg-enter">
                        <div className="text-center mb-5 mt-2">
                          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.1)`, border: `1px solid rgba(var(--lux-accent-rgb, 139,92,246),0.15)` }}>
                            <Bot className="w-7 h-7" style={{ color: "var(--lux-accent)" }} />
                          </div>
                          <h3 className="text-[15px] font-bold" style={{ color: "var(--lux-text)" }}>How can I help?</h3>
                          <p className="text-[13px] mt-1" style={{ color: "var(--lux-text-secondary)" }}>Ask me anything about CherryWorks Pro</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-center">
                          {QUICK_QUESTIONS.map((qq, i) => {
                            const Icon = qq.icon;
                            return (
                              <button
                                key={i}
                                onClick={() => handleSend(qq.q)}
                                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-2 rounded-full cursor-pointer transition-all hover:scale-105"
                                style={{
                                  background: `rgba(var(--lux-accent-rgb, 139,92,246),0.06)`,
                                  color: "var(--lux-text-secondary)",
                                  border: `1px solid rgba(var(--lux-accent-rgb, 139,92,246),0.12)`,
                                }}
                                data-testid={`chip-quick-${i}`}
                              >
                                <Icon className="w-3 h-3" style={{ color: "var(--lux-accent)" }} />
                                {qq.q}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-6 pt-6 border-t" style={{ borderColor: "var(--lux-border)" }}>
                          <h4 className="text-[12px] font-bold mb-3 px-4" style={{ color: "var(--lux-text-secondary)" }}>
                            NEW FEATURES
                          </h4>
                          <div className="grid grid-cols-1 gap-2 px-4">
                            {getFeaturedArticles().map(article => (
                              <button
                                key={article.id}
                                onClick={() => handleSend(article.title)}
                                className="text-left p-3 rounded-lg transition-colors hover:bg-opacity-80"
                                style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246),0.08)" }}
                                data-testid={`featured-article-${article.id}`}
                              >
                                <div className="text-[13px] font-medium" style={{ color: "var(--lux-text)" }}>
                                  {article.title}
                                </div>
                                <div className="text-[11px]" style={{ color: "var(--lux-text-secondary)" }}>
                                  {article.category}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {messages.map((msg, i) => (
                      <div key={i} className={`ca-msg-enter flex gap-2.5 ${msg.role === "user" ? "justify-end" : ""}`}>
                        {msg.role === "assistant" && (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.12)` }}>
                            <Bot className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                          </div>
                        )}
                        <div className="max-w-[85%] space-y-2">
                          {msg.role === "user" ? (
                            <div
                              className="rounded-xl px-3.5 py-2.5"
                              style={{
                                background: `linear-gradient(135deg, rgba(var(--lux-accent-rgb, 139,92,246),0.15), rgba(var(--lux-accent-rgb, 139,92,246),0.08))`,
                                borderTopRightRadius: "4px",
                              }}
                            >
                              <p className="text-[13px] leading-relaxed" style={{ color: "var(--lux-text)" }}>{msg.content}</p>
                            </div>
                          ) : (
                            <>
                              {msg.content && (
                                <div
                                  className="rounded-xl px-3.5 py-2.5"
                                  style={{
                                    background: "var(--lux-bg)",
                                    backdropFilter: "blur(12px)",
                                    border: "1px solid var(--lux-border)",
                                    borderTopLeftRadius: "4px",
                                  }}
                                >
                                  <div className="text-[13px] leading-relaxed space-y-2" style={{ color: "var(--lux-text-secondary)" }}>
                                    {msg.content.replace(/\\n/g, '\n').split('\n\n').map((paragraph, pi) => (
                                      <p key={pi}>
                                        {paragraph.split(/\*\*(.*?)\*\*/g).map((part, j) =>
                                          j % 2 === 1 ? <span key={j} className="font-semibold" style={{ color: "var(--lux-text)" }}>{part}</span> : part
                                        )}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {msg.articles && msg.articles.length === 0 && (
                                <div className="rounded-xl px-4 py-5 text-center" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                                  <Search className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                                  <p className="text-[13px] font-medium" style={{ color: "var(--lux-text-muted)" }}>No results found</p>
                                  <p className="text-[11px] mt-1 mb-3" style={{ color: "var(--lux-text-muted)" }}>
                                    Try rephrasing your question, or browse the Help Panel for more topics.
                                  </p>
                                  <button
                                    onClick={openSupportForm}
                                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer transition-all hover:scale-105"
                                    style={{ background: "rgba(244,63,94,0.1)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.15)" }}
                                    data-testid="button-support-from-noresults"
                                  >
                                    <Headphones className="w-3 h-3" />
                                    Contact Support
                                  </button>
                                </div>
                              )}
                              {msg.articles && msg.articles.length > 0 && (
                                <div className="space-y-1.5">
                                  {msg.articles.map(a => (
                                    <ArticleCard key={a.id} article={a} onThumbsDown={openSupportForm} />
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}

                    {typing && <TypingIndicator />}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: "1px solid var(--lux-border)" }}>
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}>
                      <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                        placeholder="Ask CherryAssist anything..."
                        className="flex-1 bg-transparent text-[13px] outline-none"
                        style={{ caretColor: "var(--lux-accent)", color: "var(--lux-text)" }}
                        data-testid="input-cherry-assist"
                      />
                      <button
                        onClick={() => handleSend()}
                        disabled={!input.trim()}
                        className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all disabled:opacity-20 hover:scale-110"
                        style={{ background: `rgba(var(--lux-accent-rgb, 139,92,246),0.15)` }}
                        data-testid="button-send-assist"
                      >
                        <Send className="w-3.5 h-3.5" style={{ color: "var(--lux-accent)" }} />
                      </button>
                    </div>
                  </div>

                  <div className="px-4 py-2 text-center flex-shrink-0 flex items-center justify-between" style={{ background: "var(--lux-bg)", borderTop: "1px solid var(--lux-border)" }}>
                    <div className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3" style={{ color: "var(--lux-text-muted)" }} />
                      <p className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>Powered by CherryAI</p>
                    </div>
                    <button
                      onClick={openSupportForm}
                      className="flex items-center gap-1 text-[10px] cursor-pointer transition-colors"
                      style={{ color: "var(--lux-text-muted)" }}
                      data-testid="button-support-footer"
                    >
                      <Headphones className="w-2.5 h-2.5" />
                      Contact Support
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  );
}
