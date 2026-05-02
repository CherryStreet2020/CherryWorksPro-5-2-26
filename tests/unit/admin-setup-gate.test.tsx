// @vitest-environment jsdom
// Task #261 — pins the firm-setup gate bypass added in Task #245:
// /marketing/* must render when the org has brands or an active
// `marketing_os` entitlement, and other routes must still be gated.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { render, cleanup, screen } from "@testing-library/react";

const locationStub = { current: "/" };

vi.mock("wouter", () => ({
  useLocation: () => [locationStub.current, () => {}],
}));

type QueryArgs = { queryKey: unknown[] };
const queryResponses = new Map<string, { data: unknown; isLoading: boolean }>();

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: QueryArgs) => {
    const key = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey);
    return queryResponses.get(key) ?? { data: undefined, isLoading: false };
  },
}));

const entitlementStub = { current: { active: false } };
vi.mock("@/lib/entitlements", () => ({
  useEntitlement: (_name: string) => entitlementStub.current,
}));

// Stub the heavy app shell — the gate logic only cares that the firm
// profile banner appears (or doesn't).
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => <button data-testid="sidebar-trigger" />,
}));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => <nav data-testid="app-sidebar" />,
}));
vi.mock("@/components/help-panel", () => ({ HelpPanel: () => null }));
vi.mock("@/components/cherry-assist", () => ({ CherryAssist: () => null }));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/BrandSwitcher", () => ({ BrandSwitcher: () => null }));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: ComponentProps<"div">) => <div {...props} />,
}));
vi.mock("@/lib/help-context", () => ({ openHelpPanel: () => {} }));
vi.mock("@/pages/getting-started", () => ({
  default: () => <div data-testid="page-getting-started">Set Up Your Firm</div>,
}));

import { AdminSetupGate } from "@/components/admin-setup-gate";

function setQueries({
  firmProfileComplete,
  brands,
}: {
  firmProfileComplete: boolean;
  brands: Array<{ id: string }> | undefined;
}) {
  queryResponses.clear();
  queryResponses.set("/api/implementation-status", {
    data: { firmProfileComplete },
    isLoading: false,
  });
  queryResponses.set("/api/brands", { data: brands, isLoading: false });
}

beforeEach(() => {
  locationStub.current = "/";
  entitlementStub.current = { active: false };
  queryResponses.clear();
});

afterEach(() => {
  cleanup();
});

describe("AdminSetupGate firm-setup bypass (Task 245 / 261)", () => {
  it("renders /marketing/* children when the org has brands but the firm profile is incomplete", () => {
    locationStub.current = "/marketing/contacts";
    setQueries({ firmProfileComplete: false, brands: [{ id: "brand-1" }] });

    render(
      <AdminSetupGate>
        <div data-testid="marketing-page">Marketing OS</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("marketing-page")).toBeInTheDocument();
    expect(screen.queryByTestId("banner-firm-profile-incomplete")).toBeNull();
    expect(screen.queryByTestId("page-getting-started")).toBeNull();
  });

  it("renders /marketing/* children when the marketing_os entitlement is active even with no brands", () => {
    locationStub.current = "/marketing/campaigns";
    entitlementStub.current = { active: true };
    setQueries({ firmProfileComplete: false, brands: [] });

    render(
      <AdminSetupGate>
        <div data-testid="marketing-page">Marketing OS</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("marketing-page")).toBeInTheDocument();
    expect(screen.queryByTestId("banner-firm-profile-incomplete")).toBeNull();
  });

  it("redirects non-marketing routes to the Set Up Your Firm view even when the org has brands", () => {
    locationStub.current = "/clients";
    setQueries({ firmProfileComplete: false, brands: [{ id: "brand-1" }] });

    render(
      <AdminSetupGate>
        <div data-testid="clients-page">Clients</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("banner-firm-profile-incomplete")).toBeInTheDocument();
    expect(screen.queryByTestId("clients-page")).toBeNull();
  });

  it("redirects non-marketing routes when the marketing_os entitlement is active but the firm profile is incomplete", () => {
    locationStub.current = "/dashboard";
    entitlementStub.current = { active: true };
    setQueries({ firmProfileComplete: false, brands: [] });

    render(
      <AdminSetupGate>
        <div data-testid="dashboard-page">Dashboard</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("banner-firm-profile-incomplete")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
  });

  it("blocks /marketing/* when the org has no brands and no marketing_os entitlement", () => {
    locationStub.current = "/marketing/contacts";
    setQueries({ firmProfileComplete: false, brands: [] });

    render(
      <AdminSetupGate>
        <div data-testid="marketing-page">Marketing OS</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("banner-firm-profile-incomplete")).toBeInTheDocument();
    expect(screen.queryByTestId("marketing-page")).toBeNull();
  });

  it("renders children normally once the firm profile is complete", () => {
    locationStub.current = "/clients";
    setQueries({ firmProfileComplete: true, brands: [] });

    render(
      <AdminSetupGate>
        <div data-testid="clients-page">Clients</div>
      </AdminSetupGate>,
    );

    expect(screen.getByTestId("clients-page")).toBeInTheDocument();
    expect(screen.queryByTestId("banner-firm-profile-incomplete")).toBeNull();
  });
});
