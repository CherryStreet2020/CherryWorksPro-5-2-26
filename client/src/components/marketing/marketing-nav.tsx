import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, LayoutDashboard, ArrowRight } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";

const navLinks = [
  { label: "Product", href: "/features" },
  { label: "Tour", href: "/tour" },
  { label: "Client Support", href: "/client-support" },
  { label: "Pricing", href: "/pricing" },
  { label: "Compare", href: "/compare" },
  { label: "About", href: "/about" },
];

// The bar is 36px and the nav 64px: pages that clear them with pt-[100px] rely on both.
export function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(res => { setIsAuthenticated(res.ok); })
      .catch(() => { setIsAuthenticated(false); });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 overflow-hidden bg-[#15171C] transition-all duration-300"
        style={{ zIndex: "var(--z-sticky)", maxHeight: scrolled ? "0px" : "36px", opacity: scrolled ? 0 : 1 }}
        data-testid="announcement-bar"
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex h-9 items-center justify-center gap-2 text-[13px]">
            <span className="hidden text-white/70 sm:inline">Harvest renewal gone up?</span>
            <Link
              href="/switch-from-harvest"
              className="inline-flex items-center gap-1 font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
              data-testid="link-announcement"
            >
              Flat pricing, every user included <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>

      <nav
        className="fixed left-0 right-0 border-b backdrop-blur-md transition-all duration-300"
        style={{
          zIndex: "var(--z-sticky)",
          top: scrolled ? "0px" : "36px",
          background: scrolled ? "rgba(251,250,247,0.96)" : "rgba(251,250,247,0.88)",
          borderColor: scrolled ? "#E6E2DA" : "transparent",
        }}
        aria-label="Main"
        data-testid="marketing-nav"
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" aria-label="CherryWorks Pro home" data-testid="link-nav-home">
              <BrandLockup iconSize={30} textSize="base" tone="light" />
            </Link>

            <div className="hidden items-center gap-0.5 lg:flex">
              {navLinks.map((link) => {
                const active = location === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-md px-3 py-2 text-[14px] font-medium transition-colors ${active ? "text-[#15171C]" : "text-[#4A505C] hover:text-[#15171C]"}`}
                    data-testid={`link-nav-${link.href.slice(1)}`}
                  >
                    <span className={active ? "border-b-2 border-[#CF3339] pb-1" : ""}>{link.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              {isAuthenticated ? (
                <Link
                  href="/"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#CF3339] px-4 text-sm font-semibold text-white hover:bg-[#B32A30]"
                  data-testid="link-nav-dashboard"
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link href="/login" className="rounded-md px-3 py-2 text-[14px] font-medium text-[#4A505C] hover:text-[#15171C]" data-testid="link-nav-login">
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    className="inline-flex h-9 items-center rounded-lg bg-[#CF3339] px-4 text-sm font-semibold text-white hover:bg-[#B32A30]"
                    data-testid="link-nav-signup"
                  >
                    Start free trial
                  </Link>
                </>
              )}
            </div>

            <button
              type="button"
              className="-mr-2 rounded-md p-2 text-[#15171C] lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              data-testid="button-mobile-menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="space-y-1 border-t border-[#E6E2DA] bg-[#FBFAF7] px-5 py-4 lg:hidden">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-md px-3 py-2.5 text-[15px] font-medium ${location === link.href ? "bg-white text-[#15171C]" : "text-[#4A505C]"}`}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-[#E6E2DA] pt-4">
              {isAuthenticated ? (
                <Link href="/" onClick={() => setMobileOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#CF3339] text-sm font-semibold text-white">
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMobileOpen(false)} className="flex h-11 items-center justify-center rounded-lg border border-[#D9D4CB] bg-white text-sm font-semibold text-[#15171C]">
                    Log in
                  </Link>
                  <Link href="/signup" onClick={() => setMobileOpen(false)} className="flex h-11 items-center justify-center rounded-lg bg-[#CF3339] text-sm font-semibold text-white">
                    Start free trial
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
