// @vitest-environment jsdom
/**
 * StatusRibbon render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  StatusRibbon,
  type LifecycleStage,
} from "@/components/marketing-os/premium/status-ribbon";

afterEach(cleanup);

const STAGES: Array<{ stage: LifecycleStage; label: string }> = [
  { stage: "lead", label: "Lead" },
  { stage: "mql", label: "MQL" },
  { stage: "sql", label: "SQL" },
  { stage: "opportunity", label: "Opportunity" },
  { stage: "customer", label: "Customer" },
  { stage: "evangelist", label: "Evangelist" },
];

describe("StatusRibbon (render)", () => {
  it.each(STAGES)("renders the $label label for stage=$stage", ({ stage, label }) => {
    render(<StatusRibbon stage={stage} />);
    const ribbon = screen.getByTestId(`premium-status-ribbon-${stage}`);
    expect(ribbon).toBeInTheDocument();
    expect(ribbon).toHaveTextContent(label);
  });

  it("applies the per-stage gradient via inline backgroundImage", () => {
    render(<StatusRibbon stage="evangelist" />);
    const ribbon = screen.getByTestId("premium-status-ribbon-evangelist");
    expect(ribbon.style.backgroundImage).toContain("linear-gradient");
  });
});
