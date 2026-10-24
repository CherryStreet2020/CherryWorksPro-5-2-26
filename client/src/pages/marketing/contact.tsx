import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, Lede, MarketingShell, PageHero, TextLink } from "@/components/marketing/kit";

const LABEL = "block text-sm font-medium text-[#15171C]";
const FIELD =
  "mt-2 block w-full rounded-lg border bg-white px-4 text-[15px] text-[#15171C] placeholder:text-[#8A909A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CF3339]/25";
const fieldBorder = (invalid: boolean) =>
  invalid ? "border-[#C2272D] focus:border-[#C2272D]" : "border-[#D9D4CB] hover:border-[#B9B3A8] focus:border-[#CF3339]";
const FIELD_ERROR = "mt-1.5 text-sm text-[#B42318]";
// The server rejects longer messages; the counter shows once the limit is close.
const MAX_MESSAGE = 4000;

const topics = [
  "Moving from another tool, and what comes across",
  "Which plan fits your firm",
  "Enterprise plans and larger teams",
  "Security or compliance questions, or a questionnaire to fill in",
  "Partnerships",
];

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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "We could not send your message. Email info@cherrystconsulting.com instead.");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "We could not send your message. Email info@cherrystconsulting.com instead.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <MarketingShell>
      <SEO path="/contact" />

      <PageHero className="!pb-24 md:!pb-32">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-x-16 lg:gap-y-14">
            <div className="lg:col-start-1 lg:row-start-1">
              <Eyebrow>Contact</Eyebrow>
              <Display className="mt-5 md:!text-[3.5rem]">Questions before you start? Ask us.</Display>
              <Lede className="mt-6">
                Your message goes to our team’s inbox, and we reply by email to the address you give.
              </Lede>
            </div>

            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-2">
              <div className="rounded-xl border border-[#E6E2DA] bg-white p-6 shadow-[0_1px_2px_rgba(16,20,27,0.04)] sm:p-8">
                <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-[#15171C]">Send us a message</h2>
                {submitted ? (
                  <div className="mt-6 rounded-lg border border-[#E6E2DA] bg-[#FBFAF7] p-6">
                    <CheckCircle className="h-6 w-6 text-[#2F7D4F]" aria-hidden="true" />
                    <p className="mt-3 text-lg font-semibold text-[#15171C]">Message sent!</p>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D4350]">
                      Thanks. We’ll reply to the email address you gave.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    {error && (
                      <div role="alert" className="rounded-lg border border-[#F3C7C4] bg-[#FDF3F2] px-4 py-3 text-sm text-[#B42318]">
                        {error}
                      </div>
                    )}
                    <div>
                      <label htmlFor="contact-name" className={LABEL}>Name</label>
                      <input
                        id="contact-name"
                        type="text"
                        value={name}
                        onChange={(e) => { const v = e.target.value; setName(v); if (touched) setFieldErrors(validateWith(v, email, message)); }}
                        className={`${FIELD} h-12 ${fieldBorder(Boolean(touched && fieldErrors.name))}`}
                        placeholder="Your name"
                        data-testid="input-contact-name"
                      />
                      {touched && fieldErrors.name && <p className={FIELD_ERROR} data-testid="error-contact-name">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-email" className={LABEL}>Email</label>
                      <input
                        id="contact-email"
                        type="email"
                        value={email}
                        onChange={(e) => { const v = e.target.value; setEmail(v); if (touched) setFieldErrors(validateWith(name, v, message)); }}
                        className={`${FIELD} h-12 ${fieldBorder(Boolean(touched && fieldErrors.email))}`}
                        placeholder="you@yourfirm.com"
                        data-testid="input-contact-email"
                      />
                      {touched && fieldErrors.email && <p className={FIELD_ERROR} data-testid="error-contact-email">{fieldErrors.email}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-message" className={LABEL}>Message</label>
                      <textarea
                        id="contact-message"
                        value={message}
                        onChange={(e) => { const v = e.target.value; setMessage(v); if (touched) setFieldErrors(validateWith(name, email, v)); }}
                        rows={6}
                        maxLength={MAX_MESSAGE}
                        className={`${FIELD} resize-y py-3 leading-relaxed ${fieldBorder(Boolean(touched && fieldErrors.message))}`}
                        placeholder="Tell us about your firm and what you’re looking for"
                        data-testid="input-contact-message"
                      />
                      {message.length > MAX_MESSAGE - 400 && (
                        <p className="mt-1.5 text-xs text-[#5F6672]" data-testid="contact-message-count">
                          {message.length.toLocaleString("en-US")} of {MAX_MESSAGE.toLocaleString("en-US")} characters
                        </p>
                      )}
                      {touched && fieldErrors.message && <p className={FIELD_ERROR} data-testid="error-contact-message">{fieldErrors.message}</p>}
                    </div>
                    <button
                      onClick={handleSubmit}
                      disabled={loading}
                      className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#CF3339] px-6 text-[15px] font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.08)] transition-colors hover:bg-[#B32A30] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="button-contact-submit"
                    >
                      {loading ? "Sending…" : "Send message"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-start-1 lg:row-start-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#5F6672]">People write to us about</h2>
              <ul className="mt-4 divide-y divide-[#E6E2DA] border-y border-[#E6E2DA]">
                {topics.map((topic) => (
                  <li key={topic} className="py-3.5 text-base leading-relaxed text-[#15171C]">{topic}</li>
                ))}
              </ul>

              <h2 className="mt-12 text-sm font-semibold uppercase tracking-[0.14em] text-[#5F6672]">Other ways in</h2>
              <ul className="mt-4 space-y-4">
                <li>
                  <TextLink href="/demo">Book a 20-minute demo</TextLink>
                  <p className="mt-1 text-[15px] text-[#5F6672]">We walk through your own scenario on a call.</p>
                </li>
                <li>
                  <TextLink href="/tour">Take the product tour</TextLink>
                  <p className="mt-1 text-[15px] text-[#5F6672]">See the product screen by screen, at your own pace.</p>
                </li>
                <li>
                  <TextLink href="/signup">Start your 14-day trial</TextLink>
                  <p className="mt-1 text-[15px] text-[#5F6672]">You won’t be charged until day 15 · Cancel anytime</p>
                </li>
              </ul>
            </div>
          </div>
        </Container>
      </PageHero>
    </MarketingShell>
  );
}
