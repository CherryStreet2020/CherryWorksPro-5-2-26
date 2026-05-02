// @vitest-environment jsdom
/**
 * Task 182 — guard the Task 147 upgrade-prompt telemetry hooks.
 * Task 282 — migrated from the bespoke "render-as-function + walk-the-tree"
 * pattern (with vi.mock("react", …) hook stubs) to a real React renderer
 * (jsdom + @testing-library/react), mirroring the Task #257 migration of
 * tests/unit/marketing-os-telemetry-card.test.tsx. This keeps the suite
 * trustworthy as the components pick up new hooks (useRef, useReducer, …)
 * without having to maintain an ever-growing list of hook stubs.
 *
 * Pins the contract for the three discovery events:
 *   - section_shown   → fires exactly once per browser session when the
 *                       locked sidebar variant mounts.
 *   - modal_opened    → fires with the right `source` for the section
 *                       label and each child row.
 *   - checkout_clicked → fires before the Stripe redirect when the
 *                        modal's primary button is clicked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

const apiRequestMock = vi.fn(() => Promise.resolve({ json: async () => ({}) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const checkoutHelper = vi.fn();
vi.mock("@/lib/marketing-os-checkout", () => ({
  startMarketingOsCheckout: (...args: unknown[]) => checkoutHelper(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/dialog", () => {
  const passthrough = (props: any) => props.children ?? null;
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactMod = await import("react");
  return {
    Button: (props: any) =>
      ReactMod.createElement("button", { ...props }, props.children),
  };
});

vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  Lock: () => null,
  Megaphone: () => null,
  Sparkles: () => null,
}));

vi.mock("wouter", () => ({
  Link: () => null,
}));

import { MarketingNavSection } from "@/components/marketing-nav-section";
import { MarketingOsUpgradeModal } from "@/components/marketing-os-upgrade-modal";

function telemetryCalls(event?: string) {
  return apiRequestMock.mock.calls.filter(call => {
    if (call[0] !== "POST") return false;
    if (call[1] !== "/api/telemetry/marketing-os") return false;
    if (event && (call[2] as any)?.event !== event) return false;
    return true;
  });
}

function setFreshLocation() {
  // jsdom's window.location.href setter triggers a "not implemented:
  // navigation" warning and doesn't reliably reflect the new value.
  // Replace it with a plain writable object so the checkout_clicked
  // assertion below can read back the redirect target.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "" },
  });
}

beforeEach(() => {
  apiRequestMock.mockClear();
  apiRequestMock.mockImplementation(() =>
    Promise.resolve({ json: async () => ({}) }),
  );
  checkoutHelper.mockReset();
  window.sessionStorage.clear();
  setFreshLocation();
});

afterEach(cleanup);

describe("Marketing OS upgrade-prompt telemetry (Task 182)", () => {
  describe("section_shown", () => {
    it("fires exactly once when the locked variant mounts", () => {
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      const calls = telemetryCalls("marketing_os.discovery.section_shown");
      expect(calls).toHaveLength(1);
    });

    it("does NOT refire on remount within the same session", () => {
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      cleanup();
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      cleanup();
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      const calls = telemetryCalls("marketing_os.discovery.section_shown");
      expect(calls).toHaveLength(1);
    });

    it("does NOT fire for the active or grace variants", () => {
      render(<MarketingNavSection status="active" location="/dashboard" />);
      cleanup();
      render(<MarketingNavSection status="grace" location="/dashboard" />);
      const calls = telemetryCalls("marketing_os.discovery.section_shown");
      expect(calls).toHaveLength(0);
    });

    it("fires again after the session resets (new tab / new login)", () => {
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      expect(
        telemetryCalls("marketing_os.discovery.section_shown"),
      ).toHaveLength(1);
      cleanup();
      // Simulate a brand-new browser session.
      window.sessionStorage.clear();
      apiRequestMock.mockClear();
      render(<MarketingNavSection status="inactive" location="/dashboard" />);
      expect(
        telemetryCalls("marketing_os.discovery.section_shown"),
      ).toHaveLength(1);
    });
  });

  describe("modal_opened", () => {
    it("fires with source='section_label' when the locked group label is clicked", () => {
      const { getByTestId } = render(
        <MarketingNavSection status="inactive" location="/dashboard" />,
      );
      apiRequestMock.mockClear();
      fireEvent.click(getByTestId("button-section-marketing-locked"));
      const calls = telemetryCalls("marketing_os.discovery.modal_opened");
      expect(calls).toHaveLength(1);
      expect((calls[0][2] as any).props).toEqual({ source: "section_label" });
    });

    it("fires with source='row_contacts' when the locked Contacts row is clicked", () => {
      const { getByTestId } = render(
        <MarketingNavSection status="inactive" location="/dashboard" />,
      );
      apiRequestMock.mockClear();
      fireEvent.click(getByTestId("row-locked-contacts"));
      const calls = telemetryCalls("marketing_os.discovery.modal_opened");
      expect(calls).toHaveLength(1);
      expect((calls[0][2] as any).props).toEqual({ source: "row_contacts" });
    });

    it("fires with source='row_companies' when the locked Companies row is clicked", () => {
      const { getByTestId } = render(
        <MarketingNavSection status="inactive" location="/dashboard" />,
      );
      apiRequestMock.mockClear();
      fireEvent.click(getByTestId("row-locked-companies"));
      const calls = telemetryCalls("marketing_os.discovery.modal_opened");
      expect(calls).toHaveLength(1);
      expect((calls[0][2] as any).props).toEqual({ source: "row_companies" });
    });
  });

  describe("checkout_clicked", () => {
    it("fires before the Stripe redirect when Upgrade is clicked", async () => {
      const order: string[] = [];
      apiRequestMock.mockImplementation((..._args: unknown[]) => {
        order.push("telemetry");
        return Promise.resolve({ json: async () => ({}) });
      });
      checkoutHelper.mockImplementation(() => {
        order.push("checkout");
        return Promise.resolve({ url: "https://stripe.example/c/abc" });
      });

      const { getByTestId } = render(
        <MarketingOsUpgradeModal open onOpenChange={vi.fn()} />,
      );
      await act(async () => {
        fireEvent.click(getByTestId("button-upgrade-marketing-os"));
      });

      const calls = telemetryCalls("marketing_os.discovery.checkout_clicked");
      expect(calls).toHaveLength(1);
      expect(checkoutHelper).toHaveBeenCalledTimes(1);
      // Telemetry must be emitted before the checkout helper runs.
      expect(order[0]).toBe("telemetry");
      expect(order.indexOf("telemetry")).toBeLessThan(
        order.indexOf("checkout"),
      );
      expect(window.location.href).toBe("https://stripe.example/c/abc");
    });

    it("still fires when the checkout helper rejects (no silent drop)", async () => {
      checkoutHelper.mockRejectedValueOnce(new Error("Stripe down"));
      const { getByTestId } = render(
        <MarketingOsUpgradeModal open onOpenChange={vi.fn()} />,
      );
      await act(async () => {
        fireEvent.click(getByTestId("button-upgrade-marketing-os"));
      });
      const calls = telemetryCalls("marketing_os.discovery.checkout_clicked");
      expect(calls).toHaveLength(1);
      expect(window.location.href).toBe("");
    });
  });
});
