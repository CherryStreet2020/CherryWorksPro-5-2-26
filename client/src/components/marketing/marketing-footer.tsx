import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Heart, Linkedin, Twitter, Loader2 } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useToast } from "@/hooks/use-toast";
import { MarketingChatBubble } from "@/components/marketing/marketing-chat-bubble";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SOCIAL_LINKEDIN_URL = import.meta.env.VITE_SOCIAL_LINKEDIN_URL || "";
const SOCIAL_X_URL = import.meta.env.VITE_SOCIAL_X_URL || "";
const ZAPIER_APP_URL = import.meta.env.VITE_ZAPIER_APP_URL || "https://zapier.com";

const footerLinks = {
  Product: [
    { label: "Features", href: "/features" },
    { label: "Product tour", href: "/tour" },
    { label: "Client Support", href: "/client-support" },
    { label: "Pricing", href: "/pricing" },
    { label: "Marketing Hub", href: "/marketing" },
    { label: "Integrations", href: "/integrations" },
    { label: "Security", href: "/security" },
  ],
  "Switch to us": [
    { label: "Compare", href: "/compare" },
    { label: "From QuickBooks", href: "/switch-from-quickbooks" },
    { label: "From FreshBooks", href: "/switch-from-freshbooks" },
    { label: "From Harvest", href: "/switch-from-harvest" },
    { label: "From Xero", href: "/switch-from-xero" },
    { label: "From Wave", href: "/switch-from-wave" },
    { label: "From BigTime", href: "/switch-from-bigtime" },
    { label: "From Scoro", href: "/switch-from-scoro" },
    { label: "From Paymo", href: "/switch-from-paymo" },
    { label: "From Jira", href: "/switch-from-jira-service-management" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Book a demo", href: "/demo" },
    { label: "Log in", href: "/login" },
    { label: "Start free trial", href: "/signup" },
  ],
};

export function MarketingFooter() {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const { toast } = useToast();

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    if (!EMAIL_REGEX.test(email.trim())) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError("");

    setSubmitting(true);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to subscribe");
      }

      setSubscribed(true);
      setEmail("");
      toast({
        title: "You're subscribed!",
        description: "Welcome aboard — look out for monthly insights in your inbox.",
      });
    } catch (err: any) {
      toast({
        title: "Subscription failed",
        description: err.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <footer className="border-t border-white/10 bg-[#10141B] text-white/60">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid gap-12 border-b border-white/10 py-16 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <BrandLockup iconSize={32} textSize="base" />
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/60">
                Time, billing, books, payouts and client support for services firms, in one system.
              </p>
              <div className="mt-10 max-w-md">
                <h2 className="text-sm font-semibold text-white" data-testid="newsletter-heading">Product updates, about once a month</h2>
                <p className="mt-1.5 text-sm text-white/50">New features and practical notes on running a services firm.</p>
                {subscribed ? (
                  <p className="mt-4 text-sm font-medium text-emerald-300" data-testid="newsletter-success">You&rsquo;re subscribed. Welcome aboard.</p>
                ) : (
                  <form onSubmit={handleSubscribe} className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      <label htmlFor="footer-newsletter-email" className="sr-only">Email address</label>
                      <input
                        id="footer-newsletter-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                        placeholder="you@yourfirm.com"
                        aria-invalid={emailError ? true : undefined}
                        aria-describedby={emailError ? "footer-newsletter-error" : undefined}
                        className={`h-11 w-full rounded-lg border bg-white/5 px-4 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/50 ${emailError ? "border-red-400" : "border-white/15"}`}
                        data-testid="input-newsletter-email"
                      />
                      {emailError && <p id="footer-newsletter-error" className="mt-1.5 text-xs text-red-300" data-testid="text-newsletter-email-error">{emailError}</p>}
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#15171C] transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="button-newsletter-subscribe"
                    >
                      {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Subscribing…</> : <>Subscribe <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
                    </button>
                  </form>
                )}
              </div>
              {(SOCIAL_LINKEDIN_URL || SOCIAL_X_URL) && (
                <div className="mt-8 flex items-center gap-2">
                  {SOCIAL_LINKEDIN_URL && (
                    <a href={SOCIAL_LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:border-white/40 hover:text-white" data-testid="link-social-linkedin" aria-label="LinkedIn">
                      <Linkedin className="h-4 w-4" />
                    </a>
                  )}
                  {SOCIAL_X_URL && (
                    <a href={SOCIAL_X_URL} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:border-white/40 hover:text-white" data-testid="link-social-twitter" aria-label="X (Twitter)">
                      <Twitter className="h-4 w-4" />
                    </a>
                  )}
                </div>
              )}
            </div>

            <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-7">
              {Object.entries(footerLinks).map(([category, links]) => (
                <div key={category}>
                  <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white/90">{category}</h2>
                  <ul className="mt-4 space-y-2.5">
                    {links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="text-sm text-white/55 transition-colors hover:text-white">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <div className="flex flex-col gap-4 py-8 text-[13px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
              <p>&copy; {new Date().getFullYear()} CherryWorks Pro</p>
              <p className="flex items-center gap-1" data-testid="tagline-nyc">
                Built with <Heart className="h-3 w-3 fill-current text-[#CF3339]" aria-label="love" /> in New York City
              </p>
            </div>
            <div className="flex items-center gap-5">
              <Link href="/privacy" className="transition-colors hover:text-white">Privacy Policy</Link>
              <Link href="/terms" className="transition-colors hover:text-white">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
      <MarketingChatBubble />
    </>
  );
}
