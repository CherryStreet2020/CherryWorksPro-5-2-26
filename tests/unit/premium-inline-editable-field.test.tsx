// @vitest-environment jsdom
/**
 * InlineEditableField render tests (task #150).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { InlineEditableField } from "@/components/marketing-os/premium/inline-editable-field";

afterEach(cleanup);

describe("InlineEditableField (render)", () => {
  it("renders the value as a button trigger when idle", () => {
    render(<InlineEditableField value="Acme Co" />);
    const trigger = screen.getByTestId("inline-editable-trigger");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Acme Co");
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("falls back to the placeholder text when value is empty", () => {
    render(<InlineEditableField value="" placeholder="Click to edit" />);
    expect(screen.getByTestId("inline-editable-trigger")).toHaveTextContent(
      "Click to edit",
    );
  });

  it("uses ariaLabel when provided, else placeholder", () => {
    const { rerender } = render(
      <InlineEditableField value="X" placeholder="Edit name" />,
    );
    expect(screen.getByTestId("inline-editable-trigger")).toHaveAttribute(
      "aria-label",
      "Edit name",
    );
    rerender(
      <InlineEditableField
        value="X"
        placeholder="Edit name"
        ariaLabel="Brand display name"
      />,
    );
    expect(screen.getByTestId("inline-editable-trigger")).toHaveAttribute(
      "aria-label",
      "Brand display name",
    );
  });

  it("switches to an input on click and commits new value on Enter", () => {
    const onChange = vi.fn();
    render(<InlineEditableField value="old" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("inline-editable-trigger"));
    const input = screen.getByTestId("inline-editable-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("new");
    expect(screen.getByTestId("inline-editable-trigger")).toBeInTheDocument();
  });

  it("cancels edit on Escape without calling onChange", () => {
    const onChange = vi.fn();
    render(<InlineEditableField value="old" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("inline-editable-trigger"));
    const input = screen.getByTestId("inline-editable-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "scratch" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("inline-editable-trigger")).toHaveTextContent("old");
  });

  it("commits via blur and skips onChange when value is unchanged", () => {
    const onChange = vi.fn();
    render(<InlineEditableField value="same" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("inline-editable-trigger"));
    const input = screen.getByTestId("inline-editable-input") as HTMLInputElement;
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
