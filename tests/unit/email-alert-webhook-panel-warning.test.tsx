// @vitest-environment jsdom
// Task #286 — pins the admin warning banner added in Task #251 on the
// email alert webhook panel. The backend health logic is unit-tested in
// `server/email/webhook-health-check.test.ts`; this test guards the
// React surface so a future panel refactor can't quietly drop the banner.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

type QueryArgs = { queryKey: unknown[]; enabled?: boolean };
const queryResponses = new Map<string, { data: unknown; isLoading: boolean }>();

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: QueryArgs) => {
    const key = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey);
    return queryResponses.get(key) ?? { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutate: () => {}, isPending: false }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

import { EmailAlertWebhookPanel } from "@/components/email-alert-webhook-panel";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function setConfig(data: Record<string, unknown>) {
  queryResponses.clear();
  queryResponses.set("/api/admin/email-alert-webhook", {
    data: {
      configured: true,
      webhookUrl: "https://hooks.slack.com/services/T000/B000/xyz",
      cooldownMs: 15 * 60 * 1000,
      envFallback: false,
      staleAfterMs: STALE_AFTER_MS,
      ...data,
    },
    isLoading: false,
  });
}

beforeEach(() => {
  queryResponses.clear();
});

afterEach(() => {
  cleanup();
});

describe("EmailAlertWebhookPanel admin warning banner (Task #286 / #251)", () => {
  it("shows the warning when the last automatic test failed", () => {
    setConfig({
      lastTestedAt: new Date(Date.now() - 60_000).toISOString(),
      lastTestOk: false,
      lastTestError: "invalid_payload",
    });

    render(<EmailAlertWebhookPanel />);

    expect(
      screen.getByTestId("warning-email-alert-webhook-health"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("text-email-alert-webhook-warning-headline"),
    ).toHaveTextContent(/last automatic webhook test failed/i);
    expect(
      screen.getByTestId("text-email-alert-webhook-warning-detail"),
    ).toHaveTextContent(/invalid_payload/);
  });

  it("shows the stale-branch warning when lastTestedAt is older than staleAfterMs", () => {
    setConfig({
      lastTestedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000).toISOString(),
      lastTestOk: true,
      lastTestError: null,
    });

    render(<EmailAlertWebhookPanel />);

    expect(
      screen.getByTestId("warning-email-alert-webhook-health"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("text-email-alert-webhook-warning-headline"),
    ).toHaveTextContent(/last webhook test is stale/i);
    expect(
      screen.getByTestId("text-email-alert-webhook-warning-detail"),
    ).toHaveTextContent(/auto-test this webhook in the background/i);
  });

  it("shows the never-tested headline when the webhook has no lastTestedAt yet", () => {
    setConfig({
      lastTestedAt: null,
      lastTestOk: null,
      lastTestError: null,
    });

    render(<EmailAlertWebhookPanel />);

    expect(
      screen.getByTestId("warning-email-alert-webhook-health"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("text-email-alert-webhook-warning-headline"),
    ).toHaveTextContent(/never been auto-tested/i);
  });

  it("does not render the warning when the most recent test is fresh and ok", () => {
    setConfig({
      lastTestedAt: new Date(Date.now() - 60_000).toISOString(),
      lastTestOk: true,
      lastTestError: null,
    });

    render(<EmailAlertWebhookPanel />);

    expect(
      screen.queryByTestId("warning-email-alert-webhook-health"),
    ).toBeNull();
  });
});
