/**
 * Customer portal — the signed-in client space.
 *
 * Routes (all under /portal/:slug):
 *   /login             enter email → one-time link
 *   /verify?token=…    exchange the link for a session
 *   /                  support cases (home)
 *   /cases/new         open a case
 *   /cases/:id         conversation
 *   /billing           invoices · estimates · payments
 *
 * Deliberately single-theme: a dark ground with the firm's accent, a display
 * serif for the few large headings, generous type. It composites its own
 * background so it never inherits the app's light theme.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@/components/shared/format";
import { STATUS_LABEL, PRIORITY_LABEL, hoursLabel, relativeTime, type CaseStatus, type CasePriority } from "@/lib/support-cases";

// ─── Theme ────────────────────────────────────────────────────────────────
const T = {
  bg: "#0C0A0E",
  surface: "#151216",
  surface2: "#1C181D",
  line: "#2A2226",
  text: "#F1ECEE",
  text2: "#C9BEC1",
  muted: "#8F8488",
  accent: "var(--lux-accent, #cf3339)",
  accentSoft: "rgba(207,51,57,0.14)",
  good: "#5CCB8A", goodSoft: "#17301F",
  warn: "#E9A94A", warnSoft: "#34260E",
  info: "#8AB4F8", infoSoft: "#15233A",
};
const display = { fontFamily: "Fraunces, Georgia, 'Times New Roman', serif", fontWeight: 600, letterSpacing: "-0.01em" } as const;

const STATUS_STYLE: Record<CaseStatus, { fg: string; bg: string; label: string }> = {
  NEW: { fg: T.info, bg: T.infoSoft, label: "Received" },
  WAITING_ON_SUPPORT: { fg: T.info, bg: T.infoSoft, label: "With our team" },
  IN_PROGRESS: { fg: T.good, bg: T.goodSoft, label: "In progress" },
  WAITING_ON_CUSTOMER: { fg: T.warn, bg: T.warnSoft, label: "Waiting for you" },
  RESOLVED: { fg: T.good, bg: T.goodSoft, label: "Resolved" },
  CLOSED: { fg: T.text2, bg: T.surface2, label: "Closed" },
};

function Chip({ status }: { status: CaseStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.NEW;
  return <span style={{ color: s.fg, background: s.bg, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }} data-testid={`portal-chip-${status}`}>{s.label}</span>;
}

// ─── API ──────────────────────────────────────────────────────────────────
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "X-Requested-With": "cwp-portal", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data: any = (() => { try { return text ? JSON.parse(text) : null; } catch { return { message: text }; } })();
  if (!res.ok) { const err = new Error(data?.message || `${res.status}`); (err as any).status = res.status; throw err; }
  return data as T;
}

interface Me { orgSlug: string; orgName: string; orgLogoUrl: string | null; contact: { id: string; firstName: string; lastName: string; email: string; isPrimary: boolean }; client: { id: string; name: string; showHours: boolean }; org: { name: string; logoUrl: string | null; email: string | null; phone: string | null; website: string | null } | null }
interface PortalCaseRow { id: string; caseKey: string; subject: string; status: CaseStatus; priority: CasePriority; typeName: string | null; requesterName: string | null; createdAt: string; updatedAt: string; awaitingYou: boolean; hasNewReply: boolean; resolvedAt: string | null }
interface PortalCaseDetail { id: string; caseKey: string; subject: string; description: string | null; status: CaseStatus; priority: CasePriority; typeName: string | null; requesterName: string | null; assigneeName: string | null; createdAt: string; firstResponseAt: string | null; resolvedAt: string | null; messages: { id: string; authorName: string; fromTeam: boolean; body: string; createdAt: string }[]; events: { id: string; kind: string; toValue: string | null; createdAt: string }[]; hours: { minutes: number; billableMinutes: number } | null }
interface PortalType { id: string; name: string; description: string | null }

function useMe(slug: string) {
  return useQuery<Me>({ queryKey: ["portal-me", slug], queryFn: () => api<Me>("GET", `/api/portal/${slug}/me`), retry: false });
}

// ─── Shell ────────────────────────────────────────────────────────────────
function Shell({ slug, me, children, active }: { slug: string; me?: Me | null; children: React.ReactNode; active?: "support" | "billing" }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const logout = useMutation({ mutationFn: () => api("POST", `/api/portal/${slug}/auth/logout`), onSuccess: () => { qc.removeQueries({ queryKey: ["portal-me", slug] }); navigate(`/portal/${slug}/login`); } });
  const name = me?.orgName ?? me?.org?.name;
  useEffect(() => { document.title = name ? `${name} · Client Portal` : "Client Portal"; }, [name]);
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif" }} data-testid="portal-page">
      <header style={{ borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {me?.orgLogoUrl || me?.org?.logoUrl ? (
              <img src={me?.orgLogoUrl || me?.org?.logoUrl || ""} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "contain", background: "#fff" }} />
            ) : (
              <span style={{ width: 30, height: 30, borderRadius: 8, background: T.accent, display: "inline-block" }} aria-hidden />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me?.client.name ?? "Client portal"}</p>
              <p style={{ margin: 0, fontSize: 11, color: T.muted, letterSpacing: ".12em", textTransform: "uppercase" }}>{name ? `${name} · Client Portal` : "Client Portal"}</p>
            </div>
          </div>
          {me && (
            <nav style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 13 }} aria-label="Portal">
              <Link href={`/portal/${slug}`} style={{ color: active === "support" ? T.text : T.text2, textDecoration: "none", paddingBottom: 4, borderBottom: active === "support" ? `2px solid ${T.accent}` : "2px solid transparent" }}>Support</Link>
              <Link href={`/portal/${slug}/billing`} style={{ color: active === "billing" ? T.text : T.text2, textDecoration: "none", paddingBottom: 4, borderBottom: active === "billing" ? `2px solid ${T.accent}` : "2px solid transparent" }}>Billing</Link>
              <button onClick={() => logout.mutate()} style={{ background: "transparent", border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }} data-testid="portal-signout">Sign out</button>
            </nav>
          )}
        </div>
      </header>
      <main style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 64px" }}>{children}</main>
      <footer style={{ maxWidth: 920, margin: "0 auto", padding: "0 20px 32px", fontSize: 12, color: T.muted }}>
        {me?.org && <p style={{ margin: 0 }}>{me.org.name}{me.org.email ? ` · ${me.org.email}` : ""}{me.org.phone ? ` · ${me.org.phone}` : ""}</p>}
      </footer>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "transparent", color: T.text2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 14px", fontWeight: 500, fontSize: 14, cursor: "pointer" };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: T.surface2, color: T.text, border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, outline: "none" };
const card: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 20 };

// ─── Login ────────────────────────────────────────────────────────────────
function LoginPage({ slug }: { slug: string }) {
  const { data: branding } = useQuery<{ name: string; logoUrl: string | null }>({ queryKey: ["portal-branding", slug], queryFn: () => api("GET", `/api/portal/${slug}/branding`) });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const req = useMutation({ mutationFn: () => api<{ ok: boolean }>("POST", `/api/portal/${slug}/auth/request-link`, { email }), onSuccess: () => setSent(true) });
  return (
    <Shell slug={slug} me={branding ? ({ orgName: branding.name, orgLogoUrl: branding.logoUrl, client: { name: "Client portal" } } as any) : null}>
      <div style={{ maxWidth: 440, margin: "40px auto 0" }}>
        <h1 style={{ ...display, fontSize: 34, margin: "0 0 8px", lineHeight: 1.1 }}>Sign in</h1>
        <p style={{ color: T.text2, margin: "0 0 24px", lineHeight: 1.6 }}>Enter the email address {branding?.name ?? "we"} have on file and we'll send you a one-time sign-in link. No password to remember.</p>
        {sent ? (
          <div style={{ ...card, borderColor: T.good }} data-testid="portal-link-sent">
            <p style={{ margin: 0, fontWeight: 600 }}>Check your inbox</p>
            <p style={{ margin: "6px 0 0", color: T.text2, fontSize: 14, lineHeight: 1.6 }}>If <strong style={{ color: T.text }}>{email}</strong> is on file, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
            <button style={{ ...btnGhost, marginTop: 14 }} onClick={() => setSent(false)}>Use a different address</button>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); if (email.trim()) req.mutate(); }} style={card}>
            <label htmlFor="portal-email" style={{ display: "block", fontSize: 12, color: T.muted, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>Email</label>
            <input id="portal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={field} data-testid="portal-email" />
            {req.isError && <p style={{ color: T.warn, fontSize: 13, margin: "10px 0 0" }}>{(req.error as Error).message}</p>}
            <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 14 }} disabled={req.isPending} data-testid="portal-request-link">{req.isPending ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        )}
      </div>
    </Shell>
  );
}

// ─── Verify ───────────────────────────────────────────────────────────────
function VerifyPage({ slug }: { slug: string }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const token = useMemo(() => new URLSearchParams(search).get("token") || "", [search]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setError("This link is missing its token. Request a new one."); return; }
      try {
        await api("POST", `/api/portal/${slug}/auth/verify`, { token });
        if (cancelled) return;
        qc.removeQueries({ queryKey: ["portal-me", slug] });
        navigate(`/portal/${slug}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [token, slug, navigate, qc]);
  return (
    <Shell slug={slug}>
      <div style={{ maxWidth: 440, margin: "60px auto 0", textAlign: "center" }}>
        {error ? (
          <div style={card} data-testid="portal-verify-error">
            <p style={{ margin: 0, fontWeight: 600 }}>That link didn't work</p>
            <p style={{ margin: "6px 0 16px", color: T.text2, fontSize: 14 }}>{error}</p>
            <Link href={`/portal/${slug}/login`} style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>Request a new link</Link>
          </div>
        ) : (
          <p style={{ color: T.text2 }}>Signing you in…</p>
        )}
      </div>
    </Shell>
  );
}

// ─── Gate: redirect to login when not signed in ───────────────────────────
function Gate({ slug, children }: { slug: string; children: (me: Me) => React.ReactNode }) {
  const { data: me, isLoading, isError } = useMe(slug);
  const [, navigate] = useLocation();
  useEffect(() => { if (isError) navigate(`/portal/${slug}/login`, { replace: true }); }, [isError, navigate, slug]);
  if (isLoading || !me) return <Shell slug={slug}><p style={{ color: T.muted }}>Loading…</p></Shell>;
  return <>{children(me)}</>;
}

// ─── Home: cases ──────────────────────────────────────────────────────────
function HomePage({ slug }: { slug: string }) {
  return (
    <Gate slug={slug}>
      {me => <CasesList slug={slug} me={me} />}
    </Gate>
  );
}

function CasesList({ slug, me }: { slug: string; me: Me }) {
  const { data, isLoading } = useQuery<{ cases: PortalCaseRow[]; counts: { open: number; waitingOnYou: number; resolved: number } }>({ queryKey: ["portal-cases", slug], queryFn: () => api("GET", `/api/portal/${slug}/cases`) });
  const [showResolved, setShowResolved] = useState(false);
  const rows = (data?.cases ?? []).filter(r => showResolved ? true : !["RESOLVED", "CLOSED"].includes(r.status));
  return (
    <Shell slug={slug} me={me} active="support">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ ...display, fontSize: 30, margin: 0, lineHeight: 1.1 }} data-testid="portal-title">Your support cases</h1>
          <p style={{ margin: "6px 0 0", color: T.muted, fontSize: 13 }}>
            Signed in as {me.contact.firstName} {me.contact.lastName}
            {data ? ` · ${data.counts.open} open${data.counts.waitingOnYou ? ` · ${data.counts.waitingOnYou} waiting on you` : ""}` : ""}
          </p>
        </div>
        <Link href={`/portal/${slug}/cases/new`} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }} data-testid="portal-new-case">New support case</Link>
      </div>

      {isLoading ? (
        <p style={{ color: T.muted }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{showResolved ? "No cases yet" : "Nothing open right now"}</p>
          <p style={{ margin: "6px 0 0", color: T.text2, fontSize: 14 }}>When you need something, open a case and we'll get right on it.</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }} data-testid="portal-case-list">
          {rows.map(r => (
            <li key={r.id}>
              <Link href={`/portal/${slug}/cases/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ ...card, padding: "14px 16px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", borderColor: r.awaitingYou ? T.warn : T.line }} data-testid={`portal-case-${r.caseKey}`}>
                  <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: 12, color: T.accent, background: T.surface2, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{r.caseKey}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject}</span>
                      {r.hasNewReply && !["RESOLVED", "CLOSED"].includes(r.status) && <span title="New reply" style={{ width: 8, height: 8, borderRadius: 999, background: T.accent, display: "inline-block", flexShrink: 0 }} />}
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: T.muted }}>{r.requesterName ?? ""}{r.typeName ? ` · ${r.typeName}` : ""} · updated {relativeTime(r.updatedAt)}</p>
                  </div>
                  <Chip status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 16 }}>
        <button style={btnGhost} onClick={() => setShowResolved(v => !v)} data-testid="portal-toggle-resolved">{showResolved ? "Hide resolved" : `Show resolved${data ? ` (${data.counts.resolved})` : ""}`}</button>
      </div>
    </Shell>
  );
}

// ─── New case ─────────────────────────────────────────────────────────────
function NewCasePage({ slug }: { slug: string }) {
  return <Gate slug={slug}>{me => <NewCaseForm slug={slug} me={me} />}</Gate>;
}

function NewCaseForm({ slug, me }: { slug: string; me: Me }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: types } = useQuery<PortalType[]>({ queryKey: ["portal-types", slug], queryFn: () => api("GET", `/api/portal/${slug}/types`) });
  const [typeId, setTypeId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CasePriority>("MEDIUM");
  const create = useMutation({
    mutationFn: () => api<{ id: string; caseKey: string }>("POST", `/api/portal/${slug}/cases`, { typeId: typeId || null, subject, description, priority }),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ["portal-cases", slug] }); navigate(`/portal/${slug}/cases/${row.id}`); },
  });
  return (
    <Shell slug={slug} me={me} active="support">
      <Link href={`/portal/${slug}`} style={{ color: T.muted, fontSize: 13, textDecoration: "none" }}>← Your cases</Link>
      <h1 style={{ ...display, fontSize: 30, margin: "10px 0 6px" }}>What can we help with?</h1>
      <p style={{ color: T.text2, margin: "0 0 22px", lineHeight: 1.6 }}>Pick the closest match, then tell us what's happening. You'll get a case number right away.</p>
      <form onSubmit={e => { e.preventDefault(); if (subject.trim()) create.mutate(); }} style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} role="radiogroup" aria-label="Request type">
          {types?.map(t => {
            const on = typeId === t.id;
            return (
              <button type="button" key={t.id} role="radio" aria-checked={on} onClick={() => setTypeId(on ? "" : t.id)} style={{ ...card, textAlign: "left", cursor: "pointer", padding: 16, borderColor: on ? T.accent : T.line, background: on ? T.accentSoft : T.surface, color: T.text }} data-testid={`portal-type-${t.id}`}>
                <p style={{ margin: 0, fontWeight: 600 }}>{t.name}</p>
                {t.description && <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2, lineHeight: 1.5 }}>{t.description}</p>}
              </button>
            );
          })}
        </div>
        <div>
          <label htmlFor="portal-subject" style={{ display: "block", fontSize: 12, color: T.muted, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>Subject</label>
          <input id="portal-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} placeholder="One line that says what's wrong or what you need" style={field} data-testid="portal-subject" />
        </div>
        <div>
          <label htmlFor="portal-description" style={{ display: "block", fontSize: 12, color: T.muted, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>Details</label>
          <textarea id="portal-description" value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="What were you doing, what happened, and what did you expect? Screen names and record numbers help." style={{ ...field, resize: "vertical", lineHeight: 1.5 }} data-testid="portal-description" />
        </div>
        <div>
          <span style={{ display: "block", fontSize: 12, color: T.muted, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>How urgent is it?</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Urgency">
            {(["LOW", "MEDIUM", "HIGH", "URGENT"] as CasePriority[]).map(p => (
              <button type="button" key={p} role="radio" aria-checked={priority === p} onClick={() => setPriority(p)} style={{ ...btnGhost, padding: "8px 14px", borderColor: priority === p ? T.accent : T.line, color: priority === p ? T.text : T.text2, background: priority === p ? T.accentSoft : "transparent" }} data-testid={`portal-priority-${p}`}>{PRIORITY_LABEL[p]}</button>
            ))}
          </div>
        </div>
        {create.isError && <p style={{ color: T.warn, fontSize: 13, margin: 0 }}>{(create.error as Error).message}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link href={`/portal/${slug}`} style={{ ...btnGhost, textDecoration: "none" }}>Cancel</Link>
          <button type="submit" style={btnPrimary} disabled={!subject.trim() || create.isPending} data-testid="portal-submit-case">{create.isPending ? "Opening…" : "Open case"}</button>
        </div>
      </form>
    </Shell>
  );
}

// ─── Case detail ──────────────────────────────────────────────────────────
function CasePage({ slug, id }: { slug: string; id: string }) {
  return <Gate slug={slug}>{me => <CaseView slug={slug} id={id} me={me} />}</Gate>;
}

function CaseView({ slug, id, me }: { slug: string; id: string; me: Me }) {
  const qc = useQueryClient();
  const { data: c, isLoading, isError } = useQuery<PortalCaseDetail>({ queryKey: ["portal-case", slug, id], queryFn: () => api("GET", `/api/portal/${slug}/cases/${id}`), retry: false });
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: () => api("POST", `/api/portal/${slug}/cases/${id}/messages`, { body }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["portal-case", slug, id] }); qc.invalidateQueries({ queryKey: ["portal-cases", slug] }); },
  });
  if (isLoading) return <Shell slug={slug} me={me} active="support"><p style={{ color: T.muted }}>Loading…</p></Shell>;
  if (isError || !c) return <Shell slug={slug} me={me} active="support"><p>That case isn't available.</p><Link href={`/portal/${slug}`} style={{ color: T.accent }}>Back to your cases</Link></Shell>;
  const thread = [
    ...c.messages.map(m => ({ kind: "message" as const, at: m.createdAt, m })),
    ...c.events.filter(e => e.kind === "status" && e.toValue && ["RESOLVED", "WAITING_ON_CUSTOMER", "IN_PROGRESS", "CLOSED"].includes(e.toValue)).map(e => ({ kind: "event" as const, at: e.createdAt, e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <Shell slug={slug} me={me} active="support">
      <Link href={`/portal/${slug}`} style={{ color: T.muted, fontSize: 13, textDecoration: "none" }}>← Your cases</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "12px 0 6px" }}>
        <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: 13, color: T.accent }} data-testid="portal-case-key">{c.caseKey}</span>
        <Chip status={c.status} />
        {c.typeName && <span style={{ fontSize: 12, color: T.muted }}>{c.typeName}</span>}
      </div>
      <h1 style={{ ...display, fontSize: 28, margin: "0 0 6px", lineHeight: 1.15 }} data-testid="portal-case-subject">{c.subject}</h1>
      <p style={{ margin: "0 0 20px", color: T.muted, fontSize: 13 }}>
        Opened {relativeTime(c.createdAt)}{c.requesterName ? ` by ${c.requesterName}` : ""}{c.assigneeName ? ` · ${c.assigneeName} is on it` : " · waiting to be picked up"}
        {c.hours && ` · ${hoursLabel(c.hours.minutes)} logged`}
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {c.description && (
          <section style={card}>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>What you told us</p>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65, color: T.text2 }}>{c.description}</p>
          </section>
        )}

        <section style={card}>
          <p style={{ margin: "0 0 14px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Conversation</p>
          {thread.length === 0 ? (
            <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>We've received your case. You'll hear from us here and by email.</p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }} data-testid="portal-thread">
              {thread.map(item => item.kind === "event" ? (
                <li key={item.e.id} style={{ fontSize: 12, color: T.muted, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: T.line, display: "inline-block" }} />
                  {item.e.toValue ? `Marked ${STATUS_STYLE[item.e.toValue as CaseStatus]?.label.toLowerCase() ?? STATUS_LABEL[item.e.toValue as CaseStatus]?.toLowerCase()}` : "Updated"} · {relativeTime(item.e.createdAt)}
                </li>
              ) : (
                <li key={item.m.id} style={{ ...card, padding: 14, background: item.m.fromTeam ? T.surface2 : T.accentSoft, borderColor: item.m.fromTeam ? T.line : "rgba(207,51,57,0.35)" }} data-testid={item.m.fromTeam ? "portal-message-team" : "portal-message-you"}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, color: T.muted }}><strong style={{ color: T.text }}>{item.m.fromTeam ? item.m.authorName : "You"}</strong>{item.m.fromTeam ? ` · ${me.orgName}` : ""} · {new Date(item.m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{item.m.body}</p>
                </li>
              ))}
            </ol>
          )}
          {c.status !== "CLOSED" && (
            <form onSubmit={e => { e.preventDefault(); if (body.trim()) post.mutate(); }} style={{ marginTop: 16 }}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder={c.status === "RESOLVED" ? "Still having trouble? Reply here to reopen the case." : "Add details or reply to the team…"} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} data-testid="portal-reply" />
              {post.isError && <p style={{ color: T.warn, fontSize: 13, margin: "8px 0 0" }}>{(post.error as Error).message}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button type="submit" style={btnPrimary} disabled={!body.trim() || post.isPending} data-testid="portal-send">{post.isPending ? "Sending…" : c.status === "RESOLVED" ? "Reply and reopen" : "Send"}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </Shell>
  );
}

// ─── Billing ──────────────────────────────────────────────────────────────
interface Billing { invoices: { id: string; number: string; status: string; issuedDate: string; dueDate: string; total: string; paidAmount: string; publicToken: string | null }[]; estimates: { id: string; number: string; status: string; issuedDate: string; expiryDate: string | null; total: string; publicToken: string | null }[]; payments: { id: string; amount: string; method: string; date: string; invoiceNumber: string }[]; totalBilled: string; totalPaid: string; outstanding: string }

function BillingPage({ slug }: { slug: string }) {
  return <Gate slug={slug}>{me => <BillingView slug={slug} me={me} />}</Gate>;
}

function BillingView({ slug, me }: { slug: string; me: Me }) {
  const { data, isLoading } = useQuery<Billing>({ queryKey: ["portal-billing", slug], queryFn: () => api("GET", `/api/portal/${slug}/billing`) });
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase", padding: "8px 10px", borderBottom: `1px solid ${T.line}` };
  const td: React.CSSProperties = { padding: "10px", borderBottom: `1px solid ${T.line}`, fontSize: 14, verticalAlign: "top" };
  return (
    <Shell slug={slug} me={me} active="billing">
      <h1 style={{ ...display, fontSize: 30, margin: "0 0 18px" }}>Billing</h1>
      {isLoading || !data ? <p style={{ color: T.muted }}>Loading…</p> : (
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {[["Billed", data.totalBilled], ["Paid", data.totalPaid], ["Outstanding", data.outstanding]].map(([k, v]) => (
              <div key={k} style={{ ...card, padding: 14 }}>
                <p style={{ margin: 0, fontSize: 11, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>{k}</p>
                <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: k === "Outstanding" && Number(v) > 0 ? T.warn : T.text }}>{formatMoney(v)}</p>
              </div>
            ))}
          </div>
          <section style={card}>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Invoices</p>
            {data.invoices.length === 0 ? <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>No invoices yet.</p> : (
              <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Invoice</th><th style={th}>Issued</th><th style={th}>Due</th><th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={{ ...th, textAlign: "right" }}>Balance</th><th style={th}></th></tr></thead>
                <tbody>{data.invoices.map(i => (
                  <tr key={i.id}><td style={td}>{i.number}</td><td style={td}>{i.issuedDate}</td><td style={td}>{i.dueDate}</td><td style={td}>{i.status}</td><td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(i.total)}</td><td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(Number(i.total) - Number(i.paidAmount))}</td><td style={td}>{i.publicToken && <a href={`/i/${i.publicToken}`} style={{ color: T.accent }}>View</a>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <section style={card}>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Estimates</p>
            {data.estimates.length === 0 ? <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>No estimates yet.</p> : (
              <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Estimate</th><th style={th}>Issued</th><th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={th}></th></tr></thead>
                <tbody>{data.estimates.map(e => (
                  <tr key={e.id}><td style={td}>{e.number}</td><td style={td}>{e.issuedDate}</td><td style={td}>{e.status}</td><td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(e.total)}</td><td style={td}>{e.publicToken && <a href={`/e/${e.publicToken}`} style={{ color: T.accent }}>View</a>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <section style={card}>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 }}>Payments</p>
            {data.payments.length === 0 ? <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>No payments recorded.</p> : (
              <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Date</th><th style={th}>Invoice</th><th style={th}>Method</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>{data.payments.map(p => (
                  <tr key={p.id}><td style={td}>{p.date}</td><td style={td}>{p.invoiceNumber}</td><td style={td}>{p.method}</td><td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(p.amount)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────
export default function PortalApp() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  return (
    <Switch>
      <Route path="/portal/:slug/login">{() => <LoginPage slug={slug} />}</Route>
      <Route path="/portal/:slug/verify">{() => <VerifyPage slug={slug} />}</Route>
      <Route path="/portal/:slug/cases/new">{() => <NewCasePage slug={slug} />}</Route>
      <Route path="/portal/:slug/cases/:id">{(p) => <CasePage slug={slug} id={p.id} />}</Route>
      <Route path="/portal/:slug/billing">{() => <BillingPage slug={slug} />}</Route>
      <Route path="/portal/:slug">{() => <HomePage slug={slug} />}</Route>
      <Route>{() => <HomePage slug={slug} />}</Route>
    </Switch>
  );
}
