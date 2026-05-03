// L2 NOTE: The yellow "DEV" bar visible in the Replit preview is injected by Replit's
// hosting infrastructure; it does not exist in our codebase and does not appear in
// production builds deployed outside Replit. No action required.
import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, useParams, Redirect, useLocation } from "wouter";
import { queryClient, ensureCSRFToken } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { BrandProvider } from "@/contexts/BrandContext";
import { ThemeProvider } from "@/lib/theme";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { HelpPanel } from "@/components/help-panel";
import { CherryAssist } from "@/components/cherry-assist";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sparkles, HelpCircle, Search, AlertTriangle, X as XIcon } from "lucide-react";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { useEntitlement } from "@/lib/entitlements";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { BrandSwitcher } from "@/components/BrandSwitcher";
import { AdminSetupGate } from "@/components/admin-setup-gate";
import { ScrollToTop } from "@/components/scroll-to-top";
import { ScrollToTopButton } from "@/components/marketing/scroll-to-top-button";
import { openHelpPanel } from "@/lib/help-context";
import { NetworkStatusProvider } from "@/components/network-status";
import "@/lib/cherry-theme.css";

ensureCSRFToken();

function lazyRetry<T extends { default: any }>(
  loader: () => Promise<T>,
): Promise<T> {
  return loader().catch((err) => {
    const key = "chunk_reload_attempted";
    const attempted = sessionStorage.getItem(key);
    if (!attempted) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
      return new Promise(() => {});
    }
    sessionStorage.removeItem(key);
    throw err;
  });
}

function ToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    (window as any).__cherryToast = toast;
    return () => { delete (window as any).__cherryToast; };
  }, [toast]);
  return null;
}

/**
 * Sprint 2k follow-up — when an admin returns from Stripe Checkout after
 * unlocking Marketing OS, the Sprint 2j success URL is
 * `/settings/billing?addon=marketing_os&status=success`. We surface a
 * dedicated, friendlier confirmation here at the top level so the unlock
 * feels intentional regardless of which page they land on. The generic
 * "Add-on activated" toast on the billing page is suppressed for
 * marketing_os to avoid double-toasting (see settings/billing.tsx).
 *
 * The query string is stripped via history.replaceState so the toast does
 * not re-fire on refresh.
 */
function MarketingOsCheckoutToast() {
  const { toast } = useToast();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const addon = url.searchParams.get("addon");
    const status = url.searchParams.get("status");
    if (addon !== "marketing_os" || status !== "success") return;
    toast({
      title: "Marketing OS unlocked",
      description: "Your contacts hub is ready.",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/me/entitlements"] });
    queryClient.invalidateQueries({ queryKey: ["/api/me/entitlements/details"] });
    url.searchParams.delete("addon");
    url.searchParams.delete("status");
    const nextSearch = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      url.pathname + (nextSearch ? `?${nextSearch}` : "") + url.hash,
    );
  }, []);
  return null;
}

function preloadRouteChunks() {
  const routes = [
    () => import("@/pages/dashboard"),
    () => import("@/pages/clients"),
    () => import("@/pages/projects"),
    () => import("@/pages/time-tracking"),
    () => import("@/pages/invoices"),
    () => import("@/pages/payments"),
    () => import("@/pages/payouts"),
    () => import("@/pages/reports"),
    () => import("@/pages/team"),
    () => import("@/pages/expenses"),
    () => import("@/pages/settings"),
  ];
  const schedule = typeof requestIdleCallback === "function" ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 200);
  schedule(() => {
    routes.forEach(load => load().catch(() => {}));
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("load", preloadRouteChunks, { once: true });
}

const LoginPage = lazy(() => lazyRetry(() => import("@/pages/login")));
const DashboardPage = lazy(() => lazyRetry(() => import("@/pages/dashboard")));
const NotFound = lazy(() => lazyRetry(() => import("@/pages/not-found")));
const Error403 = lazy(() => lazyRetry(() => import("@/pages/error-403")));
const Error500 = lazy(() => lazyRetry(() => import("@/pages/error-500")));

const ClientsPage = lazy(() => lazyRetry(() => import("@/pages/clients")));
const ClientDetailPage = lazy(() => lazyRetry(() => import("@/pages/client-detail")));
const ProfilePage = lazy(() => lazyRetry(() => import("@/pages/profile")));
const ProjectsPage = lazy(() => lazyRetry(() => import("@/pages/projects")));
const ProjectDetailPage = lazy(() => lazyRetry(() => import("@/pages/project-detail")));
const TimeTrackingPage = lazy(() => lazyRetry(() => import("@/pages/time-tracking")));
const InvoicesPage = lazy(() => lazyRetry(() => import("@/pages/invoices")));
const PaymentsPage = lazy(() => lazyRetry(() => import("@/pages/payments")));
const PayoutsPage = lazy(() => lazyRetry(() => import("@/pages/payouts")));
const ReportsPage = lazy(() => lazyRetry(() => import("@/pages/reports")));
const ApprovalsPage = lazy(() => lazyRetry(() => import("@/pages/approvals")));
const TeamPage = lazy(() => lazyRetry(() => import("@/pages/team")));
const ImportPage = lazy(() => lazyRetry(() => import("@/pages/import")));
const AdminDataConsolePage = lazy(() => lazyRetry(() => import("@/pages/admin-data-console")));
const RateMatrixPage = lazy(() => lazyRetry(() => import("@/pages/admin/rate-matrix")));
const M365RescopePage = lazy(() => lazyRetry(() => import("@/pages/admin/m365-rescope")));
const MarketingRetryPoliciesPage = lazy(() => lazyRetry(() => import("@/pages/admin/marketing-retry-policies")));
const EstimatesPage = lazy(() => lazyRetry(() => import("@/pages/estimates")));
const RecurringTemplatesPage = lazy(() => lazyRetry(() => import("@/pages/recurring-templates")));
const SettingsPage = lazy(() => lazyRetry(() => import("@/pages/settings")));
const BrandsSettingsPage = lazy(() => lazyRetry(() => import("@/pages/settings/brands")));
const BillingSettingsPage = lazy(() => lazyRetry(() => import("@/pages/settings/billing")));
const MarketingOsLockedCard = lazy(() => lazyRetry(() => import("@/components/marketing-os-locked-card")));
const ContactsListPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/contacts")));
const ContactsImportPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/contacts-import")));
const ContactDetailPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/contact-detail")));
const CompaniesListPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/companies")));
const TagsListPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/tags")));
const SegmentsListPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/segments")));
const CampaignsPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/campaigns")));
const CampaignDetailPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/campaign-detail")));
const SequencesPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/sequences")));
const ActivityFirehosePage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/activity")));
const CompanyDetailPage = lazy(() => lazyRetry(() => import("@/pages/marketing-os/company-detail")));
const ExpensesPage = lazy(() => lazyRetry(() => import("@/pages/expenses")));
const ExpenseReportsPage = lazy(() => lazyRetry(() => import("@/pages/expense-reports")));
const NotificationsPage = lazy(() => lazyRetry(() => import("@/pages/notifications")));
const ActivityPage = lazy(() => lazyRetry(() => import("@/pages/activity")));
const ChangePasswordPage = lazy(() => lazyRetry(() => import("@/pages/change-password")));
const OnboardingPage = lazy(() => lazyRetry(() => import("@/pages/onboarding")));
const PublicInvoicePage = lazy(() => lazyRetry(() => import("@/pages/public-invoice")));
const PublicEstimatePage = lazy(() => lazyRetry(() => import("@/pages/public-estimate")));
const ClientPortalPage = lazy(() => lazyRetry(() => import("@/pages/client-portal")));
const MarketingHomePage = lazy(() => lazyRetry(() => import("@/pages/marketing/home")));
const FeaturesPage = lazy(() => lazyRetry(() => import("@/pages/marketing/features")));
const PricingPage = lazy(() => lazyRetry(() => import("@/pages/marketing/pricing")));
const MarketingLandingPage = lazy(() => lazyRetry(() => import("@/pages/marketing/marketing")));
const SwitchFreshBooksPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-freshbooks")));
const SwitchQuickBooksPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-quickbooks")));
const SwitchFreshBooksDetailPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-freshbooks-page")));
const SwitchXeroPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-xero")));
const SwitchWavePage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-wave")));
const SwitchHarvestPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-harvest")));
const SwitchBigTimePage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-bigtime")));
const SwitchScoroPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-scoro")));
const SwitchPaymoPage = lazy(() => lazyRetry(() => import("@/pages/marketing/switch-paymo")));
const AboutPage = lazy(() => lazyRetry(() => import("@/pages/marketing/about")));
const ContactPage = lazy(() => lazyRetry(() => import("@/pages/marketing/contact")));
const SignupPage = lazy(() => lazyRetry(() => import("@/pages/marketing/signup")));
const TermsPage = lazy(() => lazyRetry(() => import("@/pages/marketing/terms")));
const PrivacyPage = lazy(() => lazyRetry(() => import("@/pages/marketing/privacy")));
const DemoPage = lazy(() => lazyRetry(() => import("@/pages/marketing/demo")));
const IntegrationsPage = lazy(() => lazyRetry(() => import("@/pages/marketing/integrations")));
const ApiIntegrationsPage = lazy(() => lazyRetry(() => import("@/pages/integrations")));
const SecurityPage = lazy(() => lazyRetry(() => import("@/pages/marketing/security")));
const GettingStartedPage = lazy(() => lazyRetry(() => import("@/pages/getting-started")));
const ServicesPage = lazy(() => lazyRetry(() => import("@/pages/services")));
const AccountingHubPage = lazy(() => lazyRetry(() => import("@/pages/accounting")));
const BillingHubPage = lazy(() => lazyRetry(() => import("@/pages/billing")));
const ManagementHubPage = lazy(() => lazyRetry(() => import("@/pages/management")));
const SystemHubPage = lazy(() => lazyRetry(() => import("@/pages/system")));
const GLAccountsPage = lazy(() => lazyRetry(() => import("@/pages/gl-accounts")));
const GLLedgerPage = lazy(() => lazyRetry(() => import("@/pages/gl-ledger")));
const GLJournalEntriesPage = lazy(() => lazyRetry(() => import("@/pages/gl-journal-entries")));
const GLTrialBalancePage = lazy(() => lazyRetry(() => import("@/pages/gl-trial-balance")));
const BankConnectionsPage = lazy(() => lazyRetry(() => import("@/pages/bank-connections")));
const ForgotPasswordPage = lazy(() => lazyRetry(() => import("@/pages/forgot-password")));
const ResetPasswordPage = lazy(() => lazyRetry(() => import("@/pages/reset-password")));
const ClosePeriodsPage = lazy(() => lazyRetry(() => import("@/pages/close-periods")));
// Sprint 2m — premium primitives showcase. Single dev-guarded block:
// lazy import + route are co-located inside one `if (import.meta.env.DEV)`
// so Vite tree-shakes both out of production.
const DevPremiumShowcaseRoute: React.ReactElement | null = (() => {
  if (!import.meta.env.DEV) return null;
  const PremiumShowcasePage = lazy(() => lazyRetry(() => import("@/pages/__premium-showcase")));
  return (
    <Route path="/__premium-showcase">
      {() => <LazyRoute component={PremiumShowcasePage} />}
    </Route>
  );
})();

function LazyFallback() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="space-y-3 text-center">
        <Skeleton className="h-10 w-10 rounded-xl mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto rounded" />
      </div>
    </div>
  );
}

function PublicInvoiceWrapper() {
  const params = useParams<{ token: string }>();
  return <Suspense fallback={<LazyFallback />}><PublicInvoicePage token={params.token || ""} /></Suspense>;
}

function PublicEstimateWrapper() {
  const params = useParams<{ token: string }>();
  return <Suspense fallback={<LazyFallback />}><PublicEstimatePage token={params.token || ""} /></Suspense>;
}

function ClientPortalWrapper() {
  const params = useParams<{ token: string }>();
  return <Suspense fallback={<LazyFallback />}><ClientPortalPage token={params.token || ""} /></Suspense>;
}

function ProjectDetailWrapper() {
  const params = useParams<{ id: string }>();
  return <Suspense fallback={<LazyFallback />}><ProjectDetailPage id={params.id || ""} /></Suspense>;
}

function InvoiceDetailWrapper() {
  const params = useParams<{ id: string }>();
  return <Suspense fallback={<LazyFallback />}><InvoicesPage initialInvoiceId={params.id || ""} /></Suspense>;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/login?auth=required" />;
  if (user.role !== "ADMIN") return <Suspense fallback={<LazyFallback />}><Error403 /></Suspense>;
  return <Suspense fallback={<LazyFallback />}><Component /></Suspense>;
}

function ManagerRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/login?auth=required" />;
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return <Suspense fallback={<LazyFallback />}><Error403 /></Suspense>;
  return <Suspense fallback={<LazyFallback />}><Component /></Suspense>;
}

function LazyRoute({ component: Component }: { component: React.ComponentType }) {
  return <Suspense fallback={<LazyFallback />}><Component /></Suspense>;
}

function Router() {
  const { active: marketingOsActive } = useEntitlement("marketing_os");
  return (
    <Switch>
      <Route path="/">{() => <LazyRoute component={DashboardPage} />}</Route>
      <Route path="/dashboard">{() => <LazyRoute component={DashboardPage} />}</Route>
      <Route path="/home">{() => <LazyRoute component={DashboardPage} />}</Route>
      <Route path="/clients/:id">{() => <LazyRoute component={ClientDetailPage} />}</Route>
      <Route path="/clients">{() => <LazyRoute component={ClientsPage} />}</Route>
      <Route path="/profile">{() => <LazyRoute component={ProfilePage} />}</Route>
      <Route path="/change-password">{() => <LazyRoute component={ChangePasswordPage} />}</Route>
      <Route path="/onboarding">{() => <LazyRoute component={OnboardingPage} />}</Route>
      <Route path="/projects/:id">{() => <LazyRoute component={() => <ProjectDetailWrapper />} />}</Route>
      <Route path="/projects">{() => <LazyRoute component={ProjectsPage} />}</Route>
      <Route path="/time">{() => <LazyRoute component={TimeTrackingPage} />}</Route>
      <Route path="/invoices/recurring">{() => <ManagerRoute component={RecurringTemplatesPage} />}</Route>
      <Route path="/invoices/:id">{() => <ManagerRoute component={() => <InvoiceDetailWrapper />} />}</Route>
      <Route path="/invoices">{() => <ManagerRoute component={InvoicesPage} />}</Route>
      <Route path="/payments">{() => <ManagerRoute component={PaymentsPage} />}</Route>
      <Route path="/payouts">{() => <AdminRoute component={PayoutsPage} />}</Route>
      <Route path="/reports">{() => <ManagerRoute component={ReportsPage} />}</Route>
      <Route path="/expenses">{() => <LazyRoute component={ExpensesPage} />}</Route>
      <Route path="/expense-reports">{() => <LazyRoute component={ExpenseReportsPage} />}</Route>
      <Route path="/estimates">{() => <ManagerRoute component={EstimatesPage} />}</Route>
      <Route path="/notifications">{() => <LazyRoute component={NotificationsPage} />}</Route>
      <Route path="/activity">{() => <ManagerRoute component={ActivityPage} />}</Route>
      <Route path="/approvals">{() => <ManagerRoute component={ApprovalsPage} />}</Route>
      <Route path="/team">{() => <ManagerRoute component={TeamPage} />}</Route>
      <Route path="/import">{() => <ManagerRoute component={ImportPage} />}</Route>
      <Route path="/admin/rate-matrix/:projectId">{() => <ManagerRoute component={RateMatrixPage} />}</Route>
      <Route path="/admin/m365-rescope">{() => <LazyRoute component={M365RescopePage} />}</Route>
      <Route path="/admin/marketing-retry-policies">{() => <LazyRoute component={MarketingRetryPoliciesPage} />}</Route>
      <Route path="/admin/data/:entity/:id">{() => <AdminRoute component={AdminDataConsolePage} />}</Route>
      <Route path="/admin/data/:entity">{() => <AdminRoute component={AdminDataConsolePage} />}</Route>
      <Route path="/admin/data">{() => <AdminRoute component={AdminDataConsolePage} />}</Route>
      <Route path="/settings/brands">{() => <AdminRoute component={BrandsSettingsPage} />}</Route>
      <Route path="/settings/billing">{() => <AdminRoute component={BillingSettingsPage} />}</Route>
      {/* Marketing OS — Sprint 2i.3 + Sprint 2j, role gating updated by
          Task #396. When the org has the `marketing_os` entitlement, the
          real pages render. When it does NOT, /marketing/* renders the
          upgrade card so users discover the add-on instead of seeing a
          generic 404. Gated to ADMIN+MANAGER (was ADMIN-only) to match
          the server-side `requireAdminOrManager` swap on /api/marketing/*
          — keeping these as AdminRoute would 403 managers in the UI even
          though the API now allows them through. Detail route MUST
          register before list per wouter Switch order rule. */}
      {marketingOsActive ? (
        <>
          <Route path="/marketing/contacts/import">{() => <ManagerRoute component={ContactsImportPage} />}</Route>
          <Route path="/marketing/contacts/:id">{() => <ManagerRoute component={ContactDetailPage} />}</Route>
          <Route path="/marketing/contacts">{() => <ManagerRoute component={ContactsListPage} />}</Route>
          <Route path="/marketing/companies/:id">{() => <ManagerRoute component={CompanyDetailPage} />}</Route>
          <Route path="/marketing/companies">{() => <ManagerRoute component={CompaniesListPage} />}</Route>
          <Route path="/marketing/tags">{() => <ManagerRoute component={TagsListPage} />}</Route>
          <Route path="/marketing/segments">{() => <ManagerRoute component={SegmentsListPage} />}</Route>
          <Route path="/marketing/campaigns/:id">{() => <ManagerRoute component={CampaignDetailPage} />}</Route>
          <Route path="/marketing/campaigns">{() => <ManagerRoute component={CampaignsPage} />}</Route>
          <Route path="/marketing/sequences">{() => <ManagerRoute component={SequencesPage} />}</Route>
          <Route path="/marketing/activity">{() => <ManagerRoute component={ActivityFirehosePage} />}</Route>
        </>
      ) : (
        <Route path="/marketing/:rest*">
          {() => <ManagerRoute component={MarketingOsLockedCard} />}
        </Route>
      )}
      <Route path="/settings">{() => <AdminRoute component={SettingsPage} />}</Route>
      <Route path="/api-integrations">{() => <AdminRoute component={ApiIntegrationsPage} />}</Route>
      <Route path="/services">{() => <ManagerRoute component={ServicesPage} />}</Route>
      <Route path="/accounting">{() => <ManagerRoute component={AccountingHubPage} />}</Route>
      <Route path="/billing">{() => <ManagerRoute component={BillingHubPage} />}</Route>
      <Route path="/management">{() => <ManagerRoute component={ManagementHubPage} />}</Route>
      <Route path="/system">{() => <AdminRoute component={SystemHubPage} />}</Route>
      <Route path="/gl/accounts">{() => <ManagerRoute component={GLAccountsPage} />}</Route>
      <Route path="/gl/ledger">{() => <ManagerRoute component={GLLedgerPage} />}</Route>
      <Route path="/gl/journal-entries">{() => <ManagerRoute component={GLJournalEntriesPage} />}</Route>
      <Route path="/gl/trial-balance">{() => <ManagerRoute component={GLTrialBalancePage} />}</Route>
      <Route path="/banking">{() => <AdminRoute component={BankConnectionsPage} />}</Route>
      <Route path="/close-periods">{() => <ManagerRoute component={ClosePeriodsPage} />}</Route>
      <Route path="/timesheets"><Redirect to="/time" /></Route>
      <Route path="/403">{() => <LazyRoute component={Error403} />}</Route>
      <Route path="/500">{() => <LazyRoute component={Error500} />}</Route>
      <Route>{() => <LazyRoute component={NotFound} />}</Route>
    </Switch>
  );
}

function AuthenticatedGettingStarted() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--lux-bg)" }}>
        <Skeleton className="h-10 w-10 rounded-xl mx-auto" />
      </div>
    );
  }
  if (!user) {
    return <Redirect to="/login?auth=required" />;
  }
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  return (
    <div className="cherry-app">
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full" style={{ background: "var(--lux-bg)" }}>
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header
            className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
            style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}
          >
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-accent"
                style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-secondary)" }}
                title="Search (⌘K)"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Search</span>
                <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
              </button>
              <BrandSwitcher />
              <NotificationBell />
              <button
                onClick={openHelpPanel}
                className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
                style={{ background: "linear-gradient(135deg, #cf3339, #e74c3c)", color: "white" }}
                title="Help & Documentation"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto" style={{ background: "var(--lux-bg)" }}>
            <GettingStartedPage />
          </main>
        </div>
      </div>
      <HelpPanel />
      <CherryAssist />
      <CommandPalette />
    </SidebarProvider>
    </div>
  );
}

function DeletionBanner() {
  const { data: billing } = useBillingStatus();
  const [dismissed, setDismissed] = useState(false);
  const { user } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const { toast } = useToast();

  if (dismissed || !billing?.deletionScheduledFor) return null;

  const scheduledDate = new Date(billing.deletionScheduledFor);
  const daysLeft = Math.max(0, Math.ceil((scheduledDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const formattedDate = scheduledDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiRequest("POST", "/api/account/cancel-deletion");
      queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
      toast({ title: "Deletion cancelled", description: "Your account deletion has been cancelled." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to cancel deletion", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm" style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca" }} data-testid="banner-deletion-pending">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span className="text-red-800">
          Account scheduled for deletion on <strong>{formattedDate}</strong> ({daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining).
        </span>
        {user?.role === "ADMIN" && (
          <button
            className="ml-2 text-red-700 underline hover:text-red-900 font-medium"
            onClick={handleCancel}
            disabled={cancelling}
            data-testid="button-cancel-deletion"
          >
            {cancelling ? "Cancelling..." : "Cancel deletion"}
          </button>
        )}
      </div>
      <button onClick={() => setDismissed(true)} className="text-red-400 hover:text-red-600 ml-2" data-testid="button-dismiss-deletion-banner">
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <div className="cherry-app">
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full" style={{ background: "var(--lux-bg)" }}>
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <DeletionBanner />
          <header
            className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
            style={{
              background: "var(--lux-surface)",
              borderColor: "var(--lux-border)",
            }}
          >
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-accent"
                style={{ borderColor: "var(--lux-border)", color: "var(--lux-text-secondary)" }}
                title="Search (⌘K)"
                data-testid="button-global-search"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Search</span>
                <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
              </button>
              <BrandSwitcher />
              <NotificationBell />
              <button
                onClick={openHelpPanel}
                className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110"
                style={{
                  background: "linear-gradient(135deg, #cf3339, #e74c3c)",
                  color: "white",
                }}
                title="Help & Documentation"
                data-testid="button-header-help"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </header>
          <main
            className="flex-1 overflow-y-auto"
            style={{ background: "var(--lux-bg)" }}
          >
            <Router />
          </main>
        </div>
      </div>
          <HelpPanel />
          <CherryAssist />
          <CommandPalette />
    </SidebarProvider>
    </div>
  );
}


function AppContent() {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--lux-bg)" }}>
        <div className="space-y-3 text-center">
          <Skeleton className="h-10 w-10 rounded-xl mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto rounded" />
        </div>
      </div>
    );
  }

  if (!user) {
    if (location === "/" || location === "") {
      return <Suspense fallback={<LazyFallback />}><MarketingHomePage /></Suspense>;
    }
    if (location === "/login") {
      return <Suspense fallback={<LazyFallback />}><LoginPage /></Suspense>;
    }
    if (location === "/forgot-password") {
      return <Suspense fallback={<LazyFallback />}><ForgotPasswordPage /></Suspense>;
    }
    if (location.startsWith("/reset-password/")) {
      return <Suspense fallback={<LazyFallback />}><ResetPasswordPage /></Suspense>;
    }
    return <Redirect to="/login?auth=required" />;
  }

  if (location === "/login") {
    return <Redirect to="/" />;
  }
  if (location === "/forgot-password") {
    return <Suspense fallback={<LazyFallback />}><ForgotPasswordPage /></Suspense>;
  }
  if (location.startsWith("/reset-password/")) {
    return <Suspense fallback={<LazyFallback />}><ResetPasswordPage /></Suspense>;
  }

  if (user.tempPassword) {
    return <Suspense fallback={<LazyFallback />}><ChangePasswordPage /></Suspense>;
  }

  if (!user.onboardingComplete && (user.role === "TEAM_MEMBER" || user.role === "MANAGER")) {
    return <Suspense fallback={<LazyFallback />}><OnboardingPage /></Suspense>;
  }

  if (user.role === "ADMIN") {
    return (
      <AdminSetupGate>
        <AuthenticatedLayout />
      </AdminSetupGate>
    );
  }

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NetworkStatusProvider>
        <TooltipProvider>
          <ScrollToTop />
          <ScrollToTopButton />
          <Suspense fallback={<LazyFallback />}>
          <Switch>
            <Route path="/i/:token" component={PublicInvoiceWrapper} />
            <Route path="/e/:token" component={PublicEstimateWrapper} />
            <Route path="/portal/:token" component={ClientPortalWrapper} />
            <Route path="/features">{() => <LazyRoute component={FeaturesPage} />}</Route>
            <Route path="/pricing">{() => <LazyRoute component={PricingPage} />}</Route>
            <Route path="/marketing">{() => <LazyRoute component={MarketingLandingPage} />}</Route>
            <Route path="/marketing-os"><Redirect to="/marketing" /></Route>
            <Route path="/compare">{() => <LazyRoute component={SwitchFreshBooksPage} />}</Route>
            <Route path="/switch-from-quickbooks">{() => <LazyRoute component={SwitchQuickBooksPage} />}</Route>
            <Route path="/switch-from-freshbooks">{() => <LazyRoute component={SwitchFreshBooksDetailPage} />}</Route>
            <Route path="/switch-from-xero">{() => <LazyRoute component={SwitchXeroPage} />}</Route>
            <Route path="/switch-from-wave">{() => <LazyRoute component={SwitchWavePage} />}</Route>
            <Route path="/switch-from-harvest">{() => <LazyRoute component={SwitchHarvestPage} />}</Route>
            <Route path="/switch-from-bigtime">{() => <LazyRoute component={SwitchBigTimePage} />}</Route>
            <Route path="/switch-from-scoro">{() => <LazyRoute component={SwitchScoroPage} />}</Route>
            <Route path="/switch-from-paymo">{() => <LazyRoute component={SwitchPaymoPage} />}</Route>
            <Route path="/about">{() => <LazyRoute component={AboutPage} />}</Route>
            <Route path="/integrations">{() => <LazyRoute component={IntegrationsPage} />}</Route>
            <Route path="/demo">{() => <LazyRoute component={DemoPage} />}</Route>
            <Route path="/contact">{() => <LazyRoute component={ContactPage} />}</Route>
            <Route path="/signup">{() => <LazyRoute component={SignupPage} />}</Route>
            <Route path="/terms">{() => <LazyRoute component={TermsPage} />}</Route>
            <Route path="/privacy">{() => <LazyRoute component={PrivacyPage} />}</Route>
            <Route path="/security">{() => <LazyRoute component={SecurityPage} />}</Route>
            <Route path="/tour"><Redirect to="/demo" /></Route>
            <Route path="/blog"><Redirect to="/" /></Route>
            <Route path="/careers"><Redirect to="/" /></Route>
            <Route path="/timesheets"><Redirect to="/time" /></Route>
            {DevPremiumShowcaseRoute}
            <Route path="/getting-started"><AuthProvider><BrandProvider><Suspense fallback={<LazyFallback />}><AuthenticatedGettingStarted /></Suspense></BrandProvider></AuthProvider></Route>
            <Route>
              <AuthProvider>
                <BrandProvider>
                  <AppContent />
                </BrandProvider>
              </AuthProvider>
            </Route>
          </Switch>
          </Suspense>
          <Toaster />
          <ToastBridge />
          <MarketingOsCheckoutToast />
        </TooltipProvider>
        </NetworkStatusProvider>
        </ThemeProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
