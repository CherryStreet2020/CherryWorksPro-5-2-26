// @vitest-environment jsdom
/**
 * FreshnessDot render tests (task #150).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";

afterEach(cleanup);

const DAY_MS = 24 * 60 * 60 * 1000;

describe("FreshnessDot (render)", () => {
  it("classifies activity within 7 days as Active", () => {
    const recent = new Date(Date.now() - 2 * DAY_MS);
    render(<FreshnessDot lastActivityAt={recent} showLabel />);
    const wrapper = screen.getByTestId("premium-freshness-dot");
    expect(wrapper).toHaveAttribute("title", "Active");
    expect(wrapper).toHaveTextContent("Active");
  });

  it("classifies activity 7-30 days old as Cooling", () => {
    const cooling = new Date(Date.now() - 14 * DAY_MS);
    render(<FreshnessDot lastActivityAt={cooling} showLabel />);
    const wrapper = screen.getByTestId("premium-freshness-dot");
    expect(wrapper).toHaveAttribute("title", "Cooling");
    expect(wrapper).toHaveTextContent("Cooling");
  });

  it("classifies activity older than 30 days as Stale", () => {
    const stale = new Date(Date.now() - 90 * DAY_MS);
    render(<FreshnessDot lastActivityAt={stale} showLabel />);
    const wrapper = screen.getByTestId("premium-freshness-dot");
    expect(wrapper).toHaveAttribute("title", "Stale");
    expect(wrapper).toHaveTextContent("Stale");
  });

  it("classifies null activity as Never", () => {
    render(<FreshnessDot lastActivityAt={null} showLabel />);
    const wrapper = screen.getByTestId("premium-freshness-dot");
    expect(wrapper).toHaveAttribute("title", "Never");
    expect(wrapper).toHaveTextContent("Never");
  });

  it("hides the label when showLabel is false (default)", () => {
    render(<FreshnessDot lastActivityAt={new Date()} />);
    expect(
      screen.getByTestId("premium-freshness-dot"),
    ).not.toHaveTextContent(/Active|Cooling|Stale|Never/);
  });
});
