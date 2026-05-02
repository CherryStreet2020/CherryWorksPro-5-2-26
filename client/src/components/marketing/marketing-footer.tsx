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
    { label: "Tour", href: "/demo" },
    { label: "Features", href: "/features" },
    { label: "Marketing Hub", href: "/marketing" },
    { label: "Pricing", href: "/pricing" },
    { label: "Compare to Competitors", href: "/compare" },
    { label: "Switch from QuickBooks", href: "/switch-from-quickbooks" },
    { label: "Switch from FreshBooks", href: "/switch-from-freshbooks" },
    { label: "Switch from Xero", href: "/switch-from-xero" },
    { label: "Switch from Wave", href: "/switch-from-wave" },
    { label: "Switch from Harvest", href: "/switch-from-harvest" },
    { label: "Switch from BigTime", href: "/switch-from-bigtime" },
    { label: "Switch from Scoro", href: "/switch-from-scoro" },
    { label: "Switch from Paymo", href: "/switch-from-paymo" },
    { label: "Integrations", href: "/integrations" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Security", href: "/security" },
  ],
  Resources: [
    { label: "Log In", href: "/login" },
    { label: "Start Free Trial", href: "/signup" },
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
      <footer style={{ background: "var(--color-brand-900)", color: "rgba(255,255,255,0.7)" }}>
      <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-xl mx-auto text-center">
            <h3 className="text-lg font-bold text-white mb-2" data-testid="newsletter-heading">Get product updates and tips</h3>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.45)" }}>
              Join firm owners who get monthly insights on running a better services business.
            </p>
            {subscribed ? (
              <div className="rounded-xl py-3 px-6 inline-flex items-center gap-2" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }} data-testid="newsletter-success">
                <span className="text-sm font-medium" style={{ color: "#22c55e" }}>You're subscribed. Welcome aboard.</span>
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 justify-center">
                <div className="flex-1 max-w-xs">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                    placeholder="you@yourfirm.com"
                    className="px-4 py-3 rounded-xl text-sm text-white placeholder:text-white/30 outline-none w-full"
                    style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${emailError ? "#ef4444" : "rgba(255,255,255,0.1)"}` }}
                    data-testid="input-newsletter-email"
                  />
                  {emailError && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="text-newsletter-email-error">{emailError}</p>}
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-xl cursor-pointer transition-all hover:scale-[1.03] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
                  data-testid="button-newsletter-subscribe"
                >
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Subscribing...</> : <>Subscribe <ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div>
            <div className="mb-4">
              <BrandLockup iconSize={34} textSize="base" />
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              The professional services operating system. Track time, invoice clients, manage expenses, pay team members, and run your firm — all in one place.
            </p>
            {(SOCIAL_LINKEDIN_URL || SOCIAL_X_URL) && (
              <div className="flex items-center gap-3 mt-5">
                {SOCIAL_LINKEDIN_URL && (
                  <a href={SOCIAL_LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="link-social-linkedin" aria-label="LinkedIn">
                    <Linkedin className="w-4 h-4" style={{ color: "rgba(255,255,255,0.5)" }} />
                  </a>
                )}
                {SOCIAL_X_URL && (
                  <a href={SOCIAL_X_URL} target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="link-social-twitter" aria-label="X (Twitter)">
                    <Twitter className="w-4 h-4" style={{ color: "rgba(255,255,255,0.5)" }} />
                  </a>
                )}
              </div>
            )}
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white mb-4">{category}</h3>
              <ul className="space-y-2.5">
                {links.map((link, idx) => (
                  <li key={`${category}-${idx}`}>
                    <Link href={link.href}>
                      <span className="text-sm cursor-pointer transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.5)" }}>
                        {link.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
              &copy; {new Date().getFullYear()} CherryWorks Pro. All rights reserved.
            </p>
            <p className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.3)" }} data-testid="tagline-nyc">
              Built with <Heart className="w-3 h-3 fill-current" style={{ color: "#cf3339" }} /> in New York City
            </p>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy">
              <span className="text-xs cursor-pointer transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.35)" }}>Privacy Policy</span>
            </Link>
            <Link href="/terms">
              <span className="text-xs cursor-pointer transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.35)" }}>Terms of Service</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
    <MarketingChatBubble />
    </>
  );
}
