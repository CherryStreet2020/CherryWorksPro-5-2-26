// @vitest-environment jsdom
/**
 * Task #253: The Outgoing email health panel header surfaces a small
 * "X sends silenced (Y active)" summary next to the existing failure
 * count, with hover text clarifying that silenced sends are not counted
 * as transport errors.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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

type TransportErrorsBody = {
  totalSinceBoot: number;
  windowMs: number;
  windowCount: number;
  byTransport: Array<{
    transport: string;
    totalSinceBoot: number;
    windowCount: number;
    lastError: { ts: number; orgId: string; errorCode: string } | null;
  }>;
  recent: Array<{
    ts: number;
    orgId: string;
    transport: string;
    errorCode: string;
    recipient: string | null;
  }>;
  threshold: { perHour: number; breached: boolean };
  alertActionUrl: string;
  alertThresholdPerHour: number;
};

type MaskedSuppressionsBody = {
  entries: Array<{
    orgId: string;
    hash: string;
    maskedRecipient: string;
    reason: string;
    addedAt: number;
    addedBy: string | null;
    suppressedSends: number;
    lastSuppressedAt: number | null;
  }>;
  count: number;
  suppressedSendsSinceBoot: number;
  suppressedSendsByTransport: Record<string, number>;
};

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

function mockEndpoints(opts: {
  transport: TransportErrorsBody;
  suppressions: MaskedSuppressionsBody;
}) {
  fetchMock.mockImplementation(async (input) => {
    const url = urlOf(input);
    if (url.includes("/api/admin/email/transport-errors")) {
      return jsonResponse(opts.transport);
    }
    if (url.includes("/api/admin/email/masked-suppressions")) {
      return jsonResponse(opts.suppressions);
    }
    return jsonResponse({});
  });
}

const baseTransport: TransportErrorsBody = {
  totalSinceBoot: 0,
  windowMs: 3_600_000,
  windowCount: 2,
  byTransport: [],
  recent: [],
  threshold: { perHour: 10, breached: false },
  alertActionUrl: "/runbook",
  alertThresholdPerHour: 10,
};

describe("EmailTransportHealthPanel suppressed-send summary (task #253)", () => {
  it("renders the silenced-sends count and active-suppressions count in the header", async () => {
    mockEndpoints({
      transport: baseTransport,
      suppressions: {
        entries: [
          { orgId: "o", hash: "a", maskedRecipient: "a***", reason: "x", addedAt: 1, addedBy: null, suppressedSends: 5, lastSuppressedAt: 2 },
          { orgId: "o", hash: "b", maskedRecipient: "b***", reason: "x", addedAt: 1, addedBy: null, suppressedSends: 2, lastSuppressedAt: 2 },
          { orgId: "o", hash: "c", maskedRecipient: "c***", reason: "x", addedAt: 1, addedBy: null, suppressedSends: 0, lastSuppressedAt: null },
        ],
        count: 3,
        suppressedSendsSinceBoot: 7,
        suppressedSendsByTransport: { smtp: 5, graph: 2 },
      },
    });

    
    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const summary = await screen.findByTestId("text-email-health-suppressed-summary");
    expect(summary.textContent).toMatch(/7\s*sends silenced/);
    expect(summary.textContent).toMatch(/3\s*active/);
    expect(screen.getByTestId("text-email-health-suppressed-sends").textContent).toBe("7");
    expect(screen.getByTestId("text-email-health-suppressed-active").textContent).toBe("3");
  });

  it("uses singular 'send' when exactly one send was silenced", async () => {
    mockEndpoints({
      transport: baseTransport,
      suppressions: {
        entries: [
          { orgId: "o", hash: "a", maskedRecipient: "a***", reason: "x", addedAt: 1, addedBy: null, suppressedSends: 1, lastSuppressedAt: 2 },
        ],
        count: 1,
        suppressedSendsSinceBoot: 1,
        suppressedSendsByTransport: { smtp: 1 },
      },
    });

    
    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const summary = await screen.findByTestId("text-email-health-suppressed-summary");
    expect(summary.textContent).toMatch(/1\s*send silenced/);
    expect(summary.textContent).not.toMatch(/sends silenced/);
  });

  it("explains via tooltip that silenced sends are not counted as transport errors", async () => {
    mockEndpoints({
      transport: baseTransport,
      suppressions: {
        entries: [],
        count: 0,
        suppressedSendsSinceBoot: 0,
        suppressedSendsByTransport: {},
      },
    });

    
    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const summary = await screen.findByTestId("text-email-health-suppressed-summary");
    const title = summary.getAttribute("title") ?? "";
    expect(title.toLowerCase()).toContain("silenced");
    expect(title.toLowerCase()).toContain("not counted");
    expect(title.toLowerCase()).toContain("transport error");
  });

  it("shows a spike warning state when the silenced-send threshold is breached and links to the Suppressed tab", async () => {
    mockEndpoints({
      transport: baseTransport,
      suppressions: {
        entries: [
          { orgId: "o", hash: "a", maskedRecipient: "a***@e***.com (#a000)", reason: "x", addedAt: 1, addedBy: null, suppressedSends: 5, lastSuppressedAt: 2 },
        ],
        count: 1,
        suppressedSendsSinceBoot: 42,
        suppressedSendsByTransport: { smtp: 42 },
        windowMs: 3_600_000,
        suppressedSendsWindowCount: 30,
        suppressedSendsThreshold: { perHour: 25, breached: true },
      } as MaskedSuppressionsBody,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const summary = await screen.findByTestId("text-email-health-suppressed-summary");
    const spike = await screen.findByTestId("badge-email-health-silenced-spike");
    expect(spike.textContent).toMatch(/30/);
    expect(spike.textContent).toMatch(/25/);
    const title = summary.getAttribute("title") ?? "";
    expect(title.toLowerCase()).toContain("spike");
    expect(title.toLowerCase()).toContain("suppressed tab");

    // Clicking opens the drilldown on the Suppressed tab.
    (summary as HTMLButtonElement).click();
    const tab = await screen.findByTestId("tab-failure-drilldown-suppressed");
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("does not render the summary while suppressions data is still loading", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes("/api/admin/email/transport-errors")) {
        return jsonResponse(baseTransport);
      }
      // Never resolve the suppressions request.
      return new Promise<Response>(() => {});
    });

    
    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("text-email-health-window-count")).toBeTruthy();
    });
    expect(screen.queryByTestId("text-email-health-suppressed-summary")).toBeNull();
  });
});
