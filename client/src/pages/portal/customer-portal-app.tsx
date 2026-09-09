/**
 * Customer Portal — invoices · estimates · payments (and hours when the firm
 * allows it). Billing contacts only; support lives in the Help Center.
 *
 * Routes (all under /portal/:slug):
 *   /login             enter email → one-time link
 *   /verify?token=…    exchange the link for a session
 *   /                  billing
 *   /billing           billing (older links)
 *   /cases/*           → redirected to the Help Center (older emails linked here)
 */
import { Link, Redirect, Route, Switch, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatMoney } from "@/components/shared/format";
import { T, display, card, eyebrow, btnPrimary, api, PortalApiError, type Me, Shell, LoginPage, VerifyPage, Gate } from "./portal-shared";

const SURFACE = "portal" as const;

interface Billing { invoices: { id: string; number: string; status: string; issuedDate: string; dueDate: string; total: string; paidAmount: string; publicToken: string | null }[]; estimates: { id: string; number: string; status: string; issuedDate: string; expiryDate: string | null; total: string; publicToken: string | null }[]; payments: { id: string; amount: string; method: string; date: string; invoiceNumber: string }[]; totalBilled: string; totalPaid: string; outstanding: string }

function BillingPage({ slug }: { slug: string }) {
  return <Gate surface={SURFACE} slug={slug}>{me => <BillingView slug={slug} me={me} />}</Gate>;
}

function BillingView({ slug, me }: { slug: string; me: Me }) {
  const { data, isLoading, error } = useQuery<Billing>({ queryKey: ["portal-billing", slug, me.contact.id], queryFn: () => api("GET", `/api/portal/${slug}/billing`), retry: false, enabled: me.contact.billingAccess });
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase", padding: "8px 10px", borderBottom: `1px solid ${T.line}` };
  const td: React.CSSProperties = { padding: "10px", borderBottom: `1px solid ${T.line}`, fontSize: 14, verticalAlign: "top" };
  const denied = !me.contact.billingAccess || (error instanceof PortalApiError && error.code === "NO_BILLING_ACCESS");
  if (denied) {
    return (
      <Shell surface={SURFACE} slug={slug} me={me} active="billing">
        <div style={{ maxWidth: 520, margin: "40px auto 0" }}>
          <div style={card} data-testid="portal-billing-denied">
            <h1 style={{ ...display, fontSize: 26, margin: "0 0 8px", lineHeight: 1.15 }}>Billing isn't enabled for your account</h1>
            <p style={{ color: T.text2, margin: "0 0 18px", lineHeight: 1.6 }}>Invoices and payments are shown to your company's billing contacts. If that should be you, ask {me.orgName} to turn on billing access for <strong style={{ color: T.text }}>{me.contact.email}</strong>. For support, the Help Center is open to you.</p>
            <Link href={`/help/${slug}`} style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }} data-testid="portal-go-help">Go to the Help Center</Link>
          </div>
        </div>
      </Shell>
    );
  }
  return (
    <Shell surface={SURFACE} slug={slug} me={me} active="billing">
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
            <p style={eyebrow}>Invoices</p>
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
            <p style={eyebrow}>Estimates</p>
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
            <p style={eyebrow}>Payments</p>
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
export default function CustomerPortalApp() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  return (
    <Switch>
      <Route path="/portal/:slug/login">{() => <LoginPage surface={SURFACE} slug={slug} />}</Route>
      <Route path="/portal/:slug/verify">{() => <VerifyPage surface={SURFACE} slug={slug} />}</Route>
      {/* Support moved to the Help Center; older case emails linked here. */}
      <Route path="/portal/:slug/cases/new">{() => <Redirect to={`/help/${slug}/cases/new`} replace />}</Route>
      <Route path="/portal/:slug/cases/:id">{(p) => <Redirect to={`/help/${slug}/cases/${p.id}`} replace />}</Route>
      <Route path="/portal/:slug/billing">{() => <BillingPage slug={slug} />}</Route>
      <Route path="/portal/:slug">{() => <BillingPage slug={slug} />}</Route>
      <Route>{() => <BillingPage slug={slug} />}</Route>
    </Switch>
  );
}
