import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle, Bot, Zap, Clock, BookOpen, MessageCircle, HelpCircle } from "lucide-react";
import { SEO } from "@/components/seo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [touched, setTouched] = useState(false);

  const validateWith = (n: string, e: string, m: string) => {
    const errors: { name?: string; email?: string; message?: string } = {};
    if (!n.trim()) errors.name = "Name is required";
    if (!e.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) errors.email = "Please enter a valid email address";
    if (!m.trim()) errors.message = "Message is required";
    return errors;
  };

  const handleSubmit = async () => {
    setTouched(true);
    const errors = validateWith(name, email, message);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to send message");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#0a0f1c" }}>
      <MarketingNav />
      <SEO
        title="Support & Contact"
        fullTitle="Support & Contact — CherryAssist AI + Direct Support | CherryWorks Pro"
        description="Get help from CherryAssist AI 24/7 or reach our team directly. We respond within hours, not days."
        path="/contact"
      />

      <section className="pt-[100px] pb-8 md:pb-10" style={{ background: "var(--gradient-hero)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-8 md:pt-12 md:pb-10">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[3px] mb-4" style={{ color: "#cf3339" }}>Support</p>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight leading-[1.1]">
              Help when you need it.{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Instantly.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Get instant answers from CherryAssist, our AI support agent — or send a message to our team for anything that needs a human touch.
            </p>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12" style={{ background: "#0a0f1c" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(207,51,57,0.12)" }}>
                  <Bot className="w-6 h-6" style={{ color: "#cf3339" }} />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">CherryAssist</p>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>AI-Powered Support</p>
                </div>
              </div>
              <h2 className="text-2xl md:text-4xl font-bold text-white mb-5 leading-tight">
                Your first line of support — available 24/7
              </h2>
              <p className="text-base md:text-lg leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.55)" }}>
                CherryAssist is trained on every feature, workflow, and report in CherryWorks Pro. Ask it anything — from setting up your first client to understanding your AR aging report. It responds instantly, around the clock.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Zap, title: "Instant answers", desc: "No waiting for tickets. No email queues. Ask and get an answer in seconds." },
                  { icon: Clock, title: "Available 24/7", desc: "Nights, weekends, holidays. CherryAssist never sleeps." },
                  { icon: BookOpen, title: "Knows everything", desc: "Trained on every feature, report, workflow, and integration in the platform." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(207,51,57,0.08)" }}>
                      <item.icon className="w-4 h-4" style={{ color: "#cf3339" }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{item.title}</p>
                      <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: "#0b1222", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 25px 80px rgba(0,0,0,0.5)" }}>
              <div className="px-5 py-3 flex items-center gap-3" style={{ background: "#070d18", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(207,51,57,0.15)" }}>
                  <Bot className="w-4 h-4" style={{ color: "#cf3339" }} />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-white">CherryAssist</p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>Online · Instant response</p>
                  </div>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.12)" }}>
                    <Bot className="w-3.5 h-3.5" style={{ color: "#cf3339" }} />
                  </div>
                  <div className="rounded-xl rounded-tl-sm px-4 py-3 max-w-[85%]" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                      Hi! I'm CherryAssist. I can help you with anything about CherryWorks Pro — features, setup, invoicing, reports, or troubleshooting. What can I help you with?
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <div className="rounded-xl rounded-tr-sm px-4 py-3 max-w-[85%]" style={{ background: "rgba(207,51,57,0.12)" }}>
                    <p className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>
                      How do I generate an invoice from approved timesheets?
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(207,51,57,0.12)" }}>
                    <Bot className="w-3.5 h-3.5" style={{ color: "#cf3339" }} />
                  </div>
                  <div className="rounded-xl rounded-tl-sm px-4 py-3 max-w-[85%]" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                      Great question! Go to <span className="font-semibold text-white">Invoices → New Invoice</span>, select a client, and click <span className="font-semibold text-white">"Pull Unbilled Time."</span> CherryWorks Pro will automatically pull all approved billable hours and create line items for each team member. You can then add discounts, tax, and send it with one click.
                    </p>
                  </div>
                </div>
                <div className="mt-2 rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[13px] flex-1" style={{ color: "rgba(255,255,255,0.25)" }}>Ask CherryAssist anything...</p>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(207,51,57,0.15)" }}>
                    <ArrowRight className="w-3.5 h-3.5" style={{ color: "#cf3339" }} />
                  </div>
                </div>
              </div>
              <div className="px-5 py-2.5 text-center" style={{ background: "#070d18", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>Available inside every CherryWorks Pro account</p>
              </div>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="text-sm mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>Already have an account? Access CherryAssist from the <HelpCircle className="w-4 h-4 inline" style={{ color: "#cf3339" }} /> button inside the app.</p>
          </div>
        </div>
      </section>

      <section className="py-10 md:py-14" style={{ background: "linear-gradient(180deg, #0f172a 0%, #0a0f1c 100%)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
                  <MessageCircle className="w-6 h-6" style={{ color: "#3b82f6" }} />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">Talk to Our Team</p>
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>For humans-only questions</p>
                </div>
              </div>
              <p className="text-base leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.55)" }}>
                Need a live demo? Have questions about Enterprise plans? Want to discuss a custom integration or volume pricing? Our team is here for the things that need a real conversation.
              </p>
              <div className="space-y-4">
                {[
                  "Enterprise plan inquiries and custom pricing",
                  "Live product demonstrations",
                  "Data migration assistance",
                  "Partnership and integration requests",
                  "Security and compliance questions",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
                    <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-10 p-6 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="text-sm font-bold mb-2 text-white">Prefer to try it yourself?</h3>
                <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.45)" }}>
                  Start a free 14-day trial. Full access to every feature. Cancel anytime.
                </p>
                <Link href="/signup">
                  <span className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-lg cursor-pointer transition-all hover:scale-[1.02]" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>
                    Start Free Trial <ArrowRight className="w-4 h-4" />
                  </span>
                </Link>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold mb-6 text-white">Send us a message</h2>
              {submitted ? (
                <div className="rounded-xl p-8 text-center" style={{ background: "rgba(207,51,57,0.08)", border: "1px solid rgba(207,51,57,0.2)" }}>
                  <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#cf3339" }} />
                  <p className="text-lg font-bold text-white">Message sent!</p>
                  <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>Our team will be in touch shortly.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {error && (
                    <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                      {error}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-white">Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => { const v = e.target.value; setName(v); if (touched) setFieldErrors(validateWith(v, email, message)); }}
                      className="w-full px-4 py-3 text-sm rounded-xl"
                      style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${touched && fieldErrors.name ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.1)"}`, color: "#ffffff" }}
                      placeholder="Your name"
                      data-testid="input-contact-name"
                    />
                    {touched && fieldErrors.name && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="error-contact-name">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-white">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { const v = e.target.value; setEmail(v); if (touched) setFieldErrors(validateWith(name, v, message)); }}
                      className="w-full px-4 py-3 text-sm rounded-xl"
                      style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${touched && fieldErrors.email ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.1)"}`, color: "#ffffff" }}
                      placeholder="you@yourfirm.com"
                      data-testid="input-contact-email"
                    />
                    {touched && fieldErrors.email && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="error-contact-email">{fieldErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-white">Message</label>
                    <textarea
                      value={message}
                      onChange={(e) => { const v = e.target.value; setMessage(v); if (touched) setFieldErrors(validateWith(name, email, v)); }}
                      rows={5}
                      className="w-full px-4 py-3 text-sm rounded-xl resize-none"
                      style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${touched && fieldErrors.message ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.1)"}`, color: "#ffffff" }}
                      placeholder="Tell us about your firm and what you're looking for..."
                      data-testid="input-contact-message"
                    />
                    {touched && fieldErrors.message && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="error-contact-message">{fieldErrors.message}</p>}
                  </div>
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="w-full px-4 py-3.5 text-sm font-bold text-white rounded-xl transition-all hover:opacity-90 disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
                    data-testid="button-contact-submit"
                  >
                    {loading ? "Sending..." : "Send Message"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
