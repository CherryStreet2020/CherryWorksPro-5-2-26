// @vitest-environment jsdom
/**
 * PremiumDialog render tests (task #150).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";

afterEach(cleanup);

describe("PremiumDialog (render)", () => {
  it("does not render dialog content when `open` is false", () => {
    render(
      <PremiumDialog
        open={false}
        onOpenChange={() => {}}
        title="Edit brand"
      >
        <div>form body</div>
      </PremiumDialog>,
    );
    expect(screen.queryByText("Edit brand")).not.toBeInTheDocument();
    expect(screen.queryByText("form body")).not.toBeInTheDocument();
  });

  it("renders title, subtitle, body, and preview pane when open", () => {
    render(
      <PremiumDialog
        open={true}
        onOpenChange={() => {}}
        title="Edit brand"
        subtitle="Tweak colors and signature"
        preview={<div data-testid="preview-pane">PREVIEW</div>}
      >
        <div data-testid="form-body">form body</div>
      </PremiumDialog>,
    );
    expect(screen.getByText("Edit brand")).toBeInTheDocument();
    expect(screen.getByText("Tweak colors and signature")).toBeInTheDocument();
    expect(screen.getByTestId("form-body")).toBeInTheDocument();
    expect(screen.getByTestId("preview-pane")).toHaveTextContent("PREVIEW");
    expect(screen.getByText("Live preview")).toBeInTheDocument();
  });

  it("links DialogDescription via aria-describedby when subtitle is set", () => {
    render(
      <PremiumDialog
        open={true}
        onOpenChange={() => {}}
        title="T"
        subtitle="S"
      >
        body
      </PremiumDialog>,
    );
    const describedById = "premium-dialog-desc";
    const desc = document.getElementById(describedById);
    expect(desc).not.toBeNull();
    expect(desc).toHaveTextContent("S");
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <PremiumDialog open={true} onOpenChange={onOpenChange} title="T">
        body
      </PremiumDialog>,
    );
    const closeBtn = screen.getByTestId("button-premium-dialog-close");
    expect(closeBtn).toHaveAttribute("aria-label", "Close dialog");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
