/**
 * Sprint 2k / Task #392 — startMarketingOsCheckout helper.
 *
 * The helper used to drive the legacy $99/mo Stripe Checkout. After Task
 * #392 marketing_os is no longer purchasable as a standalone add-on, so
 * the server returns HTTP 410 with `{ code: "MARKETING_OS_TIER_DERIVED" }`
 * and the helper now exists as a defensive shim — any stale call site
 * surfaces the migration message instead of silently failing.
 *
 * Mocks `apiRequest` so we don't touch the network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

beforeEach(() => {
  apiRequestMock.mockReset();
});

describe("startMarketingOsCheckout (Task #392 — tier-derived)", () => {
  it("throws the tier-derived sentinel when apiRequest rejects with the 410 code", async () => {
    apiRequestMock.mockRejectedValueOnce(
      new Error(
        "410: Marketing OS is no longer a standalone add-on. " +
          "MARKETING_OS_TIER_DERIVED",
      ),
    );
    const { startMarketingOsCheckout, MARKETING_OS_TIER_DERIVED_ERROR } =
      await import("../../client/src/lib/marketing-os-checkout");
    await expect(startMarketingOsCheckout()).rejects.toThrow(
      MARKETING_OS_TIER_DERIVED_ERROR,
    );
  });

  it("throws the tier-derived sentinel when apiRequest rejects with a 410 status string", async () => {
    apiRequestMock.mockRejectedValueOnce(new Error("410: Gone"));
    const { startMarketingOsCheckout, MARKETING_OS_TIER_DERIVED_ERROR } =
      await import("../../client/src/lib/marketing-os-checkout");
    await expect(startMarketingOsCheckout()).rejects.toThrow(
      MARKETING_OS_TIER_DERIVED_ERROR,
    );
  });

  it("throws the tier-derived sentinel when the response body carries the code", async () => {
    apiRequestMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        code: "MARKETING_OS_TIER_DERIVED",
        upgradePath: "/settings/billing",
      }),
    });
    const { startMarketingOsCheckout, MARKETING_OS_TIER_DERIVED_ERROR } =
      await import("../../client/src/lib/marketing-os-checkout");
    await expect(startMarketingOsCheckout()).rejects.toThrow(
      MARKETING_OS_TIER_DERIVED_ERROR,
    );
  });

  it("throws the tier-derived sentinel when status === 410 even with a json body", async () => {
    apiRequestMock.mockResolvedValueOnce({
      status: 410,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
    });
    const { startMarketingOsCheckout, MARKETING_OS_TIER_DERIVED_ERROR } =
      await import("../../client/src/lib/marketing-os-checkout");
    await expect(startMarketingOsCheckout()).rejects.toThrow(
      MARKETING_OS_TIER_DERIVED_ERROR,
    );
  });

  it("returns { url } when the server still responds with a Stripe URL (legacy contract preserved)", async () => {
    apiRequestMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
    });
    const { startMarketingOsCheckout, MARKETING_OS_CHECKOUT_PATH } =
      await import("../../client/src/lib/marketing-os-checkout");
    const result = await startMarketingOsCheckout();
    expect(result).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      MARKETING_OS_CHECKOUT_PATH,
      {},
    );
  });

  it("throws the server's error message for non-410 failures", async () => {
    apiRequestMock.mockRejectedValueOnce(
      new Error("403: Stripe is not configured"),
    );
    const { startMarketingOsCheckout } = await import(
      "../../client/src/lib/marketing-os-checkout"
    );
    await expect(startMarketingOsCheckout()).rejects.toThrow(
      "403: Stripe is not configured",
    );
  });

  it("throws when the server returns 200 with neither url nor tier-derived code", async () => {
    apiRequestMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ error: "Already entitled" }),
    });
    const { startMarketingOsCheckout } = await import(
      "../../client/src/lib/marketing-os-checkout"
    );
    await expect(startMarketingOsCheckout()).rejects.toThrow("Already entitled");
  });
});
