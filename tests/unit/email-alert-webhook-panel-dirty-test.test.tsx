// @vitest-environment jsdom
// Task #317 — pins the dirty-form lock on the "Send test alert" button in
// the Email Alert Webhook panel. The button must be disabled (and swap its
// tooltip) whenever the URL or cooldown inputs differ from the saved
// values, so admins can't accidentally fire a test against an unsaved URL.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

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

const SAVED_URL = "https://hooks.slack.com/services/T000/B000/xyz";
const SAVED_COOLDOWN_MS = 15 * 60 * 1000;

function setConfig(data: Record<string, unknown> = {}) {
  queryResponses.clear();
  queryResponses.set("/api/admin/email-alert-webhook", {
    data: {
      configured: true,
      webhookUrl: SAVED_URL,
      cooldownMs: SAVED_COOLDOWN_MS,
      envFallback: false,
      lastTestedAt: new Date(Date.now() - 60_000).toISOString(),
      lastTestOk: true,
      lastTestError: null,
      staleAfterMs: 24 * 60 * 60 * 1000,
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

describe("EmailAlertWebhookPanel test-button dirty lock (Task #317)", () => {
  it("enables the test button when inputs match the saved config and disables it once the URL or cooldown is edited", () => {
    setConfig();

    render(<EmailAlertWebhookPanel />);

    const testButton = screen.getByTestId(
      "button-test-email-alert-webhook",
    ) as HTMLButtonElement;
    expect(testButton).not.toBeDisabled();
    expect(testButton.getAttribute("title")).toBe(
      "Sends a test payload to the saved webhook URL.",
    );

    const urlInput = screen.getByTestId(
      "input-email-alert-webhook-url",
    ) as HTMLInputElement;
    expect(urlInput.value).toBe(SAVED_URL);

    fireEvent.change(urlInput, { target: { value: `${SAVED_URL}/edited` } });

    expect(testButton).toBeDisabled();
    expect(testButton.getAttribute("title")).toBe(
      "Save your changes first — test sends to the saved webhook URL.",
    );

    fireEvent.change(urlInput, { target: { value: SAVED_URL } });
    expect(testButton).not.toBeDisabled();
    expect(testButton.getAttribute("title")).toBe(
      "Sends a test payload to the saved webhook URL.",
    );

    const cooldownInput = screen.getByTestId(
      "input-email-alert-webhook-cooldown",
    ) as HTMLInputElement;
    expect(cooldownInput.value).toBe(
      String(Math.round(SAVED_COOLDOWN_MS / 60000)),
    );

    fireEvent.change(cooldownInput, { target: { value: "30" } });

    expect(testButton).toBeDisabled();
    expect(testButton.getAttribute("title")).toBe(
      "Save your changes first — test sends to the saved webhook URL.",
    );
  });
});
