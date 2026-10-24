import { useState } from "react";
import { SEO } from "@/components/seo";
import { Container, Display, Eyebrow, FORM, Lede, MarketingShell, PageHero, TextLink } from "@/components/marketing/kit";

const fieldBorder = (invalid: boolean) => (invalid ? FORM.invalid : FORM.border);
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

      <PageHero>
        <Container>
          <div className="grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-x-[72px] lg:gap-y-14">
            <div className="lg:col-start-1 lg:row-start-1">
              <Eyebrow>Contact</Eyebrow>
              <Display className="mt-4 lg:!text-[56px]">Questions before you start? Ask us.</Display>
              <Lede size="hero" className="mt-6">
                Your message goes to our team’s inbox, and we reply by email to the address you give.
              </Lede>
            </div>

            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-3">
              <div className="border-t border-[#15171C] pt-6">
                <h2 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">Send us a message</h2>
                {submitted ? (
                  <div className="mt-6 border-t border-[#E6E3DD] pt-6">
                    <p className="text-[17px] font-medium text-[#15171C]">Message sent!</p>
                    <p className="mt-1.5 text-[15.5px] leading-[1.55] text-[#5C606A]">
                      Thanks. We’ll reply to the email address you gave.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-5">
                    {error && (
                      <div role="alert" className={FORM.alert}>
                        {error}
                      </div>
                    )}
                    <div>
                      <label htmlFor="contact-name" className={FORM.label}>Name</label>
                      <input
                        id="contact-name"
                        type="text"
                        value={name}
                        onChange={(e) => { const v = e.target.value; setName(v); if (touched) setFieldErrors(validateWith(v, email, message)); }}
                        className={`${FORM.field} h-12 ${fieldBorder(Boolean(touched && fieldErrors.name))}`}
                        placeholder="Your name"
                        data-testid="input-contact-name"
                      />
                      {touched && fieldErrors.name && <p className={FORM.error} data-testid="error-contact-name">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-email" className={FORM.label}>Email</label>
                      <input
                        id="contact-email"
                        type="email"
                        value={email}
                        onChange={(e) => { const v = e.target.value; setEmail(v); if (touched) setFieldErrors(validateWith(name, v, message)); }}
                        className={`${FORM.field} h-12 ${fieldBorder(Boolean(touched && fieldErrors.email))}`}
                        placeholder="you@yourfirm.com"
                        data-testid="input-contact-email"
                      />
                      {touched && fieldErrors.email && <p className={FORM.error} data-testid="error-contact-email">{fieldErrors.email}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-message" className={FORM.label}>Message</label>
                      <textarea
                        id="contact-message"
                        value={message}
                        onChange={(e) => { const v = e.target.value; setMessage(v); if (touched) setFieldErrors(validateWith(name, email, v)); }}
                        rows={6}
                        maxLength={MAX_MESSAGE}
                        className={`${FORM.field} resize-y py-3 leading-relaxed ${fieldBorder(Boolean(touched && fieldErrors.message))}`}
                        placeholder="Tell us about your firm and what you’re looking for"
                        data-testid="input-contact-message"
                      />
                      {message.length > MAX_MESSAGE - 400 && (
                        <p className={FORM.count} data-testid="contact-message-count">
                          {message.length.toLocaleString("en-US")} of {MAX_MESSAGE.toLocaleString("en-US")} characters
                        </p>
                      )}
                      {touched && fieldErrors.message && <p className={FORM.error} data-testid="error-contact-message">{fieldErrors.message}</p>}
                    </div>
                    <button
                      onClick={handleSubmit}
                      disabled={loading}
                      className={FORM.submit}
                      data-testid="button-contact-submit"
                    >
                      {loading ? "Sending…" : "Send message"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-start-1 lg:row-start-2">
              <h2 className="text-[17px] font-medium text-[#15171C]">People write to us about</h2>
              <ul className="mt-4 border-t border-[#E6E3DD]">
                {topics.map((topic) => (
                  <li key={topic} className="border-b border-[#E6E3DD] py-3.5 text-[15.5px] leading-[1.55] text-[#5C606A]">{topic}</li>
                ))}
              </ul>

              <h2 className="mt-12 text-[17px] font-medium text-[#15171C]">Other ways in</h2>
              <ul className="mt-4 space-y-5">
                <li>
                  <TextLink href="/demo" className="text-[15.5px]">Book a 20-minute demo</TextLink>
                  <p className="mt-1.5 text-[15px] text-[#5C606A]">We walk through your own scenario on a call.</p>
                </li>
                <li>
                  <TextLink href="/tour" className="text-[15.5px]">Take the product tour</TextLink>
                  <p className="mt-1.5 text-[15px] text-[#5C606A]">See the product screen by screen, at your own pace.</p>
                </li>
                <li>
                  <TextLink href="/signup" className="text-[15.5px]">Start your 14-day trial</TextLink>
                  <p className="mt-1.5 text-[15px] text-[#5C606A]">You won’t be charged until day 15 · Cancel anytime</p>
                </li>
              </ul>
            </div>
          </div>
        </Container>
      </PageHero>
    </MarketingShell>
  );
}
