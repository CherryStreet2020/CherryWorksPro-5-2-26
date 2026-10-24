import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";

const navLinks = [
  { label: "Product", href: "/features" },
  { label: "Marketing Hub", href: "/marketing" },
  { label: "Support desk", href: "/client-support" },
  { label: "Pricing", href: "/pricing" },
];

const pill =
  "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-[#15171C] px-[18px] text-[15px] font-medium text-white transition-colors hover:bg-[#2A2D35] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C]";

// Sticky and in the page flow, so pages need no top padding to clear it.
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
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 border-b bg-[#FBFAF8]/95 backdrop-blur-md transition-colors ${scrolled || mobileOpen ? "border-[#E6E3DD]" : "border-transparent"}`}
      style={{ zIndex: "var(--z-sticky)" }}
      aria-label="Main"
      data-testid="marketing-nav"
    >
      <div className="mx-auto max-w-[1200px] px-5 md:px-8">
        <div className="flex h-16 items-center justify-between gap-4 md:h-[76px]">
          <Link href="/" aria-label="CherryWorks Pro home" data-testid="link-nav-home">
            <BrandLockup iconSize={28} textSize="lg" tone="light" />
          </Link>

          <div className="flex items-center gap-[30px]">
            {navLinks.map((link) => {
              const active = location === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`hidden text-[15px] transition-colors lg:inline ${active ? "text-[#15171C]" : "text-[#5C606A] hover:text-[#15171C]"}`}
                  data-testid={`link-nav-${link.href.slice(1)}`}
                >
                  {link.label}
                </Link>
              );
            })}
            {isAuthenticated ? (
              <Link href="/" className={pill} data-testid="link-nav-dashboard">Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="hidden text-[15px] text-[#5C606A] transition-colors hover:text-[#15171C] lg:inline" data-testid="link-nav-login">
                  Log in
                </Link>
                <Link href="/signup" className={pill} data-testid="link-nav-signup">Start your trial</Link>
              </>
            )}
            <button
              type="button"
              className="-ml-4 -mr-2 rounded-md p-2 text-[#15171C] lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              data-testid="button-mobile-menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="mx-auto max-w-[1200px] px-5 pb-6 pt-2 md:px-8 lg:hidden">
          {[...navLinks, { label: "Tour", href: "/tour" }, { label: "About", href: "/about" }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              aria-current={location === link.href ? "page" : undefined}
              className={`block border-b border-[#E6E3DD] py-3.5 text-[17px] ${location === link.href ? "text-[#15171C]" : "text-[#5C606A]"}`}
            >
              {link.label}
            </Link>
          ))}
          {!isAuthenticated && (
            <Link href="/login" onClick={() => setMobileOpen(false)} className="block py-3.5 text-[17px] text-[#5C606A]">
              Log in
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
