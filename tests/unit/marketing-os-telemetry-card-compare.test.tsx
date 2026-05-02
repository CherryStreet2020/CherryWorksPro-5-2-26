// @vitest-environment jsdom
/**
 * Task #262 — Integration test for the comparison-mode picker on
 * <MarketingOsTelemetryCard/> (originally added in Task #238).
 *
 * Pins the side-by-side comparison contract:
 *   - Toggling the comparison checkbox fires a second
 *     `/api/telemetry/marketing-os/daily?from=...&to=...` request whose
 *     range is the immediately-preceding window of the same length as
 *     the primary range ("previous period" preset).
 *   - The overlay legend, comparison totals, and delta render against
 *     the second series (`chart-...-compare-total`, `-compare-delta`).
 *   - Switching the comparison preset to "custom" lets the admin pick
 *     an arbitrary window and the request URL updates accordingly.
 *
 * The shadcn <Select/> primitive (built on Radix) renders a portal that
 * is awkward to drive in jsdom, so we stub it down to native buttons
 * mirroring marketing-os-telemetry-card-custom-range.test.tsx — that
 * keeps the test focused on the picker → request → chart wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import type {
  MarketingOsTelemetryDailySeries,
  MarketingOsTelemetrySummary,
} from "@shared/schema";

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};

const summaryStub: { current: QueryStub } = {
  current: { data: undefined, isLoading: true, isError: false },
};
const dailyByUrl = new Map<string, QueryStub>();
const dailyRequests: string[] = [];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  // Partial mock so QueryClient / useMutation / useQueryClient remain
  // available — `client/src/lib/queryClient.ts` (transitively imported
  // by the component) instantiates `new QueryClient(...)` at module
  // load time.
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
      const key = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey);
      if (key === "/api/telemetry/marketing-os/summary") {
        return summaryStub.current;
      }
      if (enabled === false) {
        return { data: undefined, isLoading: false, isError: false };
      }
      if (key.startsWith("/api/telemetry/marketing-os/daily")) {
        if (key !== "/api/telemetry/marketing-os/daily") {
          dailyRequests.push(key);
        }
        const stub =
          dailyByUrl.get(key) ?? {
            data: undefined,
            isLoading: true,
            isError: false,
          };
        return stub;
      }
      return { data: undefined, isLoading: false, isError: false };
    },
  };
});

// Partial mock so other icons consumed by sub-components (e.g. Radix
// Checkbox's Check, Select's ChevronDown) keep working when modules are
// shared across files in a single vitest run (Task #302).
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return {
    ...actual,
    TrendingUp: () => null,
  };
});

vi.mock("@/components/ui/card", () => {
  const passthrough = (props: any) =>
    React.createElement("div", { ...props }, props.children);
  return { Card: passthrough, CardContent: passthrough };
});

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: any) => React.createElement("div", { ...props }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: (props: any) =>
    React.createElement("label", { ...props }, props.children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", { ...props }),
}));

// Native checkbox stub for the "compare" toggle. Radix Checkbox wraps a
// hidden input + button pair; for the wiring assertions here we only
// need a real onCheckedChange call when the user clicks.
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...rest }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked: !!checked,
      onChange: (e: any) => onCheckedChange?.(e.target.checked),
      ...rest,
    }),
}));

// See marketing-os-telemetry-card-custom-range.test.tsx for rationale.
vi.mock("@/components/ui/select", () => {
  const SelectCtx = React.createContext<{
    value?: string;
    onValueChange?: (v: string) => void;
  }>({});
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(
        SelectCtx.Provider,
        { value: { value, onValueChange } },
        children,
      ),
    SelectTrigger: ({ children, ...rest }: any) =>
      React.createElement("div", { ...rest }, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children, ...rest }: any) => {
      const ctx = React.useContext(SelectCtx);
      return React.createElement(
        "button",
        {
          type: "button",
          ...rest,
          onClick: () => ctx.onValueChange?.(value),
        },
        children,
      );
    },
  };
});

vi.mock("@/components/shared/empty-state", () => ({
  EmptyState: (props: any) =>
    React.createElement(
      "div",
      { "data-testid": "empty-state" },
      props.title,
    ),
}));

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  DEFAULT_DAILY_PRESET,
  MarketingOsTelemetryCard,
} from "@/components/marketing-os-telemetry-card";

// Derived from the component's exported default so this test stays in
// sync if the initial preset ever changes (e.g. 30d → 14d). Must be a
// concrete day count, not "custom", which the type guarantees.
const DEFAULT_PRIMARY_DAYS = Number(DEFAULT_DAILY_PRESET);
const DEFAULT_PRIMARY_URL = `/api/telemetry/marketing-os/daily?days=${DEFAULT_DAILY_PRESET}`;

function renderCard() {
  // The component pulls in useQueryClient + useMutation for the Task
  // #266 cleanup button; those hooks need a real provider in the tree
  // even though the data fetches themselves are stubbed via vi.mock.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MarketingOsTelemetryCard />
    </QueryClientProvider>,
  );
}

function makeSummaryWithActivity(): MarketingOsTelemetrySummary {
  return {
    last7Days: {
      days: 7,
      sectionShown: 5,
      modalOpened: 3,
      checkoutClicked: 1,
      shownToModalRate: 0.6,
      modalToCheckoutRate: 0.333,
      shownToCheckoutRate: 0.2,
    },
    last30Days: {
      days: 30,
      sectionShown: 20,
      modalOpened: 12,
      checkoutClicked: 4,
      shownToModalRate: 0.6,
      modalToCheckoutRate: 0.333,
      shownToCheckoutRate: 0.2,
    },
  };
}

function isoMinus(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function makeDailySeries(
  days: number,
  startIso: string,
  bias = 0,
): MarketingOsTelemetryDailySeries {
  const buckets: MarketingOsTelemetryDailySeries["buckets"] = [];
  const [y, m, d] = startIso.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < days; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    buckets.push({
      date: dt.toISOString().slice(0, 10),
      sectionShown: i + 1 + bias,
      modalOpened: i + bias,
      checkoutClicked: i === days - 1 ? 7 + bias : 0,
    });
  }
  return { days, buckets };
}

// Freeze "now" so the derived primary/comparison ranges are
// deterministic. The card calls `new Date().toISOString().slice(0,10)`
// for `today`, and `isoFromTodayMinus(n)` for the start of the primary
// window (currently 30 days back).
const FROZEN_NOW = "2026-04-22";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${FROZEN_NOW}T12:00:00Z`));
  summaryStub.current = {
    data: makeSummaryWithActivity(),
    isLoading: false,
    isError: false,
  };
  dailyByUrl.clear();
  dailyRequests.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<MarketingOsTelemetryCard/> comparison view (Task #262)", () => {
  it("issues a previous-period request, renders overlay totals + delta when compare is enabled", () => {
    // Primary preset comes from the component's exported default so a
    // future change (e.g. 30d → 14d) doesn't silently turn this test
    // into a no-op.
    const primaryDays = DEFAULT_PRIMARY_DAYS;
    const primaryFrom = isoMinus(FROZEN_NOW, primaryDays - 1);
    const primarySeries = makeDailySeries(primaryDays, primaryFrom);
    dailyByUrl.set(DEFAULT_PRIMARY_URL, {
      data: primarySeries,
      isLoading: false,
      isError: false,
    });

    // The "previous period" comparison window is the immediately
    // preceding `primaryDays` days: ends the day before primaryFrom,
    // starts (primaryDays - 1) days before that.
    const compareTo = isoMinus(primaryFrom, 1);
    const compareFrom = isoMinus(compareTo, primaryDays - 1);
    const compareUrl = `/api/telemetry/marketing-os/daily?from=${compareFrom}&to=${compareTo}`;
    const compareSeries = makeDailySeries(primaryDays, compareFrom, 100);
    dailyByUrl.set(compareUrl, {
      data: compareSeries,
      isLoading: false,
      isError: false,
    });

    renderCard();

    // Sanity: only the primary request fires before the user toggles
    // compare.
    expect(dailyRequests).toContain(DEFAULT_PRIMARY_URL);
    expect(dailyRequests.some((u) => u.startsWith(
      "/api/telemetry/marketing-os/daily?from=",
    ))).toBe(false);

    // Toggle compare on.
    act(() => {
      fireEvent.click(
        screen.getByTestId("checkbox-marketing-os-telemetry-daily-compare"),
      );
    });

    // The comparison request must use the immediately-preceding window.
    expect(dailyRequests).toContain(compareUrl);

    // Overlay legend + per-stage compare totals/deltas render.
    expect(
      screen.getByTestId("legend-marketing-os-telemetry-daily-compare"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("text-marketing-os-telemetry-daily-compare-label"),
    ).toBeTruthy();

    const stageIds = [
      "chart-marketing-os-telemetry-daily-section-shown",
      "chart-marketing-os-telemetry-daily-modal-opened",
      "chart-marketing-os-telemetry-daily-checkout-clicked",
    ];
    const stageReaders: Array<{
      bucketKey: keyof MarketingOsTelemetryDailySeries["buckets"][number];
      testId: string;
    }> = [
      { bucketKey: "sectionShown", testId: stageIds[0] },
      { bucketKey: "modalOpened", testId: stageIds[1] },
      { bucketKey: "checkoutClicked", testId: stageIds[2] },
    ];

    for (const stage of stageReaders) {
      const curTotal = primarySeries.buckets.reduce(
        (sum, b) => sum + (b[stage.bucketKey] as number),
        0,
      );
      const cmpTotal = compareSeries.buckets.reduce(
        (sum, b) => sum + (b[stage.bucketKey] as number),
        0,
      );
      const delta = curTotal - cmpTotal;
      const sign = delta > 0 ? "+" : "";

      expect(
        screen.getByTestId(`${stage.testId}-total`).textContent,
      ).toBe(String(curTotal));
      expect(
        screen.getByTestId(`${stage.testId}-compare-total`).textContent,
      ).toBe(`vs ${cmpTotal}`);
      expect(
        screen.getByTestId(`${stage.testId}-compare-delta`).textContent,
      ).toBe(`${sign}${delta}`);
    }
  });

  it("re-issues the comparison request with custom dates when the compare preset is switched to custom", () => {
    const primaryDays = DEFAULT_PRIMARY_DAYS;
    const primaryFrom = isoMinus(FROZEN_NOW, primaryDays - 1);
    const primarySeries = makeDailySeries(primaryDays, primaryFrom);
    dailyByUrl.set(DEFAULT_PRIMARY_URL, {
      data: primarySeries,
      isLoading: false,
      isError: false,
    });

    // Pre-stub the "previous period" comparison response (fires on
    // toggle) and the eventual custom comparison response.
    const prevTo = isoMinus(primaryFrom, 1);
    const prevFrom = isoMinus(prevTo, primaryDays - 1);
    dailyByUrl.set(
      `/api/telemetry/marketing-os/daily?from=${prevFrom}&to=${prevTo}`,
      {
        data: makeDailySeries(primaryDays, prevFrom, 50),
        isLoading: false,
        isError: false,
      },
    );

    const customFrom = "2026-01-05";
    const customTo = "2026-01-12";
    const customSpan = 8; // inclusive
    const customUrl = `/api/telemetry/marketing-os/daily?from=${customFrom}&to=${customTo}`;
    dailyByUrl.set(customUrl, {
      data: makeDailySeries(customSpan, customFrom, 9),
      isLoading: false,
      isError: false,
    });

    renderCard();

    // Enable compare (fires the previous-period request).
    act(() => {
      fireEvent.click(
        screen.getByTestId("checkbox-marketing-os-telemetry-daily-compare"),
      );
    });
    dailyRequests.length = 0;

    // Switch the comparison preset to "custom".
    act(() => {
      fireEvent.click(
        screen.getByTestId(
          "option-marketing-os-telemetry-daily-compare-preset-custom",
        ),
      );
    });

    // Custom from/to inputs are now visible.
    const fromInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-compare-from",
    ) as HTMLInputElement;
    const toInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-compare-to",
    ) as HTMLInputElement;

    // Set the comparison window to a deterministic range. Push the
    // `to` first so the controlled `min` constraint never blocks the
    // `from` value while transitioning.
    act(() => {
      fireEvent.change(toInput, { target: { value: customTo } });
    });
    act(() => {
      fireEvent.change(fromInput, { target: { value: customFrom } });
    });

    // The compare request URL should reflect the user's chosen range
    // (and not the previous-period default).
    const customRequest = dailyRequests.find(
      (url) =>
        url.includes(`from=${customFrom}`) && url.includes(`to=${customTo}`),
    );
    expect(customRequest, dailyRequests.join("\n")).toBe(customUrl);
    expect(customRequest!).not.toContain("days=");

    // Compare overlay still renders with the new series — totals match
    // the custom-range stub.
    const cmpSeries = dailyByUrl.get(customUrl)!.data as
      MarketingOsTelemetryDailySeries;
    const cmpShownTotal = cmpSeries.buckets.reduce(
      (s, b) => s + b.sectionShown,
      0,
    );
    expect(
      screen.getByTestId(
        "chart-marketing-os-telemetry-daily-section-shown-compare-total",
      ).textContent,
    ).toBe(`vs ${cmpShownTotal}`);
  });
});
