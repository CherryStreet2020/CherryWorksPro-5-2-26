// @vitest-environment jsdom
// Task #310 — pins the operator-only cross-org breakdown on the
// "Email failure alerts" dashboard card. The breakdown is gated by
// the API's `isPlatformOperator` flag plus client-side checks on
// `data.byOrg` / `data.orgNames`. These tests guard the React surface
// so a future refactor can't either:
//   (a) silently drop the operator affordance, or
//   (b) accidentally leak the "Show affected orgs" toggle to a
//       tenant ADMIN payload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";

type QueryArgs = { queryKey: unknown[] };
let queryResponse: { data: unknown; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: null,
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (_args: QueryArgs) => queryResponse,
  keepPreviousData: undefined,
}));

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

import { EmailFailureAlertsCard } from "@/components/email-failure-alerts-card";

const NOW = Date.now();

const OPERATOR_PAYLOAD = {
  alerts: [
    {
      ts: NOW - 60_000,
      failureCount: 42,
      threshold: 10,
      thresholdBreached: true,
      topTransport: "smtp",
      topErrorCode: "550_blocked",
      delivered: true,
      byOrg: {
        "org-aaa": {
          failureCount: 30,
          topTransport: "smtp",
          topErrorCode: "550_blocked",
        },
        "org-bbb": {
          failureCount: 12,
          topTransport: "graph",
          topErrorCode: "auth_failed",
        },
      },
    },
  ],
  total: 1,
  limit: 10,
  offset: 0,
  from: null,
  to: null,
  retentionDays: 30,
  thresholdPerHour: 10,
  isPlatformOperator: true,
  orgNames: {
    "org-aaa": "Acme Industries",
    "org-bbb": "Beta Holdings",
  },
};

const TENANT_ADMIN_PAYLOAD = {
  alerts: [
    {
      ts: NOW - 60_000,
      failureCount: 42,
      threshold: 10,
      thresholdBreached: true,
      topTransport: "smtp",
      topErrorCode: "550_blocked",
      delivered: true,
      // No `byOrg` for tenant ADMINs — the API omits it.
    },
  ],
  total: 1,
  limit: 10,
  offset: 0,
  from: null,
  to: null,
  retentionDays: 30,
  thresholdPerHour: 10,
  isPlatformOperator: false,
};

beforeEach(() => {
  queryResponse = { data: undefined, isLoading: false, error: null };
});

afterEach(() => {
  cleanup();
});

describe("EmailFailureAlertsCard operator-only breakdown (Task #310)", () => {
  it("renders the per-org expand/collapse for platform operators with org name, failure count, top transport, and top error", () => {
    queryResponse = {
      data: OPERATOR_PAYLOAD,
      isLoading: false,
      error: null,
    };

    render(<EmailFailureAlertsCard />);

    const toggle = screen.getByTestId(
      "button-email-failure-alert-toggle-orgs-0",
    );
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent(/Show affected orgs \(2\)/i);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed by default — the table must not be in the DOM yet.
    expect(
      screen.queryByTestId("details-email-failure-alert-orgs-0"),
    ).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(/Hide affected orgs \(2\)/i);

    const details = screen.getByTestId("details-email-failure-alert-orgs-0");
    expect(details).toBeInTheDocument();

    // First row — the higher-failure org sorts first.
    const rowAaa = screen.getByTestId(
      "row-email-failure-alert-org-0-org-aaa",
    );
    const aaaScope = within(rowAaa);
    expect(
      aaaScope.getByTestId("text-email-failure-alert-org-name-0-org-aaa"),
    ).toHaveTextContent("Acme Industries");
    expect(
      aaaScope.getByTestId("text-email-failure-alert-org-count-0-org-aaa"),
    ).toHaveTextContent("30");
    expect(rowAaa).toHaveTextContent(/SMTP/);
    expect(rowAaa).toHaveTextContent("550_blocked");

    // Second row — secondary org with the friendlier transport label.
    const rowBbb = screen.getByTestId(
      "row-email-failure-alert-org-0-org-bbb",
    );
    const bbbScope = within(rowBbb);
    expect(
      bbbScope.getByTestId("text-email-failure-alert-org-name-0-org-bbb"),
    ).toHaveTextContent("Beta Holdings");
    expect(
      bbbScope.getByTestId("text-email-failure-alert-org-count-0-org-bbb"),
    ).toHaveTextContent("12");
    expect(rowBbb).toHaveTextContent(/Microsoft 365/);
    expect(rowBbb).toHaveTextContent("auth_failed");

    // Sort order: org-aaa (30 failures) appears before org-bbb (12).
    const orderedRows = details.querySelectorAll(
      '[data-testid^="row-email-failure-alert-org-0-"]',
    );
    expect(orderedRows).toHaveLength(2);
    expect(orderedRows[0]).toBe(rowAaa);
    expect(orderedRows[1]).toBe(rowBbb);

    // Collapsing again removes the table from the DOM.
    fireEvent.click(toggle);
    expect(
      screen.queryByTestId("details-email-failure-alert-orgs-0"),
    ).toBeNull();
  });

  it("does not render the toggle for tenant ADMINs (no byOrg, isPlatformOperator=false)", () => {
    queryResponse = {
      data: TENANT_ADMIN_PAYLOAD,
      isLoading: false,
      error: null,
    };

    render(<EmailFailureAlertsCard />);

    // The alert row itself still renders…
    expect(
      screen.getByTestId("row-email-failure-alert-0"),
    ).toBeInTheDocument();
    // …but the operator-only affordance must not be in the DOM at all.
    expect(
      screen.queryByTestId("button-email-failure-alert-toggle-orgs-0"),
    ).toBeNull();
    expect(
      screen.queryByTestId("details-email-failure-alert-orgs-0"),
    ).toBeNull();
  });

  it("does not render the toggle when the operator flag is true but byOrg is empty", () => {
    queryResponse = {
      data: {
        ...OPERATOR_PAYLOAD,
        alerts: [
          {
            ...OPERATOR_PAYLOAD.alerts[0],
            byOrg: {},
          },
        ],
      },
      isLoading: false,
      error: null,
    };

    render(<EmailFailureAlertsCard />);

    expect(
      screen.queryByTestId("button-email-failure-alert-toggle-orgs-0"),
    ).toBeNull();
  });
});
