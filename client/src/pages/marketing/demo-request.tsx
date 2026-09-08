import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle, ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export default function DemoRequestPage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [form, setForm] = useState({ name: "", email: "", company: "", teamSize: "", message: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/public/demo-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setState({ kind: "error", message: body.message || "Something went wrong. Please email info@cherrystconsulting.com." }); return; }
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", message: "Network error. Please email info@cherrystconsulting.com." });
    }
  }

  const field = "w-full rounded-lg px-4 py-3 text-base text-white outline-none focus:ring-2";
  const fieldStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" };

  return (
    <div>
      <MarketingNav />
      <SEO path="/demo" />
      <section className="pt-[100px] pb-16" style={{ background: "var(--gradient-hero)", minHeight: "80vh" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#f87171" }}>Demo</p>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-[1.08]" data-testid="demo-h1">Twenty minutes, your scenario, no slides</h1>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Tell us how your firm bills and where the time goes today. We&rsquo;ll walk the same flow in CherryWorks Pro — from a client email to the invoice, the ledger and the payout — on a screen share.
            </p>
            <ul className="mt-8 space-y-3">
              {["Your request goes straight into our own Marketing Hub — a person replies within one business day", "Prefer to look around first? The self-guided tour shows every screen", "Already decided? The free trial has everything on"].map((t) => (
                <li key={t} className="flex gap-3 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}><CheckCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />{t}</li>
              ))}
            </ul>
            <div className="mt-8 flex gap-4 text-sm">
              <Link href="/tour"><span className="inline-flex items-center gap-1 font-semibold cursor-pointer" style={{ color: "#f87171" }}>Take the tour <ArrowRight className="w-4 h-4" /></span></Link>
              <Link href="/signup"><span className="inline-flex items-center gap-1 font-semibold cursor-pointer" style={{ color: "rgba(255,255,255,0.7)" }}>Start free</span></Link>
            </div>
          </div>
          <div className="rounded-2xl p-6 md:p-8" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {state.kind === "sent" ? (
              <div className="text-center py-10" data-testid="demo-sent">
                <CheckCircle className="w-10 h-10 mx-auto mb-4" style={{ color: "#22c55e" }} />
                <h2 className="text-2xl font-bold text-white">Request received</h2>
                <p className="mt-3 text-base" style={{ color: "rgba(255,255,255,0.6)" }}>A person will reply within one business day.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4" data-testid="demo-form">
                <h2 className="text-xl font-bold text-white">Request a demo</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input required className={field} style={fieldStyle} placeholder="Your name" value={form.name} onChange={set("name")} data-testid="demo-name" />
                  <input required type="email" className={field} style={fieldStyle} placeholder="Work email" value={form.email} onChange={set("email")} data-testid="demo-email" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input required className={field} style={fieldStyle} placeholder="Firm" value={form.company} onChange={set("company")} data-testid="demo-company" />
                  <select className={field} style={fieldStyle} value={form.teamSize} onChange={set("teamSize")} data-testid="demo-team-size">
                    <option value="">Team size</option>
                    <option value="1-5">1–5</option><option value="6-15">6–15</option><option value="16-50">16–50</option><option value="51+">51+</option>
                  </select>
                </div>
                <textarea className={field} style={fieldStyle} rows={4} placeholder="What do you use today, and what is not working?" value={form.message} onChange={set("message")} data-testid="demo-message" />
                {state.kind === "error" && <p className="text-sm" style={{ color: "#f87171" }} data-testid="demo-error">{state.message}</p>}
                <button type="submit" disabled={state.kind === "sending"} className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 text-base font-bold text-white rounded-xl disabled:opacity-60" style={{ background: "linear-gradient(135deg, #cf3339, #a3282d)" }} data-testid="demo-submit">
                  {state.kind === "sending" ? "Sending…" : "Request a demo"} <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>We use this only to reply to you. No newsletter.</p>
              </form>
            )}
          </div>
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
