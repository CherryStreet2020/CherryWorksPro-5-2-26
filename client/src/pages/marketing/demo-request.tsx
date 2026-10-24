import { useState } from "react";
import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, FORM, Lede, MarketingShell, PageHero, TextLink } from "@/components/marketing/kit";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

// The server rejects longer messages; the counter shows once the limit is close.
const MAX_MESSAGE = 4000;

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

  const field = `${FORM.field} ${FORM.border}`;

  return (
    <MarketingShell>
      <SEO path="/demo" />

      <PageHero>
        <Container>
          <div className="grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-[72px] lg:gap-y-12">
            <div className="lg:col-start-1 lg:row-start-1">
              <Eyebrow>Book a demo</Eyebrow>
              <Display testId="demo-h1" className="mt-4 lg:!text-[56px]">Twenty minutes, your scenario, no slides.</Display>
              <Lede size="hero" className="mt-6">
                Tell us how your firm wins work, bills and gets paid today. We’ll walk the same flow in CherryWorks Pro on a screen
                share, from a prospect or a client email to the invoice, the payout and the books.
              </Lede>
            </div>

            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-3">
              <div className="border-t border-[#15171C] pt-6">
                {state.kind === "sent" ? (
                  <div data-testid="demo-sent">
                    <h2 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">Request received</h2>
                    <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">
                      Thanks. We’ll reply by email to set up a time.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={submit} className="space-y-5" data-testid="demo-form">
                    <h2 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">Request a demo</h2>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="demo-name" className={FORM.label}>Name</label>
                        <input id="demo-name" required className={`${field} h-12`} placeholder="Your name" value={form.name} onChange={set("name")} data-testid="demo-name" />
                      </div>
                      <div>
                        <label htmlFor="demo-email" className={FORM.label}>Work email</label>
                        <input id="demo-email" required type="email" className={`${field} h-12`} placeholder="you@yourfirm.com" value={form.email} onChange={set("email")} data-testid="demo-email" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="demo-company" className={FORM.label}>Firm</label>
                        <input id="demo-company" required className={`${field} h-12`} placeholder="Firm name" value={form.company} onChange={set("company")} data-testid="demo-company" />
                      </div>
                      <div>
                        <label htmlFor="demo-team-size" className={FORM.label}>Team size <span className={FORM.optional}>(optional)</span></label>
                        <select id="demo-team-size" className={`${field} h-12`} value={form.teamSize} onChange={set("teamSize")} data-testid="demo-team-size">
                          <option value="">Select a range</option>
                          <option value="1-5">1–5</option><option value="6-15">6–15</option><option value="16-50">16–50</option><option value="51+">51+</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="demo-message" className={FORM.label}>Your setup today <span className={FORM.optional}>(optional)</span></label>
                      <textarea id="demo-message" className={`${field} resize-y py-3 leading-relaxed`} rows={4} maxLength={MAX_MESSAGE} placeholder="What do you use today, and what is not working?" value={form.message} onChange={set("message")} data-testid="demo-message" />
                      {form.message.length > MAX_MESSAGE - 400 && (
                        <p className={FORM.count} data-testid="demo-message-count">
                          {form.message.length.toLocaleString("en-US")} of {MAX_MESSAGE.toLocaleString("en-US")} characters
                        </p>
                      )}
                    </div>
                    {state.kind === "error" && (
                      <p role="alert" className={FORM.alert} data-testid="demo-error">
                        {state.message}
                      </p>
                    )}
                    <button type="submit" disabled={state.kind === "sending"} className={FORM.submit} data-testid="demo-submit">
                      {state.kind === "sending" ? "Sending…" : "Request a demo"}
                    </button>
                    <p className="text-[14px] text-[#6E727B]">We use this only to reply to you. No newsletter.</p>
                  </form>
                )}
              </div>
            </div>

            <div className="lg:col-start-1 lg:row-start-2">
              <ul className="border-t border-[#E6E3DD]">
                <li className="border-b border-[#E6E3DD] py-4 text-[15.5px] leading-[1.55] text-[#5C606A]">
                  Your request goes straight into our own Marketing Hub, the same one Business plan firms use.
                </li>
                <li className="border-b border-[#E6E3DD] py-4 text-[15.5px] leading-[1.55] text-[#5C606A]">
                  Prefer to look around first? The self-guided tour shows the product screen by screen.
                </li>
                <li className="border-b border-[#E6E3DD] py-4 text-[15.5px] leading-[1.55] text-[#5C606A]">
                  Already decided? Start the 14-day trial. You won’t be charged until day 15.
                </li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[15.5px]">
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
