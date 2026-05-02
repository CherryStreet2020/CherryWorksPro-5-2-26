import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, LayoutDashboard, ArrowRight } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";

const navLinks = [
  { label: "Features", href: "/features" },
  { label: "Tour", href: "/demo" },
  { label: "Compare", href: "/compare" },
  { label: "Pricing", href: "/pricing" },
  { label: "Marketing", href: "/marketing" },
  { label: "Integrations", href: "/integrations" },
  { label: "About", href: "/about" },
];

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
        className="fixed top-0 left-0 right-0 overflow-hidden transition-all duration-300"
        style={{
          zIndex: "var(--z-sticky)",
          background: "linear-gradient(90deg, #0a0f1c 0%, #1a0a0a 50%, #0a0f1c 100%)",
          borderBottom: "1px solid rgba(207,51,57,0.15)",
          maxHeight: scrolled ? "0px" : "36px",
          opacity: scrolled ? 0 : 1,
        }}
        data-testid="announcement-bar"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-9 gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>NEW</span>
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>AI Receipt Scanner, Expense Reports, ACH Payments, and more.</span>
            <Link href="/features">
              <span className="inline-flex items-center gap-1 text-xs font-semibold cursor-pointer" style={{ color: "#cf3339" }} data-testid="link-announcement-features">
                See what's new <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>
      </div>

      <nav
        className="fixed left-0 right-0 border-b transition-all duration-300"
        style={{
          zIndex: "var(--z-sticky)",
          top: scrolled ? "0px" : "36px",
          background: scrolled ? "rgba(10,15,28,0.97)" : "rgba(10,15,28,0.92)",
          backdropFilter: "blur(20px)",
          borderColor: scrolled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)",
          boxShadow: scrolled ? "0 4px 30px rgba(0,0,0,0.3)" : "none",
        }}
        data-testid="marketing-nav"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <BrandLockup iconSize={34} textSize="base" />
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  <span
                    className="px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer"
                    style={{
                      color: location === link.href ? "#cf3339" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    {link.label}
                  </span>
                </Link>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3">
              {isAuthenticated ? (
                <Link href="/">
                  <span className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}>
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                  </span>
                </Link>
              ) : (
                <>
                  <Link href="/login">
                    <span className="text-sm font-medium cursor-pointer" style={{ color: "rgba(255,255,255,0.6)" }}>Log In</span>
                  </Link>
                  <Link href="/signup">
                    <span
                      className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer transition-opacity hover:opacity-90"
                      style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }}
                    >
                      Start Free Trial
                    </span>
                  </Link>
                </>
              )}
            </div>

            <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen
                ? <X className="w-5 h-5 text-white" />
                : <Menu className="w-5 h-5 text-white" />
              }
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t px-4 py-4 space-y-2" style={{ background: "rgba(10,15,28,0.98)", borderColor: "rgba(255,255,255,0.06)" }}>
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <span
                  className="block px-3 py-2 text-sm font-medium rounded-md cursor-pointer"
                  style={{ color: location === link.href ? "#cf3339" : "rgba(255,255,255,0.6)" }}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </span>
              </Link>
            ))}
            <div className="pt-3 flex flex-col gap-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              {isAuthenticated ? (
                <Link href="/">
                  <span className="block text-center px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }} onClick={() => setMobileOpen(false)}>
                    <LayoutDashboard className="w-4 h-4 inline mr-2" />
                    Go to Dashboard
                  </span>
                </Link>
              ) : (
                <>
                  <Link href="/login">
                    <span className="block text-center px-4 py-2 text-sm font-medium rounded-lg cursor-pointer" style={{ color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)" }} onClick={() => setMobileOpen(false)}>
                      Log In
                    </span>
                  </Link>
                  <Link href="/signup">
                    <span className="block text-center px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer" style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)" }} onClick={() => setMobileOpen(false)}>
                      Start Free Trial
                    </span>
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
