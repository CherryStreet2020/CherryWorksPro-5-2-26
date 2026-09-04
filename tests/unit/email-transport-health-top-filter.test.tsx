// @vitest-environment jsdom
/**
 * Task #228: error-code chip filter + sort toggle on the Top recipients tab.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

// FailureDrilldown reads its suppressions/threshold data through react-query,
// so every render needs a QueryClient (retries off so a missing endpoint fails fast).
// One client for the whole file: a fresh client on every render/rerender would
// put the component's queries back into their loading state mid-test.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function QueryWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: QueryWrapper });
import { FailureDrilldown } from "@/components/email-transport-health-panel";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

afterEach(() => cleanup());
// FailureDrilldown persists its error-code filter and Top-tab sort in
// localStorage; without a reset each test inherits the previous test's choices.
beforeEach(() => { window.localStorage.clear(); queryClient.clear(); });

const baseTs = Date.UTC(2026, 3, 22, 12, 0, 0);

const samples = [
  // alice: 3 SMTP_550 failures (highest count, oldest)
  { ts: baseTs - 5_000, orgId: "o1", transport: "smtp", errorCode: "SMTP_550", recipient: "a***@x***.com (#a)" },
  { ts: baseTs - 4_000, orgId: "o1", transport: "smtp", errorCode: "SMTP_550", recipient: "a***@x***.com (#a)" },
  { ts: baseTs - 3_000, orgId: "o1", transport: "smtp", errorCode: "SMTP_550", recipient: "a***@x***.com (#a)" },
  // bob: 2 TOKEN_REFRESH_FAILED failures
  { ts: baseTs - 2_000, orgId: "o2", transport: "graph", errorCode: "TOKEN_REFRESH_FAILED", recipient: "b***@y***.com (#b)" },
  { ts: baseTs - 1_000, orgId: "o2", transport: "graph", errorCode: "TOKEN_REFRESH_FAILED", recipient: "b***@y***.com (#b)" },
  // carol: 1 SMTP_550 failure (most recent overall)
  { ts: baseTs, orgId: "o3", transport: "smtp", errorCode: "SMTP_550", recipient: "c***@z***.com (#c)" },
];

function openTopTab() {
  fireEvent.click(screen.getByTestId("tab-failure-drilldown-top"));
}

describe("FailureDrilldown Top recipients filter & sort (task #228)", () => {
  it("renders an error code chip for each distinct code present in the scoped samples", () => {
    render(<FailureDrilldown recent={samples} transportFilter={null} onClear={() => {}} />);
    openTopTab();

    expect(screen.getByTestId("chip-top-error-code-all")).toBeTruthy();
    expect(screen.getByTestId("chip-top-error-code-SMTP_550")).toBeTruthy();
    expect(screen.getByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED")).toBeTruthy();
  });

  it("filters the list to recipients hit by the chosen error code", () => {
    render(<FailureDrilldown recent={samples} transportFilter={null} onClear={() => {}} />);
    openTopTab();

    fireEvent.click(screen.getByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED"));

    const list = screen.getByTestId("list-failure-drilldown-top");
    const rows = within(list).getAllByTestId(/^row-top-recipient-/);
    expect(rows).toHaveLength(1);
    expect(
      within(rows[0]).getByTestId("text-top-recipient-address-0").textContent,
    ).toContain("b***@y***.com");
  });

  it("toggles between Most failures and Most recent ordering", () => {
    render(<FailureDrilldown recent={samples} transportFilter={null} onClear={() => {}} />);
    openTopTab();

    let rows = within(screen.getByTestId("list-failure-drilldown-top")).getAllByTestId(
      /^row-top-recipient-/,
    );
    expect(
      within(rows[0]).getByTestId("text-top-recipient-address-0").textContent,
    ).toContain("a***@x***.com");

    fireEvent.click(screen.getByTestId("button-top-sort-recent"));
    rows = within(screen.getByTestId("list-failure-drilldown-top")).getAllByTestId(
      /^row-top-recipient-/,
    );
    expect(
      within(rows[0]).getByTestId("text-top-recipient-address-0").textContent,
    ).toContain("c***@z***.com");

    fireEvent.click(screen.getByTestId("button-top-sort-count"));
    rows = within(screen.getByTestId("list-failure-drilldown-top")).getAllByTestId(
      /^row-top-recipient-/,
    );
    expect(
      within(rows[0]).getByTestId("text-top-recipient-address-0").textContent,
    ).toContain("a***@x***.com");
  });

  it("clears a persisted error-code chip that no longer matches any row, instead of showing an empty list", () => {
    // The chip selection persists in localStorage. When the incoming rows no
    // longer contain that code at all, the component drops the stale filter
    // (see the reconcile effect on topErrorCodes) so the operator is never left
    // staring at an empty Top tab because of yesterday's filter.
    const { rerender } = render(
      <FailureDrilldown recent={samples} transportFilter={null} onClear={() => {}} />,
    );
    openTopTab();
    fireEvent.click(screen.getByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED"));
    expect(screen.queryByTestId("text-failure-drilldown-top-empty")).toBeNull();
    expect(screen.getByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED").getAttribute("aria-pressed")).toBe("true");

    const onlySmtp = samples.filter((s) => s.errorCode === "SMTP_550");
    rerender(<FailureDrilldown recent={onlySmtp} transportFilter={null} onClear={() => {}} />);

    // Filter reset: the "all" chip is active again, the SMTP rows are visible,
    // and no filtered empty state is rendered.
    expect(screen.getByTestId("chip-top-error-code-all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED")).toBeNull();
    expect(screen.queryByTestId("text-failure-drilldown-top-empty")).toBeNull();
    const rows = within(screen.getByTestId("list-failure-drilldown-top")).getAllByTestId(
      /^row-top-recipient-/,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("email-failure-drilldown:error-code")).toBeNull();
  });
});
