// @vitest-environment jsdom
/**
 * Task #309: The Suppressed tab on the Outgoing email health drill-down
 * shows a per-reason breakdown of silenced sends sourced from
 * `suppressedSendsByReason` on the masked-suppressions endpoint, so
 * admins can tell whether bounces or complaints dominate.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { EmailTransportHealthPanel } from "@/components/email-transport-health-panel";
import { queryClient } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchImpl = (input: FetchInput, init?: FetchInit) => Promise<Response>;

const fetchMock = vi.fn<FetchImpl>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function jsonResponse(body: unknown): Response {
  const headers = new Headers({ "content-type": "application/json" });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone(): Response {
      return jsonResponse(body);
    },
  } as unknown as Response;
}

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

const baseTransport = {
  totalSinceBoot: 0,
  windowMs: 3_600_000,
  windowCount: 0,
  byTransport: [],
  recent: [],
  threshold: { perHour: 10, breached: false },
  alertActionUrl: "/runbook",
  alertThresholdPerHour: 10,
};

function mockEndpoints(suppressions: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input) => {
    const url = urlOf(input);
    if (url.includes("/api/admin/email/transport-errors")) {
      return jsonResponse(baseTransport);
    }
    if (url.includes("/api/admin/email/masked-suppressions")) {
      return jsonResponse(suppressions);
    }
    return jsonResponse({});
  });
}

async function openSuppressedTab() {
  const opener = await screen.findByTestId("text-email-health-suppressed-summary");
  fireEvent.click(opener);
}

describe("EmailTransportHealthPanel silenced-by-reason breakdown (task #309)", () => {
  it("renders per-reason counts in the Suppressed tab", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 8,
      suppressedSendsByTransport: { smtp: 6, graph: 2 },
      suppressedSendsByReason: { bounce: 5, complaint: 2, manual: 1 },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    await openSuppressedTab();

    const breakdown = await screen.findByTestId(
      "text-failure-drilldown-suppressed-by-reason",
    );
    const text = breakdown.textContent ?? "";
    expect(text).toMatch(/5\s*bounce/);
    expect(text).toMatch(/2\s*complaint/);
    expect(text).toMatch(/1\s*manual/);
    // Highest count first.
    expect(text.indexOf("bounce")).toBeLessThan(text.indexOf("complaint"));
    expect(text.indexOf("complaint")).toBeLessThan(text.indexOf("manual"));
  });

  it("hides the breakdown when no reason has any silenced sends", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 0,
      suppressedSendsByTransport: {},
      suppressedSendsByReason: {},
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    await openSuppressedTab();

    await waitFor(() => {
      expect(
        screen.queryByTestId("text-failure-drilldown-suppressed-by-reason"),
      ).toBeNull();
    });
  });

  it("tolerates an older API response that omits suppressedSendsByReason", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 3,
      suppressedSendsByTransport: { smtp: 3 },
      // suppressedSendsByReason intentionally omitted (older server).
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    await openSuppressedTab();

    await waitFor(() => {
      expect(
        screen.queryByTestId("text-failure-drilldown-suppressed-by-reason"),
      ).toBeNull();
    });
  });
});
