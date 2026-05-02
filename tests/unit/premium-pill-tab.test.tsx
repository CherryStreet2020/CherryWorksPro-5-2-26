// @vitest-environment jsdom
/**
 * PillTab render tests (task #150).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PillTab } from "@/components/marketing-os/premium/pill-tab";

afterEach(cleanup);

describe("PillTab (render)", () => {
  it("renders one trigger per item with their labels", () => {
    render(
      <PillTab
        value="leads"
        onValueChange={() => {}}
        items={[
          { value: "leads", label: "Leads" },
          { value: "mql", label: "MQL" },
          { value: "sql", label: "SQL" },
        ]}
      />,
    );
    expect(screen.getByTestId("premium-pill-tab-list")).toBeInTheDocument();
    expect(screen.getByTestId("premium-pill-tab-leads")).toHaveTextContent(
      "Leads",
    );
    expect(screen.getByTestId("premium-pill-tab-mql")).toHaveTextContent("MQL");
    expect(screen.getByTestId("premium-pill-tab-sql")).toHaveTextContent("SQL");
  });

  it("marks the active item with data-state=active", () => {
    render(
      <PillTab
        value="mql"
        onValueChange={() => {}}
        items={[
          { value: "leads", label: "Leads" },
          { value: "mql", label: "MQL" },
        ]}
      />,
    );
    expect(screen.getByTestId("premium-pill-tab-mql")).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByTestId("premium-pill-tab-leads")).toHaveAttribute(
      "data-state",
      "inactive",
    );
  });

  it("invokes onValueChange when an inactive pill is activated", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PillTab
        value="leads"
        onValueChange={onValueChange}
        items={[
          { value: "leads", label: "Leads" },
          { value: "mql", label: "MQL" },
        ]}
      />,
    );
    // Radix Tabs activates on pointerdown, not click — userEvent dispatches both.
    await user.click(screen.getByTestId("premium-pill-tab-mql"));
    expect(onValueChange).toHaveBeenCalledWith("mql");
  });
});
