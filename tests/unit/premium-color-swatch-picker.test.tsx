// @vitest-environment jsdom
/**
 * ColorSwatchPicker render tests (task #150).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ColorSwatchPicker } from "@/components/marketing-os/premium/color-swatch-picker";

afterEach(cleanup);

describe("ColorSwatchPicker (render)", () => {
  it("renders the label, hex input, native picker, and 10 brand swatches", () => {
    render(<ColorSwatchPicker value="#cf3339" label="Brand color" />);
    expect(screen.getByText("Brand color")).toBeInTheDocument();
    expect(screen.getByTestId("input-color-hex")).toHaveValue("#cf3339");
    expect(screen.getByTestId("input-color-native")).toHaveAttribute(
      "aria-label",
      "Color picker",
    );
    const swatchButtons = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("data-testid")?.startsWith("swatch-") || b.tagName === "BUTTON");
    expect(swatchButtons.length).toBeGreaterThanOrEqual(10);
  });

  it("invokes onChange with the swatch hex when a swatch is clicked", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorSwatchPicker value="#cf3339" onChange={onChange} />,
    );
    const swatchButtons = container.querySelectorAll(
      'button[type="button"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(swatchButtons.length).toBe(10);
    fireEvent.click(swatchButtons[3]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("invokes onChange when the hex input changes", () => {
    const onChange = vi.fn();
    render(<ColorSwatchPicker value="#cf3339" onChange={onChange} />);
    const hex = screen.getByTestId("input-color-hex") as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });
});
