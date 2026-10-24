import { useState } from "react";
import { Link } from "wouter";
import { Linkedin, Twitter, Loader2 } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useToast } from "@/hooks/use-toast";
import { MarketingChatBubble } from "@/components/marketing/marketing-chat-bubble";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SOCIAL_LINKEDIN_URL = import.meta.env.VITE_SOCIAL_LINKEDIN_URL || "";
const SOCIAL_X_URL = import.meta.env.VITE_SOCIAL_X_URL || "";

const footerLinks = {
  Product: [
    { label: "Product", href: "/features" },
    { label: "Product tour", href: "/tour" },
    { label: "Marketing Hub", href: "/marketing" },
    { label: "Support desk", href: "/client-support" },
    { label: "Pricing", href: "/pricing" },
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
    { label: "Start your trial", href: "/signup" },
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
      <footer className="border-t border-[#E6E3DD] bg-[#FBFAF8] text-[14px] text-[#6E727B]">
        <div className="mx-auto max-w-[1200px] px-5 md:px-8">
          <div className="grid gap-12 py-14 md:py-16 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <BrandLockup iconSize={26} textSize="base" tone="light" />
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#5C606A]">
                Marketing, support, time, billing, books and payouts for services firms, in one system.
              </p>
              <div className="mt-10 max-w-md">
                <h2 className="text-[15px] font-medium text-[#15171C]" data-testid="newsletter-heading">Product updates, about once a month</h2>
                <p className="mt-1 text-[14px] text-[#6E727B]">New features and practical notes on running a services firm.</p>
                {subscribed ? (
                  <p className="mt-4 text-[14px] font-medium text-[#15171C]" data-testid="newsletter-success">You&rsquo;re subscribed. Welcome aboard.</p>
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
                        className={`h-11 w-full rounded-full border bg-white px-5 text-[15px] text-[#15171C] placeholder:text-[#8A8E97] outline-none focus:border-[#15171C] ${emailError ? "border-[#CF3339]" : "border-[#D5D2CB]"}`}
                        data-testid="input-newsletter-email"
                      />
                      {emailError && <p id="footer-newsletter-error" className="mt-1.5 pl-5 text-[13px] text-[#B42318]" data-testid="text-newsletter-email-error">{emailError}</p>}
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#D5D2CB] bg-white px-[22px] text-[15px] font-medium text-[#15171C] transition-colors hover:border-[#15171C] disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="button-newsletter-subscribe"
                    >
                      {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Subscribing…</> : "Subscribe"}
                    </button>
                  </form>
                )}
              </div>
              {(SOCIAL_LINKEDIN_URL || SOCIAL_X_URL) && (
                <div className="mt-8 flex items-center gap-2">
                  {SOCIAL_LINKEDIN_URL && (
                    <a href={SOCIAL_LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E6E3DD] text-[#5C606A] transition-colors hover:border-[#15171C] hover:text-[#15171C]" data-testid="link-social-linkedin" aria-label="LinkedIn">
                      <Linkedin className="h-4 w-4" />
                    </a>
                  )}
                  {SOCIAL_X_URL && (
                    <a href={SOCIAL_X_URL} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E6E3DD] text-[#5C606A] transition-colors hover:border-[#15171C] hover:text-[#15171C]" data-testid="link-social-twitter" aria-label="X (Twitter)">
                      <Twitter className="h-4 w-4" />
                    </a>
                  )}
                </div>
              )}
            </div>

            <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-7">
              {Object.entries(footerLinks).map(([category, links]) => (
                <div key={category}>
                  <h2 className="text-[14px] font-medium text-[#15171C]">{category}</h2>
                  <ul className="mt-4 space-y-2.5">
                    {links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="text-[14px] text-[#5C606A] transition-colors hover:text-[#15171C]">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#E6E3DD] pb-14 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {new Date().getFullYear()} CherryWorks Pro</p>
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="transition-colors hover:text-[#15171C]">Privacy</Link>
              <Link href="/terms" className="transition-colors hover:text-[#15171C]">Terms</Link>
              <Link href="/security" className="transition-colors hover:text-[#15171C]">Security</Link>
            </div>
          </div>
        </div>
      </footer>
      <MarketingChatBubble />
    </>
  );
}
