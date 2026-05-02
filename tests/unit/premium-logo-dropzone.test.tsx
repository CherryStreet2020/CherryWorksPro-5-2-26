// @vitest-environment jsdom
/**
 * LogoDropzone render tests (task #150).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LogoDropzone } from "@/components/marketing-os/premium/logo-dropzone";

afterEach(cleanup);

describe("LogoDropzone (render)", () => {
  it("renders the label, dropzone target, hidden file input, and URL input", () => {
    render(<LogoDropzone label="Brand logo" />);
    expect(screen.getByText("Brand logo")).toBeInTheDocument();
    const dropzone = screen.getByTestId("dropzone-target");
    expect(dropzone).toHaveAttribute("role", "button");
    expect(dropzone).toHaveAttribute("tabIndex", "0");
    expect(screen.getByTestId("input-logo-file")).toBeInTheDocument();
    expect(screen.getByTestId("input-logo-url")).toBeInTheDocument();
  });

  it("shows the empty-state hint when no value is set", () => {
    render(<LogoDropzone />);
    expect(
      screen.getByText("Drop, click, or paste a URL"),
    ).toBeInTheDocument();
  });

  it("renders the preview <img> and remove button when a value is set", () => {
    const onChange = vi.fn();
    render(
      <LogoDropzone
        value="https://cdn.example.com/logo.png"
        onChange={onChange}
      />,
    );
    const img = screen.getByAltText("logo preview") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://cdn.example.com/logo.png");
    const removeBtn = screen.getByTestId("button-remove-logo");
    expect(removeBtn).toHaveAttribute("aria-label", "Remove logo");
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("surfaces a friendly error when a non-URL string is submitted", () => {
    render(<LogoDropzone />);
    const urlInput = screen.getByTestId("input-logo-url") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "not a url" } });
    fireEvent.click(screen.getByTestId("button-use-url"));
    expect(screen.getByTestId("logo-upload-error")).toHaveTextContent(
      /https:\/\//,
    );
  });
});
