// @vitest-environment jsdom
/**
 * Task #228: error-code chip filter + sort toggle on the Top recipients tab.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { FailureDrilldown } from "@/components/email-transport-health-panel";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

afterEach(() => cleanup());

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

  it("shows the filter-specific empty state with a clear-filter action when a chip hides every row", () => {
    // Start with samples covering both codes; pick TOKEN_REFRESH_FAILED, then
    // rerender with samples that only contain SMTP_550 — the persisted chip
    // selection now matches nothing and the filtered empty state should appear.
    const { rerender } = render(
      <FailureDrilldown recent={samples} transportFilter={null} onClear={() => {}} />,
    );
    openTopTab();
    fireEvent.click(screen.getByTestId("chip-top-error-code-TOKEN_REFRESH_FAILED"));
    expect(screen.queryByTestId("text-failure-drilldown-top-empty")).toBeNull();

    const onlySmtp = samples.filter((s) => s.errorCode === "SMTP_550");
    rerender(<FailureDrilldown recent={onlySmtp} transportFilter={null} onClear={() => {}} />);

    const empty = screen.getByTestId("text-failure-drilldown-top-empty");
    expect(empty.textContent).toMatch(/filter/i);
    expect(empty.textContent).toContain("TOKEN_REFRESH_FAILED");

    const clearBtn = screen.getByTestId("button-top-clear-error-code");
    fireEvent.click(clearBtn);
    expect(screen.queryByTestId("text-failure-drilldown-top-empty")).toBeNull();
    const rows = within(screen.getByTestId("list-failure-drilldown-top")).getAllByTestId(
      /^row-top-recipient-/,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
