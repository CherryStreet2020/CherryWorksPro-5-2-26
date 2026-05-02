// @vitest-environment jsdom
/**
 * SectionCard render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SectionCard } from "@/components/marketing-os/premium/section-card";

afterEach(cleanup);

describe("SectionCard (render)", () => {
  it("renders the title, subtitle, icon, and children body", () => {
    render(
      <SectionCard
        icon={<svg data-testid="section-icon" />}
        title="Brand identity"
        subtitle="Logo, colors, signature"
      >
        <div data-testid="body">child content</div>
      </SectionCard>,
    );
    expect(screen.getByTestId("premium-section-card")).toBeInTheDocument();
    expect(screen.getByText("Brand identity")).toBeInTheDocument();
    expect(screen.getByText("Logo, colors, signature")).toBeInTheDocument();
    expect(screen.getByTestId("section-icon")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toHaveTextContent("child content");
  });

  it("renders without subtitle or icon when omitted", () => {
    render(
      <SectionCard title="Plain section">
        <span>only body</span>
      </SectionCard>,
    );
    expect(screen.getByText("Plain section")).toBeInTheDocument();
    expect(screen.getByText("only body")).toBeInTheDocument();
  });

  it("forwards arbitrary HTML attributes (rest props) to the root element", () => {
    render(
      <SectionCard title="t" data-extra="yes" id="my-card">
        body
      </SectionCard>,
    );
    const root = screen.getByTestId("premium-section-card");
    expect(root).toHaveAttribute("data-extra", "yes");
    expect(root).toHaveAttribute("id", "my-card");
  });
});
