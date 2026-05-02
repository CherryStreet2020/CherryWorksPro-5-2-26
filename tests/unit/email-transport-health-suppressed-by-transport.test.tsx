// @vitest-environment jsdom
/**
 * Task #274: Each transport tile in the Outgoing email health panel shows
 * a per-transport silenced-send count sourced from
 * `suppressedSendsByTransport` on the masked-suppressions endpoint, with
 * the same hover wording explaining silenced sends are not transport
 * errors.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

function mockEndpoints(suppressions: {
  entries: any[];
  count: number;
  suppressedSendsSinceBoot: number;
  suppressedSendsByTransport: Record<string, number>;
}) {
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

describe("EmailTransportHealthPanel per-transport silenced breakdown (task #274)", () => {
  it("shows the silenced-send count for each transport tile", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 11,
      suppressedSendsByTransport: { smtp: 5, graph: 3, gmail: 3 },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const smtp = await screen.findByTestId("text-transport-smtp-suppressed");
    const graph = await screen.findByTestId("text-transport-graph-suppressed");
    const gmail = await screen.findByTestId("text-transport-gmail-suppressed");
    expect(smtp.textContent).toMatch(/5\s*silenced/);
    expect(graph.textContent).toMatch(/3\s*silenced/);
    expect(gmail.textContent).toMatch(/3\s*silenced/);
  });

  it("falls back to 0 silenced for transports missing from the breakdown", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 5,
      suppressedSendsByTransport: { smtp: 5 },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const graph = await screen.findByTestId("text-transport-graph-suppressed");
    const gmail = await screen.findByTestId("text-transport-gmail-suppressed");
    expect(graph.textContent).toMatch(/0\s*silenced/);
    expect(gmail.textContent).toMatch(/0\s*silenced/);
  });

  it("reuses the silenced-sends explanation as tooltip on each tile", async () => {
    mockEndpoints({
      entries: [],
      count: 0,
      suppressedSendsSinceBoot: 1,
      suppressedSendsByTransport: { smtp: 1 },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    const smtp = await screen.findByTestId("text-transport-smtp-suppressed");
    const title = smtp.getAttribute("title") ?? "";
    expect(title.toLowerCase()).toContain("silenced");
    expect(title.toLowerCase()).toContain("not counted");
    expect(title.toLowerCase()).toContain("transport error");
  });

  it("does not render the silenced caption while suppressions data is still loading", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes("/api/admin/email/transport-errors")) {
        return jsonResponse(baseTransport);
      }
      return new Promise<Response>(() => {});
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EmailTransportHealthPanel />
      </QueryClientProvider>,
    );

    await screen.findByTestId("row-transport-smtp");
    expect(screen.queryByTestId("text-transport-smtp-suppressed")).toBeNull();
  });
});
