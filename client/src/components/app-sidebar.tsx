import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { displayName, userInitials } from "@/lib/user";
import {
  LayoutDashboard, Users, FolderKanban, Clock, FileText, CreditCard,
  DollarSign, BarChart3, ClipboardCheck, Upload, LogOut, Moon, Sun,
  FileCheck, Settings, User, UsersRound, Receipt, Sparkles, ChevronDown, Tag,
  BookOpen, Landmark, BookMarked, Scale, Building2, Lock, Plug2, CalendarCheck, Grid3X3,
  CheckCircle, Bell, FileBarChart,
} from "lucide-react";
import { useEntitlement, useEntitlementDetails, resolveEntitlementStatus } from "@/lib/entitlements";
import { MarketingNavSection } from "@/components/marketing-nav-section";
import { CherryLogo } from "@/components/shared/cherry-logo";
import { BrandLockup } from "@/components/shared/brand-lockup";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
} from "@/components/ui/sidebar";
import { useTheme } from "@/lib/theme";
import { roleLabel } from "@/lib/role-label";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { useNotificationSocket } from "@/hooks/use-notification-socket";
import { TIER_RANK, TIER_LABEL } from "@/lib/tier-config";

interface NavItem {
  title: string;
  url: string;
  icon: any;
  badge?: number;
  requiredTier?: "PROFESSIONAL" | "BUSINESS";
  adminOnly?: boolean;
  teamVisible?: boolean;
}

interface NavSection {
  label: string;
  adminOnly?: boolean;
  managerVisible?: boolean;
  teamVisible?: boolean;
  hubUrl?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: "Work",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Time Tracking", url: "/time", icon: Clock },
      { title: "Expenses", url: "/expenses", icon: Receipt },
    ],
  },
  {
    label: "Personal",
    items: [
      { title: "Expense Reports", url: "/expense-reports", icon: FileBarChart },
      { title: "Notifications", url: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Billing",
    adminOnly: true,
    managerVisible: true,
    hubUrl: "/billing",
    items: [
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Estimates", url: "/estimates", icon: FileCheck },
      { title: "Payments", url: "/payments", icon: CreditCard },
    ],
  },
  {
    label: "Management",
    adminOnly: true,
    managerVisible: true,
    teamVisible: true,
    hubUrl: "/management",
    items: [
      { title: "Clients", url: "/clients", icon: Users, teamVisible: true },
      { title: "Projects", url: "/projects", icon: FolderKanban, teamVisible: true },
      { title: "Services", url: "/services", icon: Tag },
      { title: "Payouts", url: "/payouts", icon: DollarSign, adminOnly: true },
      { title: "Approvals", url: "/approvals", icon: ClipboardCheck, requiredTier: "PROFESSIONAL" },
    ],
  },
  {
    label: "Accounting",
    adminOnly: true,
    managerVisible: true,
    hubUrl: "/accounting",
    items: [
      { title: "Chart of Accounts", url: "/gl/accounts", icon: BookOpen },
      { title: "General Ledger", url: "/gl/ledger", icon: Landmark },
      { title: "Journal Entries", url: "/gl/journal-entries", icon: BookMarked },
      { title: "Trial Balance", url: "/gl/trial-balance", icon: Scale },
      { title: "Banking", url: "/banking", icon: Building2, adminOnly: true, requiredTier: "PROFESSIONAL" },
    ],
  },
  {
    label: "Reports",
    adminOnly: true,
    managerVisible: true,
    hubUrl: "/reports",
    items: [
      { title: "Reports", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "People",
    adminOnly: true,
    managerVisible: true,
    hubUrl: "/team",
    items: [
      { title: "Team", url: "/team", icon: UsersRound },
    ],
  },
  {
    label: "System",
    adminOnly: true,
    hubUrl: "/system",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Billing", url: "/settings/billing", icon: CreditCard, adminOnly: true },
      { title: "Import", url: "/import", icon: Upload, requiredTier: "PROFESSIONAL" },
      { title: "API & Integrations", url: "/api-integrations", icon: Plug2, requiredTier: "PROFESSIONAL" },
      { title: "Close Periods", url: "/close-periods", icon: CalendarCheck, requiredTier: "BUSINESS" },
    ],
  },
];

function GettingStartedLink({ location }: { location: string }) {
  const { data: status } = useQuery<{ completedCount: number; totalSteps: number; allComplete: boolean }>({
    queryKey: ["/api/implementation-status"],
  });

  const completedCount = status?.completedCount ?? 0;
  const totalSteps = status?.totalSteps ?? 5;
  const allComplete = status?.allComplete ?? false;

  return (
    <Link
      href="/getting-started"
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium no-underline cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      style={{ color: "var(--lux-text-muted)", display: "flex" }}
      data-testid="link-getting-started"
    >
      {allComplete ? (
        <CheckCircle className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
      ) : (
        <Sparkles className="w-3.5 h-3.5" style={{ color: "#cf3339" }} />
      )}
      <span className="flex-1">Getting Started</span>
      {!allComplete && totalSteps > 0 && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(207,51,57,0.15)", color: "#cf3339" }}
          data-testid="badge-setup-progress"
        >
          {completedCount}/{totalSteps}
        </span>
      )}
    </Link>
  );
}

function NavSection({ section, isAdmin, canManage, location, planTier }: { section: NavSection; isAdmin: boolean; canManage: boolean; location: string; planTier: string }) {
  const visibleItems = section.items.filter(item => {
    if (canManage) return !item.adminOnly || isAdmin;
    return !!item.teamVisible;
  });

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  };

  const hubActive = !!section.hubUrl && isActive(section.hubUrl);
  const hasActiveItem = visibleItems.some(item => isActive(item.url)) || hubActive;
  const [open, setOpen] = useState(hasActiveItem);

  useEffect(() => {
    if (hasActiveItem) setOpen(true);
  }, [hasActiveItem]);

  if (section.adminOnly) {
    const allowed = isAdmin || (section.managerVisible && canManage) || (section.teamVisible && !canManage);
    if (!allowed) return null;
  }

  if (visibleItems.length === 0) return null;

  const isFeatureLocked = (item: NavItem) => {
    if (!item.requiredTier) return false;
    const requiredRank = TIER_RANK[item.requiredTier] ?? 0;
    const currentRank = TIER_RANK[planTier] ?? 0;
    return currentRank < requiredRank;
  };

  const headerTestId = `link-section-${section.label.toLowerCase().replace(/\s/g, "-")}`;
  const toggleTestId = `button-section-toggle-${section.label.toLowerCase().replace(/\s/g, "-")}`;

  return (
    <div className="mb-1">
      {section.hubUrl ? (
        <div
          className="w-full flex items-center justify-between pr-1 rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ background: hubActive ? "var(--lux-sidebar-active-bg, hsl(var(--sidebar-accent)))" : "transparent" }}
        >
          <Link
            href={section.hubUrl}
            className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider no-underline cursor-pointer"
            style={{ color: hubActive ? "var(--lux-sidebar-active-text, var(--lux-text))" : "var(--lux-sidebar-section-color, var(--lux-text-muted))", display: "block" }}
            data-testid={headerTestId}
          >
            {section.label}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="p-1.5 rounded-md cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            style={{ color: hubActive ? "var(--lux-sidebar-active-text, var(--lux-text))" : "var(--lux-sidebar-section-color, var(--lux-text-muted))" }}
            data-testid={toggleTestId}
            aria-label={open ? `Collapse ${section.label}` : `Expand ${section.label}`}
            aria-expanded={open}
          >
            <ChevronDown
              className="w-3 h-3 transition-transform duration-200"
              style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
            />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors"
          style={{ color: "var(--lux-sidebar-section-color, var(--lux-text-muted))" }}
          data-testid={toggleTestId}
        >
          {section.label}
          <ChevronDown
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </button>
      )}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxHeight: open ? `${visibleItems.length * 44}px` : "0px", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      >
        {visibleItems.map((item) => {
          const active = isActive(item.url);
          const locked = isFeatureLocked(item);
          return (
            <Link
              key={item.title}
              href={item.url}
              data-testid={`link-${item.title.toLowerCase().replace(/\s/g, "-")}`}
              className={`flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm no-underline cursor-pointer transition-colors ${
                active ? "font-semibold" : ""
              }`}
              style={{
                color: locked ? "var(--lux-text-muted)" : active ? "var(--lux-sidebar-active-text, var(--lux-text))" : "var(--lux-text-secondary)",
                background: active && !locked ? "var(--lux-sidebar-active-bg, hsl(var(--sidebar-accent)))" : "transparent",
                opacity: locked ? 0.6 : 1,
                display: "flex",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--lux-sidebar-hover-bg, rgba(0,0,0,0.05))"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              title={locked ? `Upgrade to ${TIER_LABEL[item.requiredTier || ""] || item.requiredTier}` : undefined}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" style={{ color: locked ? "var(--lux-text-muted)" : active ? "var(--lux-sidebar-active-text)" : "var(--lux-text-muted)" }} />
              <span className="flex-1">{item.title}</span>
              {locked && (
                <Lock className="w-3 h-3 flex-shrink-0" style={{ color: "var(--lux-text-muted)" }} data-testid={`lock-${item.title.toLowerCase().replace(/\s/g, "-")}`} />
              )}
              {!locked && item.badge != null && item.badge > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums text-white" style={{ background: "#8b5cf6" }} data-testid={`badge-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const { planTier } = useBillingStatus();
  useNotificationSocket({ enabled: !!user });
  const { data: org } = useQuery<{ name?: string; logoUrl?: string }>({
    queryKey: ["/api/org/settings"],
    enabled: isAdmin,
  });
  const { data: bankingStats } = useQuery<{ unreconciled: number }>({
    queryKey: ["/api/dashboard/banking"],
    enabled: isAdmin,
    refetchInterval: 60000,
  });
  const { data: notifStats } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: !!user,
  });

  // Marketing OS — Sprint 2k. Sidebar Marketing section is now ALWAYS
  // rendered for admins; the locked variant (admin + inactive entitlement)
  // is handled by <MarketingNavSection/> below the main section list so
  // it can render its own DOM and own its upgrade modal state. We keep
  // the entitlement-details query (Sprint 2i.4) as the single source of
  // truth so a grace-window org reads as "active" via
  // resolveEntitlementStatus.
  const { data: entDetails } = useEntitlementDetails();
  // While the entitlement-details query is in-flight (or errored with no
  // cache) we have no signal to distinguish active from inactive. Don't
  // render the locked upsell speculatively — that would flicker for
  // active orgs on first paint. The section appears as soon as we have
  // a verdict.
  const marketingStatus = entDetails
    ? resolveEntitlementStatus(entDetails.marketing_os).status
    : null;

  const enrichedSections = sections.map(section => ({
    ...section,
    items: section.items.map(item => {
      if (item.title === "Banking" && bankingStats?.unreconciled) {
        return { ...item, badge: bankingStats.unreconciled };
      }
      if (item.title === "Notifications" && notifStats?.unreadCount) {
        return { ...item, badge: notifStats.unreadCount };
      }
      return item;
    }),
  }));

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link
          href="/"
          className="flex items-center gap-3 no-underline cursor-pointer"
          style={{ display: "flex" }}
          data-testid="link-home"
        >
          {org?.logoUrl ? (
            <div className="flex items-center gap-2.5">
              <img src={(org as any).logoUrl} alt="Logo" className="rounded-lg object-cover" style={{ width: 34, height: 34 }} />
              <div>
                <span className="text-base font-bold tracking-tight" style={{ color: "var(--lux-text)" }}>{org?.name}</span>
                <span
                  className="inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full leading-none ml-2"
                  style={{
                    color: "#fff",
                    background:
                      planTier === "ENTERPRISE" ? "#b8860b"
                      : planTier === "PROFESSIONAL" ? "#7c3aed"
                      : planTier === "STARTER" ? "#2563eb"
                      : "#6b7280",
                  }}
                  data-testid="badge-plan-tier"
                >
                  {planTier || "FREE"}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <BrandLockup iconSize={34} textSize="base" />
              <span
                className="inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full leading-none mt-1"
                style={{
                  color: "#fff",
                  background:
                    planTier === "ENTERPRISE" ? "#b8860b"
                    : planTier === "PROFESSIONAL" ? "#7c3aed"
                    : planTier === "STARTER" ? "#2563eb"
                    : "#6b7280",
                }}
                data-testid="badge-plan-tier"
              >
                {planTier || "FREE"}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-1" role="navigation" aria-label="Main navigation">
        {enrichedSections.map((section) => (
          <NavSection key={section.label} section={section} isAdmin={isAdmin} canManage={canManage} location={location} planTier={planTier} />
        ))}
        {canManage && marketingStatus !== null && (
          <MarketingNavSection
            status={marketingStatus}
            location={location}
          />
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 space-y-2" style={{ borderTop: "1px solid var(--lux-sidebar-separator, var(--lux-border))" }}>
        <GettingStartedLink location={location} />

        <Link
          href="/profile"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium no-underline cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${location === "/profile" ? "font-semibold" : ""}`}
          style={{ color: location === "/profile" ? "var(--lux-text)" : "var(--lux-text-muted)", display: "flex" }}
          data-testid="link-profile"
        >
          <User className="w-3.5 h-3.5" />
          Profile
        </Link>

        {user && (
          <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5 flex-1 min-w-0 text-left"
                style={{ background: "var(--color-accent-soft)" }}
                data-testid="button-user-menu"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: "var(--gradient-brand)" }}>
                  {userInitials(user)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: "var(--lux-text)" }}>{displayName(user)}</p>
                  <p className="text-[10px] truncate" style={{ color: "var(--lux-text-muted)" }} data-testid="text-user-role">{roleLabel(user.role)}</p>
                </div>
                <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "var(--lux-text-muted)" }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <DropdownMenuItem onClick={() => window.location.href = "/profile"} data-testid="menu-item-profile">
                <User className="w-3.5 h-3.5 mr-2" /> Profile
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => window.location.href = "/settings"} data-testid="menu-item-settings">
                  <Settings className="w-3.5 h-3.5 mr-2" /> Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-red-600" data-testid="button-logout">
                <LogOut className="w-3.5 h-3.5 mr-2" /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={toggle}
            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="button-theme-toggle"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
