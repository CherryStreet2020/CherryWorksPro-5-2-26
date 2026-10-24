import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, Lede, MarketingShell, PageHero, TextLink } from "@/components/marketing/kit";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

const LABEL = "block text-sm font-medium text-[#15171C]";
const OPTIONAL = "font-normal text-[#5F6672]";

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

  const field =
    "mt-2 block w-full rounded-lg border border-[#D9D4CB] bg-white px-4 text-[15px] text-[#15171C] placeholder:text-[#8A909A] transition-colors hover:border-[#B9B3A8] focus:border-[#CF3339] focus:outline-none focus:ring-2 focus:ring-[#CF3339]/25";

  return (
    <MarketingShell>
      <SEO path="/demo" />

      <PageHero className="!pb-24 md:!pb-32">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-x-16 lg:gap-y-10">
            <div className="lg:col-start-1 lg:row-start-1">
              <Eyebrow>Book a demo</Eyebrow>
              <Display testId="demo-h1" className="mt-5 md:!text-[3.5rem]">Twenty minutes, your scenario, no slides</Display>
              <Lede className="mt-6">
                Tell us how your firm bills and where the time goes today. We’ll walk the same flow in CherryWorks Pro, from a
                client email to the invoice, the ledger and the payout, on a screen share.
              </Lede>
            </div>

            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-2">
              <div className="rounded-xl border border-[#E6E2DA] bg-white p-6 shadow-[0_1px_2px_rgba(16,20,27,0.04)] sm:p-8">
                {state.kind === "sent" ? (
                  <div className="py-6" data-testid="demo-sent">
                    <CheckCircle className="h-6 w-6 text-[#2F7D4F]" aria-hidden="true" />
                    <h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.01em] text-[#15171C]">Request received</h2>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                      Thanks. We’ll reply by email to set up a time.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={submit} className="space-y-5" data-testid="demo-form">
                    <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-[#15171C]">Request a demo</h2>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="demo-name" className={LABEL}>Name</label>
                        <input id="demo-name" required className={`${field} h-12`} placeholder="Your name" value={form.name} onChange={set("name")} data-testid="demo-name" />
                      </div>
                      <div>
                        <label htmlFor="demo-email" className={LABEL}>Work email</label>
                        <input id="demo-email" required type="email" className={`${field} h-12`} placeholder="you@yourfirm.com" value={form.email} onChange={set("email")} data-testid="demo-email" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="demo-company" className={LABEL}>Firm</label>
                        <input id="demo-company" required className={`${field} h-12`} placeholder="Firm name" value={form.company} onChange={set("company")} data-testid="demo-company" />
                      </div>
                      <div>
                        <label htmlFor="demo-team-size" className={LABEL}>Team size <span className={OPTIONAL}>(optional)</span></label>
                        <select id="demo-team-size" className={`${field} h-12`} value={form.teamSize} onChange={set("teamSize")} data-testid="demo-team-size">
                          <option value="">Select a range</option>
                          <option value="1-5">1–5</option><option value="6-15">6–15</option><option value="16-50">16–50</option><option value="51+">51+</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="demo-message" className={LABEL}>Your setup today <span className={OPTIONAL}>(optional)</span></label>
                      <textarea id="demo-message" className={`${field} resize-y py-3 leading-relaxed`} rows={4} placeholder="What do you use today, and what is not working?" value={form.message} onChange={set("message")} data-testid="demo-message" />
                    </div>
                    {state.kind === "error" && (
                      <p role="alert" className="rounded-lg border border-[#F3C7C4] bg-[#FDF3F2] px-4 py-3 text-sm text-[#B42318]" data-testid="demo-error">
                        {state.message}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={state.kind === "sending"}
                      className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#CF3339] px-6 text-[15px] font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.08)] transition-colors hover:bg-[#B32A30] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="demo-submit"
                    >
                      {state.kind === "sending" ? "Sending…" : "Request a demo"}
                    </button>
                    <p className="text-sm text-[#5F6672]">We use this only to reply to you. No newsletter.</p>
                  </form>
                )}
              </div>
            </div>

            <div className="lg:col-start-1 lg:row-start-2">
              <ul className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA]">
                <li className="py-4 text-base leading-relaxed text-[#3D4350]">
                  Your request goes straight into our own Marketing Hub, the same one Business plan firms use.
                </li>
                <li className="py-4 text-base leading-relaxed text-[#3D4350]">
                  Prefer to look around first? The self-guided tour shows the product screen by screen.
                </li>
                <li className="py-4 text-base leading-relaxed text-[#3D4350]">
                  Already decided? Start the 14-day trial. You won’t be charged until day 15.
                </li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
                <TextLink href="/tour">Take the tour</TextLink>
                <TextLink href="/signup">Start your trial</TextLink>
              </div>
            </div>
          </div>
        </Container>
      </PageHero>
    </MarketingShell>
  );
}
