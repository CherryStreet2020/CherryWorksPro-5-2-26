/**
 * Pieces shared by the two customer surfaces:
 *   Help Center     /help/:slug    — support cases only, never money
 *   Customer Portal /portal/:slug  — invoices · estimates · payments (billing contacts)
 *
 * Both use the same magic-link sign-in and the same session cookie; what a
 * contact may see is decided per request by their flags (portalRole,
 * billingAccess), not by which door they came in through.
 *
 * Deliberately single-theme: a dark ground with the firm's accent, a display
 * Inter throughout, matching the app (heavier, tighter headings), generous type. It composites its own
 * background so it never inherits the app's light theme.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { STATUS_LABEL, type CaseStatus } from "@/lib/support-cases";

export type Surface = "help" | "portal";
export const SURFACE_PATH: Record<Surface, string> = { help: "/help", portal: "/portal" };
export const SURFACE_NAME: Record<Surface, string> = { help: "Help Center", portal: "Customer Portal" };
export const basePath = (surface: Surface, slug: string) => `${SURFACE_PATH[surface]}/${slug}`;

// ─── Theme ────────────────────────────────────────────────────────────────
// Same palette as the app's dark theme (client/src/lib/cherry-theme.css .dark): the customer surfaces
// look like the product the firm works in.
export const T = {
  bg: "#080c14",
  surface: "#111827",
  surface2: "#1a2234",
  line: "rgba(255,255,255,0.08)",
  text: "#f5f8fb",
  text2: "#c6d0da",
  muted: "#8a96a6",
  accent: "var(--lux-accent, #cf3339)",
  accentSoft: "rgba(207,51,57,0.16)",
  good: "#5CCB8A", goodSoft: "#14301f",
  warn: "#E9A94A", warnSoft: "#33260f",
  info: "#8AB4F8", infoSoft: "#15233a",
};
// Same type as the app: Inter for everything (headings are heavier and tighter, keys are tabular).
const APP_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const display = { fontFamily: APP_FONT, fontWeight: 700, letterSpacing: "-0.02em" } as const;
/** Case keys and other short identifiers: Inter, semibold, tabular figures. */
export const keyText = { fontFamily: APP_FONT, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" } as const;
/** @deprecated use `keyText` — kept as an alias for existing call sites. */
export const mono = keyText;

export const STATUS_STYLE: Record<CaseStatus, { fg: string; bg: string; label: string }> = {
  NEW: { fg: T.info, bg: T.infoSoft, label: "Received" },
  WAITING_ON_SUPPORT: { fg: T.info, bg: T.infoSoft, label: "With our team" },
  IN_PROGRESS: { fg: T.good, bg: T.goodSoft, label: "In progress" },
  WAITING_ON_CUSTOMER: { fg: T.warn, bg: T.warnSoft, label: "Waiting for you" },
  BLOCKED: { fg: T.warn, bg: T.warnSoft, label: "Blocked" },
  RESOLVED: { fg: T.good, bg: T.goodSoft, label: "Resolved" },
  CLOSED: { fg: T.muted, bg: T.surface2, label: "Closed" },
};

export function Chip({ status }: { status: CaseStatus }) {
  const s = STATUS_STYLE[status] ?? { fg: T.muted, bg: T.surface2, label: STATUS_LABEL[status] ?? status };
  return <span style={{ color: s.fg, background: s.bg, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }} data-testid={`portal-chip-${status}`}>{s.label}</span>;
}

export const btnPrimary: React.CSSProperties = { background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" };
export const btnGhost: React.CSSProperties = { background: "transparent", color: T.text2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 14px", fontWeight: 500, fontSize: 14, cursor: "pointer" };
export const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: T.surface2, color: T.text, border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 14px", fontSize: 15, outline: "none" };
export const card: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 20 };
export const label: React.CSSProperties = { display: "block", fontSize: 12, color: T.muted, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" };
export const eyebrow: React.CSSProperties = { margin: "0 0 8px", fontSize: 11, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 };

// ─── API ──────────────────────────────────────────────────────────────────
export class PortalApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "X-Requested-With": "cwp-portal", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data: any = (() => { try { return text ? JSON.parse(text) : null; } catch { return { message: text }; } })();
  if (!res.ok) throw new PortalApiError(data?.message || `${res.status}`, res.status, data?.code);
  return data as T;
}

export interface Me {
  orgSlug: string; orgName: string; orgLogoUrl: string | null;
  contact: { id: string; firstName: string; lastName: string; email: string; isPrimary: boolean; portalRole: "member" | "admin"; billingAccess: boolean; needsName: boolean };
  client: { id: string; name: string; showHours: boolean };
  org: { name: string; logoUrl: string | null; email: string | null; phone: string | null; website: string | null; supportEmail?: string | null } | null;
}

export function useMe(slug: string) {
  return useQuery<Me>({ queryKey: ["portal-me", slug], queryFn: () => api<Me>("GET", `/api/portal/${slug}/me`), retry: false, refetchOnWindowFocus: true, staleTime: 0 });
}

const AUTH_EPOCH_KEY = "cwp-portal-auth-epoch";
/** Tell every other tab in this browser that who-is-signed-in changed. */
export function announceAuthChange(slug: string) {
  try { localStorage.setItem(AUTH_EPOCH_KEY, `${slug}:${Date.now()}`); } catch { /* storage unavailable */ }
}
/** In every tab: when another tab signs in or out, drop everything cached and re-check identity. */
export function usePortalAuthSync(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_EPOCH_KEY) return;
      // Queries here are being observed by mounted components, so reset (not remove):
      // the protected ones go back to empty and refetch, and /me refetches — a 401
      // sends the Gate to the login page, a new person re-renders with their own data.
      const mine = (key: readonly unknown[]) => typeof key[0] === "string" && (key[0].startsWith("help-") || (key[0].startsWith("portal-") && key[0] !== "portal-me")) && key[1] === slug;
      void qc.resetQueries({ predicate: q => mine(q.queryKey) });
      // Reset (not invalidate): a stale 401 must not survive as "error" into the next
      // mount — the Gate would bounce to login before the fresh answer arrives.
      void qc.resetQueries({ queryKey: ["portal-me", slug] });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [qc, slug]);
}

/** Every protected query is keyed by contact id and dropped on sign-out / sign-in, so
 *  two people sharing a browser never see each other's cached cases or billing. */
export function clearPortalCaches(qc: QueryClient, slug: string) {
  const mine = (key: readonly unknown[]) => typeof key[0] === "string" && (key[0].startsWith("help-") || (key[0].startsWith("portal-") && key[0] !== "portal-me")) && key[1] === slug;
  void qc.cancelQueries({ predicate: q => mine(q.queryKey) });
  qc.removeQueries({ predicate: q => mine(q.queryKey) });
}

// ─── Shell ────────────────────────────────────────────────────────────────
export function Shell({ surface, slug, me, children, active }: { surface: Surface; slug: string; me?: Me | null; children: React.ReactNode; active?: "cases" | "team" | "billing" }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const base = basePath(surface, slug);
  usePortalAuthSync(slug);
  const logout = useMutation({ mutationFn: () => api("POST", `/api/portal/${slug}/auth/logout`), onSuccess: () => { clearPortalCaches(qc, slug); qc.removeQueries({ queryKey: ["portal-me", slug] }); announceAuthChange(slug); navigate(`${base}/login`); } });
  const name = me?.orgName ?? me?.org?.name;
  const surfaceName = SURFACE_NAME[surface];
  useEffect(() => { document.title = name ? `${name} · ${surfaceName}` : surfaceName; }, [name, surfaceName]);
  const tab = (href: string, on: boolean, text: string, testid: string) => (
    <Link href={href} style={{ color: on ? T.text : T.text2, textDecoration: "none", paddingBottom: 4, borderBottom: on ? `2px solid ${T.accent}` : "2px solid transparent" }} data-testid={testid}>{text}</Link>
  );
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif" }} data-testid="portal-page" data-surface={surface}>
      <header style={{ borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {me?.orgLogoUrl || me?.org?.logoUrl ? (
              <img src={me?.orgLogoUrl || me?.org?.logoUrl || ""} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "contain", background: "#fff" }} />
            ) : (
              <span style={{ width: 30, height: 30, borderRadius: 8, background: T.accent, display: "inline-block" }} aria-hidden />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me?.client?.name ?? surfaceName}</p>
              <p style={{ margin: 0, fontSize: 11, color: T.muted, letterSpacing: ".12em", textTransform: "uppercase" }}>{name ? `${name} · ${surfaceName}` : surfaceName}</p>
            </div>
          </div>
          {me?.contact && (
            <nav style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 13 }} aria-label={surfaceName}>
              {surface === "help" && tab(base, active === "cases", "Cases", "portal-nav-cases")}
              {surface === "help" && me.contact.portalRole === "admin" && tab(`${base}/team`, active === "team", "Team", "portal-nav-team")}
              {surface === "help" && me.contact.billingAccess && tab(`/portal/${slug}`, false, "Billing →", "portal-nav-billing")}
              {surface === "portal" && tab(`/portal/${slug}`, active === "billing", "Billing", "portal-nav-billing")}
              {surface === "portal" && tab(`/help/${slug}`, false, "Support →", "portal-nav-support")}
              <button onClick={() => logout.mutate()} style={{ background: "transparent", border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }} data-testid="portal-signout">Sign out</button>
            </nav>
          )}
        </div>
      </header>
      <main style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 64px" }}>{children}</main>
      <footer style={{ maxWidth: 920, margin: "0 auto", padding: "0 20px 32px", fontSize: 12, color: T.muted }}>
        {/* Help Center: the support mailbox, no phone. Customer Portal (billing): the firm's general contact. */}
        {me?.org && (surface === "help"
          ? <p style={{ margin: 0 }}>{me.org.name}{me.org.supportEmail ? ` · ${me.org.supportEmail}` : ""}</p>
          : <p style={{ margin: 0 }}>{me.org.name}{me.org.email ? ` · ${me.org.email}` : ""}{me.org.phone ? ` · ${me.org.phone}` : ""}</p>)}
      </footer>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────
export function LoginPage({ surface, slug }: { surface: Surface; slug: string }) {
  const { data: branding } = useQuery<{ name: string; logoUrl: string | null }>({ queryKey: ["portal-branding", slug], queryFn: () => api("GET", `/api/portal/${slug}/branding`) });
  const search = useSearch();
  const next = useMemo(() => safeNext(new URLSearchParams(search).get("next"), surface, slug), [search, surface, slug]);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const req = useMutation({ mutationFn: () => api<{ ok: boolean }>("POST", `/api/portal/${slug}/auth/request-link`, { email, surface, ...(next ? { next } : {}) }), onSuccess: () => setSent(true) });
  const copy = surface === "help"
    ? "Enter your work email and we'll send you a one-time sign-in link. If your company uses this Help Center, you're already in — no account to create, no password to remember."
    : `Enter the email address ${branding?.name ?? "we"} have on file for billing and we'll send you a one-time sign-in link. No password to remember.`;
  return (
    <Shell surface={surface} slug={slug} me={branding ? ({ orgName: branding.name, orgLogoUrl: branding.logoUrl, client: { name: SURFACE_NAME[surface] } } as any) : null}>
      <div style={{ maxWidth: 440, margin: "40px auto 0" }}>
        <h1 style={{ ...display, fontSize: 34, margin: "0 0 8px", lineHeight: 1.1 }}>{surface === "help" ? "Get help" : "Sign in"}</h1>
        <p style={{ color: T.text2, margin: "0 0 24px", lineHeight: 1.6 }}>{copy}</p>
        {sent ? (
          <div style={{ ...card, borderColor: T.good }} data-testid="portal-link-sent">
            <p style={{ margin: 0, fontWeight: 600 }}>Check your inbox</p>
            <p style={{ margin: "6px 0 0", color: T.text2, fontSize: 14, lineHeight: 1.6 }}>If <strong style={{ color: T.text }}>{email}</strong> can use this {SURFACE_NAME[surface]}, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
            <button style={{ ...btnGhost, marginTop: 14 }} onClick={() => setSent(false)}>Use a different address</button>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); if (email.trim()) req.mutate(); }} style={card}>
            <label htmlFor="portal-email" style={label}>Email</label>
            <input id="portal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={field} data-testid="portal-email" />
            {req.isError && <p style={{ color: T.warn, fontSize: 13, margin: "10px 0 0" }}>{(req.error as Error).message}</p>}
            <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 14 }} disabled={req.isPending} data-testid="portal-request-link">{req.isPending ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        )}
        {surface === "portal" && <p style={{ color: T.muted, fontSize: 13, marginTop: 18 }}>Looking for support? <Link href={`/help/${slug}`} style={{ color: T.accent }}>Go to the Help Center</Link>.</p>}
      </div>
    </Shell>
  );
}

// ─── Verify ───────────────────────────────────────────────────────────────
export function VerifyPage({ surface, slug }: { surface: Surface; slug: string }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const token = useMemo(() => new URLSearchParams(search).get("token") || "", [search]);
  const next = useMemo(() => safeNext(new URLSearchParams(search).get("next"), surface, slug), [search, surface, slug]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = basePath(surface, slug);
  useEffect(() => { if (!token) setError("This link is missing its token. Request a new one."); }, [token]);
  // The token is exchanged only on a click, never on page load: corporate mail scanners
  // (Safe Links and friends) open every link in a sandbox first, and a page that signed in by
  // itself would spend the one-time link before the person ever saw it.
  const signIn = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      clearPortalCaches(qc, slug);
      qc.removeQueries({ queryKey: ["portal-me", slug] });
      await api("POST", `/api/portal/${slug}/auth/verify`, { token });
      clearPortalCaches(qc, slug);
      qc.removeQueries({ queryKey: ["portal-me", slug] });
      announceAuthChange(slug);
      navigate(next ?? base, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Shell surface={surface} slug={slug}>
      <div style={{ maxWidth: 440, margin: "60px auto 0", textAlign: "center" }}>
        {error ? (
          <div style={card} data-testid="portal-verify-error">
            <p style={{ margin: 0, fontWeight: 600 }}>That link didn't work</p>
            <p style={{ margin: "6px 0 16px", color: T.text2, fontSize: 14 }}>{error}</p>
            <Link href={`${base}/login`} style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>Request a new link</Link>
          </div>
        ) : (
          <div style={card} data-testid="portal-verify-ready">
            <p style={{ margin: 0, fontWeight: 600, fontSize: 18 }}>You're almost in</p>
            <p style={{ margin: "6px 0 18px", color: T.text2, fontSize: 14 }}>Click below to finish signing in. This link works once.</p>
            <button type="button" onClick={signIn} disabled={busy} style={btnPrimary} data-testid="portal-verify-continue">{busy ? "Signing you in…" : surface === "portal" ? "Open the Customer Portal" : "Open the Help Center"}</button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─── Gate: redirect to login when not signed in ───────────────────────────
/** Only a path on this org's own surface is ever used as a return destination. */
export function safeNext(raw: string | null | undefined, surface: Surface, slug: string): string | null {
  if (!raw) return null;
  const prefix = `${basePath(surface, slug)}`;
  if (!(raw === prefix || raw.startsWith(prefix + "/"))) return null;
  if (!/^[A-Za-z0-9/_-]+$/.test(raw) || /\/(login|verify)$/.test(raw)) return null;
  return raw;
}

export function Gate({ surface, slug, children }: { surface: Surface; slug: string; children: (me: Me) => React.ReactNode }) {
  const { data: me, isLoading, isError, isFetching } = useMe(slug);
  const [location, navigate] = useLocation();
  useEffect(() => {
    // Only a CURRENT error sends people to login; an old one being refetched does not.
    if (!isError || isFetching) return;
    const next = safeNext(location, surface, slug);
    navigate(`${basePath(surface, slug)}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
  }, [isError, isFetching, navigate, slug, surface, location]);
  if (isLoading || isFetching && !me || !me) return <Shell surface={surface} slug={slug}><p style={{ color: T.muted }}>Loading…</p></Shell>;
  return <>{children(me)}</>;
}

export function relDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
