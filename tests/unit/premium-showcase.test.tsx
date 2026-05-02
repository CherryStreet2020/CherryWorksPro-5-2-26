// @vitest-environment jsdom
/**
 * Premium showcase render-style smoke tests (task #179).
 *
 * Mounts /__premium-showcase in jsdom and exercises the live flows
 * a real visitor would touch: theme toggle, premium dialog open, and
 * pill tab switch. Complements the source-grep test in
 * `premium-showcase.test.ts`.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PremiumShowcasePage from "@/pages/__premium-showcase";
import { ThemeProvider } from "@/lib/theme";

beforeAll(() => {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});

function renderShowcase() {
  return render(
    <ThemeProvider>
      <PremiumShowcasePage />
    </ThemeProvider>,
  );
}

describe("premium showcase page (render)", () => {
  it("mounts the page with all five primitive sections", () => {
    renderShowcase();
    expect(screen.getByTestId("premium-showcase-page")).toBeInTheDocument();
    expect(screen.getByTestId("section-dialogs")).toBeInTheDocument();
    expect(screen.getByTestId("section-forms")).toBeInTheDocument();
    expect(screen.getByTestId("section-cards")).toBeInTheDocument();
    expect(screen.getByTestId("section-data")).toBeInTheDocument();
    expect(screen.getByTestId("section-tabs")).toBeInTheDocument();
  });

  it("flips the .dark class on <html> when the sun/moon toggle is clicked", () => {
    renderShowcase();
    const toggle = screen.getByTestId("button-theme-toggle");
    const initiallyDark = document.documentElement.classList.contains("dark");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(
      !initiallyDark,
    );

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(
      initiallyDark,
    );
  });

  it("opens the demo PremiumDialog and renders its title", async () => {
    renderShowcase();
    const user = userEvent.setup();

    expect(
      screen.queryByText("Compose campaign email"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("button-open-premium-dialog"));

    expect(
      await screen.findByText("Compose campaign email"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft · Acme Q2 nurture")).toBeInTheDocument();
  });

  it("moves the active PillTab when a different tab is selected", async () => {
    renderShowcase();
    const user = userEvent.setup();

    const tabs = within(screen.getByTestId("section-tabs"));
    const overview = tabs.getByTestId("premium-pill-tab-overview");
    const campaigns = tabs.getByTestId("premium-pill-tab-campaigns");

    expect(overview).toHaveAttribute("data-state", "active");
    expect(campaigns).toHaveAttribute("data-state", "inactive");

    await user.click(campaigns);

    expect(
      tabs.getByTestId("premium-pill-tab-campaigns"),
    ).toHaveAttribute("data-state", "active");
    expect(
      tabs.getByTestId("premium-pill-tab-overview"),
    ).toHaveAttribute("data-state", "inactive");
  });
});
