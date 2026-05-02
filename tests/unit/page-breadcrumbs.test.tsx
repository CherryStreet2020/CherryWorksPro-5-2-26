// @vitest-environment jsdom
/**
 * PageBreadcrumbs render tests (task #205).
 *
 * Locks in the DOM contract used across the 25+ pages that consume the
 * shared `PageBreadcrumbs` component: data-testids, separator structure,
 * and the Dashboard back-button affordance.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import {
  PageBreadcrumbs,
  type PageBreadcrumbItem,
} from "@/components/page-breadcrumbs";

afterEach(cleanup);

function getSeparators(wrapper: HTMLElement) {
  return Array.from(wrapper.children).filter(
    (child) => child.tagName === "SPAN" && child.textContent === "/",
  );
}

describe("PageBreadcrumbs", () => {
  it("renders Dashboard back button + group + page by default", () => {
    render(<PageBreadcrumbs group="Reports" page="Profitability" />);

    const wrapper = screen.getByTestId("breadcrumbs");
    expect(wrapper).toBeInTheDocument();

    const dashboard = screen.getByTestId("button-crumb-dashboard");
    expect(dashboard.tagName).toBe("A");
    expect(dashboard).toHaveAttribute("href", "/");
    expect(dashboard.textContent).toContain("Dashboard");
    // Back arrow icon is rendered as an inline SVG by lucide-react.
    // lucide-react adds a `lucide-arrow-left` class on the rendered svg.
    const arrowSvg = dashboard.querySelector("svg.lucide-arrow-left");
    expect(arrowSvg).not.toBeNull();

    // Dashboard back-button must be the first crumb in the wrapper.
    const firstCrumb = wrapper.querySelector("a, button, span");
    expect(firstCrumb).toBe(dashboard);

    // Group is rendered as a plain span (no href, no onClick).
    expect(within(wrapper).getByText("Reports").tagName).toBe("SPAN");
    // Current page is the trailing label.
    expect(within(wrapper).getByText("Profitability").tagName).toBe("SPAN");

    // One "/" separator per leading item (dashboard + group = 2).
    expect(getSeparators(wrapper)).toHaveLength(2);
  });

  it("omits the Dashboard back button when showDashboard is false", () => {
    render(
      <PageBreadcrumbs group="Settings" page="Team" showDashboard={false} />,
    );
    expect(
      screen.queryByTestId("button-crumb-dashboard"),
    ).not.toBeInTheDocument();
    // Only the group precedes the page → exactly one separator.
    expect(getSeparators(screen.getByTestId("breadcrumbs"))).toHaveLength(1);
  });

  it("passes custom testId values through to rendered link/button items", () => {
    const items: PageBreadcrumbItem[] = [
      {
        label: "Linked Crumb",
        href: "/somewhere",
        testId: "link-breadcrumb-custom",
      },
      {
        label: "Clickable Crumb",
        onClick: () => {},
        testId: "button-breadcrumb-custom",
      },
    ];
    render(<PageBreadcrumbs page="Detail" items={items} />);

    const link = screen.getByTestId("link-breadcrumb-custom");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/somewhere");

    const button = screen.getByTestId("button-breadcrumb-custom");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });

  it("renders the multi-segment items form used by admin-data-console", () => {
    // Mirrors the items array assembled in `admin-data-console.tsx` for
    // an entity + record view (e.g. /admin/data/clients/<id>).
    const items: PageBreadcrumbItem[] = [
      {
        label: "Data Console",
        onClick: () => {},
        testId: "link-breadcrumb-data-console",
      },
      {
        label: "Clients",
        onClick: () => {},
        testId: "link-breadcrumb-0",
      },
    ];
    render(
      <PageBreadcrumbs page="abc12345..." items={items} className="mb-4" />,
    );

    const wrapper = screen.getByTestId("breadcrumbs");
    expect(wrapper.className).toContain("mb-4");

    // Dashboard back button is still present (default showDashboard).
    expect(screen.getByTestId("button-crumb-dashboard")).toBeInTheDocument();
    expect(
      screen.getByTestId("link-breadcrumb-data-console").tagName,
    ).toBe("BUTTON");
    expect(screen.getByTestId("link-breadcrumb-0").tagName).toBe("BUTTON");

    // Trailing page label.
    expect(within(wrapper).getByText("abc12345...").tagName).toBe("SPAN");

    // Dashboard + 2 custom items = 3 separators.
    expect(getSeparators(wrapper)).toHaveLength(3);
  });
});
