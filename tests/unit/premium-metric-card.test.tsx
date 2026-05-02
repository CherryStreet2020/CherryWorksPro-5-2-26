// @vitest-environment jsdom
/**
 * MetricCard render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricCard } from "@/components/marketing-os/premium/metric-card";

afterEach(cleanup);

describe("MetricCard (render)", () => {
  it("renders the label and value", () => {
    render(<MetricCard label="MRR" value="$12,400" />);
    expect(screen.getByTestId("premium-metric-card")).toBeInTheDocument();
    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByTestId("metric-value")).toHaveTextContent("$12,400");
    expect(screen.queryByTestId("metric-delta")).not.toBeInTheDocument();
  });

  it("renders a positive delta with `+` and a delta label", () => {
    render(
      <MetricCard label="Signups" value={1234} delta={12} deltaLabel="WoW" />,
    );
    const delta = screen.getByTestId("metric-delta");
    expect(delta).toHaveTextContent("+12% WoW");
  });

  it("renders a negative delta without a leading `+`", () => {
    render(<MetricCard label="Churn" value="2.4%" delta={-3} />);
    const delta = screen.getByTestId("metric-delta");
    expect(delta).toHaveTextContent("-3%");
    expect(delta.textContent ?? "").not.toMatch(/\+/);
  });

  it("renders a zero delta as a neutral chip with no arrow direction", () => {
    render(<MetricCard label="Flat" value={0} delta={0} />);
    const delta = screen.getByTestId("metric-delta");
    expect(delta).toHaveTextContent("0%");
  });
});
