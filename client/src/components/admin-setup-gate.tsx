import { Suspense, lazy, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, HelpCircle, Search } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { HelpPanel } from "@/components/help-panel";
import { CherryAssist } from "@/components/cherry-assist";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { BrandSwitcher } from "@/components/BrandSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntitlement } from "@/lib/entitlements";
import { openHelpPanel } from "@/lib/help-context";

const GettingStartedPage = lazy(() => import("@/pages/getting-started"));

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

// Gate that blocks ADMIN users on every route except a small allow-list
// (and /marketing/* when brands exist or `marketing_os` is active — Task
// 245) until the firm profile is filled in. Extracted from App.tsx in
// Task 261 to enable an isolated component test.
export function AdminSetupGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data, isLoading } = useQuery<{ firmProfileComplete: boolean }>({
    queryKey: ["/api/implementation-status"],
  });
  const { active: marketingOsActive } = useEntitlement("marketing_os");
  const { data: brands } = useQuery<Array<{ id: string }>>({ queryKey: ["/api/brands"] });

  if (isLoading) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ background: "#0a0f1c" }}
        data-testid="state-admin-setup-gate-loading"
      >
        <div className="text-center">
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "rgba(207,51,57,0.1)" }}
          >
            <Sparkles className="w-6 h-6" style={{ color: "#cf3339" }} />
          </div>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
            Setting up your workspace...
          </p>
        </div>
      </div>
    );
  }

  // Error/system surfaces must render even while the firm profile is
  // incomplete — otherwise the gate swallows /403 and /500 and the admin
  // can never see the real error page (audit §6.1 finding #1). The 404
  // catch-all has no fixed path so the gate still takes precedence there.
  const allowedWhileIncomplete = ["/getting-started", "/profile", "/403", "/500"];
  const hasBrands = Array.isArray(brands) && brands.length > 0;
  const marketingOsAllowed =
    location.startsWith("/marketing/") && (marketingOsActive || hasBrands);

  if (
    data &&
    !data.firmProfileComplete &&
    !allowedWhileIncomplete.includes(location) &&
    !marketingOsAllowed
  ) {
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
                    onClick={() =>
                      document.dispatchEvent(
                        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                      )
                    }
                    className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-accent"
                    style={{
                      borderColor: "var(--lux-border)",
                      color: "var(--lux-text-secondary)",
                    }}
                    title="Search (⌘K)"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Search</span>
                    <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
                      ⌘K
                    </kbd>
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
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>
              </header>
              <main
                className="flex-1 overflow-y-auto"
                style={{ background: "var(--lux-bg)" }}
              >
                <Suspense fallback={<LazyFallback />}>
                  <GettingStartedPage />
                </Suspense>
              </main>
              <div
                className="flex items-center gap-2 px-4 py-2.5 border-t"
                style={{
                  background: "rgba(207,51,57,0.06)",
                  borderColor: "var(--lux-border)",
                }}
                data-testid="banner-firm-profile-incomplete"
              >
                <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "#cf3339" }} />
                <span className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                  Complete your firm profile to unlock all features
                </span>
              </div>
            </div>
          </div>
          <HelpPanel />
          <CherryAssist />
          <CommandPalette />
        </SidebarProvider>
      </div>
    );
  }

  return <>{children}</>;
}

export default AdminSetupGate;
