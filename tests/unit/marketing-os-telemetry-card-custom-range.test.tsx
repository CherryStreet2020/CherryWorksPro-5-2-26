// @vitest-environment jsdom
/**
 * Task #239 — Integration test for the custom-range trend picker on
 * <MarketingOsTelemetryCard/>.
 *
 * Pins the wire-format contract added in Task #215:
 *   - Switching the preset to "Custom range" issues a daily-trend
 *     request whose query string contains `from`/`to` (not `days`).
 *   - The chart re-renders against the new series payload.
 *
 * The shadcn <Select/> primitive (built on Radix) renders a portal that
 * is awkward to drive in jsdom, so we stub it down to a native <select>
 * that fires the same `onValueChange` callback the component listens
 * to. That keeps the test focused on the picker → request → chart
 * wiring without exercising Radix internals (which have their own
 * coverage upstream).
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
      // Only record real requests (not the placeholder fallback the
      // component uses while disabled).
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
  useQueryClient: () => ({
    setQueryData: () => undefined,
    invalidateQueries: () => undefined,
  }),
  useMutation: () => ({
    mutate: () => undefined,
    mutateAsync: async () => undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: () => undefined,
  }),
  };
});

// Partial mock so other icons consumed by sub-components (e.g. Radix
// Checkbox's Check, Select's ChevronDown) keep working. A hard mock
// here was leaking across files in the same vitest run and leaving
// `Check` undefined inside Radix Checkbox (Task #302).
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return {
    ...actual,
    TrendingUp: () => null,
  };
});

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...rest }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked: !!checked,
      onChange: (e: any) => onCheckedChange?.(e.target.checked),
      ...rest,
    }),
}));

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

// Stub the Radix-backed Select. The shadcn primitive is two siblings
// (trigger + content portal) coordinated via context, so we mirror that
// shape: the trigger keeps its data-testid as a normal div, and each
// SelectItem becomes a button that fires `onValueChange` on click.
// That lets the test drive the preset switch deterministically without
// dragging Radix's portal/keyboard machinery into jsdom.
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
  DEFAULT_DAILY_PRESET,
  MarketingOsTelemetryCard,
} from "@/components/marketing-os-telemetry-card";

// Sourced from the component so changing the initial preset doesn't
// silently turn this test into a no-op (it would render an empty chart
// because the pre-stubbed days=30 URL would no longer match).
const DEFAULT_PRIMARY_DAYS = Number(DEFAULT_DAILY_PRESET);
const DEFAULT_PRIMARY_URL = `/api/telemetry/marketing-os/daily?days=${DEFAULT_DAILY_PRESET}`;
const DEFAULT_PRIMARY_SECTION_TESTID = `section-marketing-os-telemetry-daily-${DEFAULT_PRIMARY_DAYS}d`;

function isoTodayMinus(days: number): string {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
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

function makeDailySeries(
  days: number,
  startIso: string,
): MarketingOsTelemetryDailySeries {
  const buckets: MarketingOsTelemetryDailySeries["buckets"] = [];
  const [y, m, d] = startIso.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < days; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    buckets.push({
      date: dt.toISOString().slice(0, 10),
      sectionShown: i + 1,
      modalOpened: i,
      checkoutClicked: i === days - 1 ? 7 : 0,
    });
  }
  return { days, buckets };
}

beforeEach(() => {
  summaryStub.current = {
    data: makeSummaryWithActivity(),
    isLoading: false,
    isError: false,
  };
  dailyByUrl.clear();
  dailyRequests.length = 0;
});

afterEach(() => cleanup());

describe("<MarketingOsTelemetryCard/> custom-range picker (Task #239)", () => {
  it("issues a from/to request and re-renders the chart when switching to a custom range", () => {
    // Initial preset is "30d" — pre-stub that response so the first
    // render shows a chart, and the ensuing custom-range switch is a
    // genuine re-render rather than a first-paint.
    dailyByUrl.set(
      DEFAULT_PRIMARY_URL,
      {
        data: makeDailySeries(
          DEFAULT_PRIMARY_DAYS,
          isoTodayMinus(DEFAULT_PRIMARY_DAYS - 1),
        ),
        isLoading: false,
        isError: false,
      },
    );

    // The custom range we'll pick once the user opens the picker.
    const customFrom = "2026-04-01";
    const customTo = "2026-04-05";
    const customUrl = `/api/telemetry/marketing-os/daily?from=${customFrom}&to=${customTo}`;
    const customSeries = makeDailySeries(5, customFrom);
    dailyByUrl.set(customUrl, {
      data: customSeries,
      isLoading: false,
      isError: false,
    });

    render(<MarketingOsTelemetryCard />);

    // Initial state: the default-preset request was issued and the
    // corresponding trend section is on screen.
    expect(dailyRequests).toContain(DEFAULT_PRIMARY_URL);
    expect(
      screen.getByTestId(DEFAULT_PRIMARY_SECTION_TESTID),
    ).toBeTruthy();

    // Switch the range preset to "Custom range".
    act(() => {
      fireEvent.click(
        screen.getByTestId(
          "option-marketing-os-telemetry-daily-range-custom",
        ),
      );
    });

    // The from/to inputs are now visible. Pick concrete dates.
    const fromInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-from",
    ) as HTMLInputElement;
    const toInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-to",
    ) as HTMLInputElement;

    act(() => {
      fireEvent.change(fromInput, { target: { value: customFrom } });
    });
    act(() => {
      fireEvent.change(toInput, { target: { value: customTo } });
    });

    // The component should have issued a request whose query string
    // carries `from`/`to` (not `days`).
    const customRequest = dailyRequests.find(
      (url) => url.includes(`from=${customFrom}`) && url.includes(`to=${customTo}`),
    );
    expect(customRequest, dailyRequests.join("\n")).toBe(customUrl);
    expect(customRequest!).not.toContain("days=");

    // And the chart re-renders against the new 5-day series. The
    // trend section is keyed by `series.days`, so the default-preset
    // section should be gone and the 5d section present with per-bucket
    // bars for every date in the picked range.
    expect(
      screen.queryByTestId(DEFAULT_PRIMARY_SECTION_TESTID),
    ).toBeNull();
    expect(
      screen.getByTestId("section-marketing-os-telemetry-daily-5d"),
    ).toBeTruthy();
    for (const bucket of customSeries.buckets) {
      expect(
        screen.getByTestId(
          `chart-marketing-os-telemetry-daily-section-shown-bar-${bucket.date}`,
        ),
      ).toBeTruthy();
    }
  });

  it("blocks the request and shows an inline error when the custom range is reversed", () => {
    dailyByUrl.set(
      DEFAULT_PRIMARY_URL,
      {
        data: makeDailySeries(
          DEFAULT_PRIMARY_DAYS,
          isoTodayMinus(DEFAULT_PRIMARY_DAYS - 1),
        ),
        isLoading: false,
        isError: false,
      },
    );

    render(<MarketingOsTelemetryCard />);
    dailyRequests.length = 0;

    act(() => {
      fireEvent.click(
        screen.getByTestId(
          "option-marketing-os-telemetry-daily-range-custom",
        ),
      );
    });

    const fromInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-from",
    ) as HTMLInputElement;
    const toInput = screen.getByTestId(
      "input-marketing-os-telemetry-daily-to",
    ) as HTMLInputElement;

    // Pick a `to` that is strictly before `from`. Set `from` last so
    // the second update lands the reversed combination in state.
    act(() => {
      fireEvent.change(toInput, { target: { value: "2026-04-01" } });
    });
    act(() => {
      fireEvent.change(fromInput, { target: { value: "2026-04-10" } });
    });

    const inlineError = screen.getByTestId(
      "text-marketing-os-telemetry-daily-custom-error",
    );
    expect(inlineError.textContent).toMatch(/end date must be on or after/i);

    // No daily request should have been issued for the invalid range.
    const issued = dailyRequests.filter(
      (url) =>
        url.includes("from=2026-04-10") && url.includes("to=2026-04-01"),
    );
    expect(issued).toEqual([]);
  });
});
