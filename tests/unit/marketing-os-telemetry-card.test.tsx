// @vitest-environment jsdom
/**
 * Task #216 / #241 — render tests for <MarketingOsTelemetryCard/>.
 *
 * Migrated from the bespoke "render-as-function + walk-the-tree" pattern
 * to a real React renderer (jsdom + @testing-library/react), mirroring
 * tests/unit/premium-*.test.tsx. This makes the suite robust against any
 * future hook the component picks up (useEffect, useReducer, useRef…)
 * without having to extend an ever-growing list of vi.mock("react", …)
 * stubs.
 *
 * Pins the per-stage sparkline contract on the admin dashboard widget:
 *   - When the daily series query resolves, each of the three stages
 *     (section_shown, modal_opened, checkout_clicked) renders a
 *     sparkline with the documented test IDs and the correct totals
 *     (sum of bucket values).
 *   - The per-bucket <rect> elements use the documented
 *     `${chartTestId}-bar-${date}` test IDs.
 *   - While the daily query is loading, the skeleton placeholder
 *     renders instead of the chart.
 *   - When the daily query errors, the inline error copy renders.
 *   - The funnel summary renders 7d/30d rows with the right counts and
 *     conversion-rate strings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};

const summaryStub: { current: QueryStub } = {
  current: { data: undefined, isLoading: true, isError: false },
};
const dailyStub: { current: QueryStub } = {
  current: { data: undefined, isLoading: true, isError: false },
};

// Partial mock so QueryClient / useMutation / useQueryClient remain
// available — `client/src/lib/queryClient.ts` (transitively imported by
// the component) instantiates `new QueryClient(...)` at module load
// time, and the component now also calls useMutation / useQueryClient
// for the cleanup-button wiring.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (typeof key === "string") {
        if (key.startsWith("/api/telemetry/marketing-os/summary"))
          return summaryStub.current;
        if (key.startsWith("/api/telemetry/marketing-os/daily"))
          return dailyStub.current;
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

// Use importOriginal so any lucide icon used by sub-components (Select's
// ChevronDown, Checkbox's Check, etc.) keeps working — we only override
// TrendingUp to keep the snapshot small/quiet.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return {
    ...actual,
    TrendingUp: () => null,
  };
});

import { MarketingOsTelemetryCard } from "@/components/marketing-os-telemetry-card";
import type {
  MarketingOsTelemetryDailySeries,
  MarketingOsTelemetrySummary,
} from "@shared/schema";

function makeSummaryWithActivity(): MarketingOsTelemetrySummary {
  // Non-zero so the card doesn't short-circuit into the EmptyState branch
  // (which hides the daily trend section entirely).
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

function makeDailySeries(): MarketingOsTelemetryDailySeries {
  return {
    days: 3,
    buckets: [
      { date: "2026-04-01", sectionShown: 4, modalOpened: 2, checkoutClicked: 1 },
      { date: "2026-04-02", sectionShown: 0, modalOpened: 1, checkoutClicked: 0 },
      { date: "2026-04-03", sectionShown: 3, modalOpened: 0, checkoutClicked: 2 },
    ],
  };
}

beforeEach(() => {
  summaryStub.current = { data: undefined, isLoading: true, isError: false };
  dailyStub.current = { data: undefined, isLoading: true, isError: false };
});

afterEach(cleanup);

describe("<MarketingOsTelemetryCard/> daily trend (Task #216)", () => {
  it("renders per-stage sparklines with the right test IDs and totals", () => {
    summaryStub.current = {
      data: makeSummaryWithActivity(),
      isLoading: false,
      isError: false,
    };
    const series = makeDailySeries();
    dailyStub.current = { data: series, isLoading: false, isError: false };

    const { getByTestId } = render(<MarketingOsTelemetryCard />);

    // Daily section container is present.
    expect(
      getByTestId("section-marketing-os-telemetry-daily-3d"),
    ).toBeInTheDocument();

    const stages: Array<{ testId: string; expectedTotal: number }> = [
      {
        testId: "chart-marketing-os-telemetry-daily-section-shown",
        expectedTotal: 4 + 0 + 3,
      },
      {
        testId: "chart-marketing-os-telemetry-daily-modal-opened",
        expectedTotal: 2 + 1 + 0,
      },
      {
        testId: "chart-marketing-os-telemetry-daily-checkout-clicked",
        expectedTotal: 1 + 0 + 2,
      },
    ];

    for (const stage of stages) {
      expect(getByTestId(stage.testId)).toBeInTheDocument();
      expect(getByTestId(`${stage.testId}-total`)).toHaveTextContent(
        String(stage.expectedTotal),
      );
      for (const bucket of series.buckets) {
        expect(
          getByTestId(`${stage.testId}-bar-${bucket.date}`),
        ).toBeInTheDocument();
      }
    }
  });

  it("shows the daily skeleton while the daily query is loading", () => {
    summaryStub.current = {
      data: makeSummaryWithActivity(),
      isLoading: false,
      isError: false,
    };
    dailyStub.current = { data: undefined, isLoading: true, isError: false };

    const { getByTestId, queryByTestId } = render(<MarketingOsTelemetryCard />);
    expect(
      getByTestId("skeleton-marketing-os-telemetry-daily"),
    ).toBeInTheDocument();
    // And the trend section must not have rendered yet.
    expect(
      queryByTestId("section-marketing-os-telemetry-daily-30d"),
    ).toBeNull();
  });

  it("shows the inline error copy when the daily query fails", () => {
    summaryStub.current = {
      data: makeSummaryWithActivity(),
      isLoading: false,
      isError: false,
    };
    dailyStub.current = { data: undefined, isLoading: false, isError: true };

    const { getByTestId } = render(<MarketingOsTelemetryCard />);
    expect(
      getByTestId("text-marketing-os-telemetry-daily-error"),
    ).toBeInTheDocument();
  });
});

describe("<MarketingOsTelemetryCard/> funnel summary (Task #241)", () => {
  it("renders both 7d and 30d funnel rows with per-stage counts and conversion rate badges", () => {
    // Distinct, non-trivial counts per window so a regression that
    // crosses the wires (e.g. rendering 30d numbers in the 7d slot) would
    // fail loudly. Rates exercise one-decimal rounding.
    const summary: MarketingOsTelemetrySummary = {
      last7Days: {
        days: 7,
        sectionShown: 30,
        modalOpened: 20,
        checkoutClicked: 10,
        shownToModalRate: 20 / 30, // -> "66.7%"
        modalToCheckoutRate: 10 / 20, // -> "50.0%"
        shownToCheckoutRate: 10 / 30, // -> "33.3%"
      },
      last30Days: {
        days: 30,
        sectionShown: 150,
        modalOpened: 90,
        checkoutClicked: 27,
        shownToModalRate: 90 / 150, // -> "60.0%"
        modalToCheckoutRate: 27 / 90, // -> "30.0%"
        shownToCheckoutRate: 27 / 150, // -> "18.0%"
      },
    };
    summaryStub.current = { data: summary, isLoading: false, isError: false };
    dailyStub.current = { data: undefined, isLoading: true, isError: false };

    const { getByTestId } = render(<MarketingOsTelemetryCard />);

    const cases: Array<{
      tag: "7d" | "30d";
      window: typeof summary.last7Days;
      conversion: string;
      shownToModal: string;
      modalToCheckout: string;
    }> = [
      {
        tag: "7d",
        window: summary.last7Days,
        conversion: "33.3%",
        shownToModal: "66.7%",
        modalToCheckout: "50.0%",
      },
      {
        tag: "30d",
        window: summary.last30Days,
        conversion: "18.0%",
        shownToModal: "60.0%",
        modalToCheckout: "30.0%",
      },
    ];

    for (const c of cases) {
      expect(
        getByTestId(`section-marketing-os-telemetry-${c.tag}`),
      ).toBeInTheDocument();

      const stagePairs: Array<[string, number]> = [
        [`text-marketing-os-telemetry-${c.tag}-section-shown`, c.window.sectionShown],
        [`text-marketing-os-telemetry-${c.tag}-modal-opened`, c.window.modalOpened],
        [`text-marketing-os-telemetry-${c.tag}-checkout-clicked`, c.window.checkoutClicked],
      ];
      for (const [testId, expected] of stagePairs) {
        expect(getByTestId(testId)).toHaveTextContent(String(expected));
      }

      expect(
        getByTestId(`text-marketing-os-telemetry-${c.tag}-conversion`),
      ).toHaveTextContent(c.conversion);
      expect(
        getByTestId(`text-marketing-os-telemetry-${c.tag}-shown-to-modal`),
      ).toHaveTextContent(c.shownToModal);
      expect(
        getByTestId(`text-marketing-os-telemetry-${c.tag}-modal-to-checkout`),
      ).toHaveTextContent(c.modalToCheckout);
    }
  });

  it("falls back to the empty state when the 30d window is all zero", () => {
    // The card's empty-state branch keys off last30Days only — when every
    // 30d count is zero the funnel rows must not render at all.
    const emptySummary: MarketingOsTelemetrySummary = {
      last7Days: {
        days: 7,
        sectionShown: 0,
        modalOpened: 0,
        checkoutClicked: 0,
        shownToModalRate: 0,
        modalToCheckoutRate: 0,
        shownToCheckoutRate: 0,
      },
      last30Days: {
        days: 30,
        sectionShown: 0,
        modalOpened: 0,
        checkoutClicked: 0,
        shownToModalRate: 0,
        modalToCheckoutRate: 0,
        shownToCheckoutRate: 0,
      },
    };
    summaryStub.current = {
      data: emptySummary,
      isLoading: false,
      isError: false,
    };
    dailyStub.current = { data: undefined, isLoading: false, isError: false };

    const { queryByTestId, getByTestId } = render(<MarketingOsTelemetryCard />);

    const empty = getByTestId("empty-state");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent("No upgrade activity yet");
    expect(queryByTestId("section-marketing-os-telemetry-7d")).toBeNull();
    expect(queryByTestId("section-marketing-os-telemetry-30d")).toBeNull();
  });
});
