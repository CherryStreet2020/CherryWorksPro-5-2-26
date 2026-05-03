/**
 * Public token routes — invalid-token surface
 * (Task #431, audit §2.2 "/i/:token Partial — expired/invalid token
 *  untested" and "/e/:token Untested").
 *
 * Asserts that bogus tokens render a friendly error / not-found
 * surface rather than a JS crash or a 5xx.
 */
import { test, expect } from "@playwright/test";

const ROUTES = ["/i/", "/e/"];

test.describe("Public token routes — invalid token", () => {
  for (const prefix of ROUTES) {
    test(`${prefix}<bogus> renders without a 5xx or page error`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

      const url = `${prefix}deadbeef-${Date.now()}`;
      const response = await page.goto(url);
      expect(
        (response?.status() ?? 0) < 500,
        `${url} returned a 5xx`,
      ).toBeTruthy();

      const real = errors.filter(
        (e) =>
          !/Failed to load resource.*40[13]/i.test(e) &&
          !/autocomplete attributes/i.test(e),
      );
      expect(real, `Page errors: ${real.join(" | ")}`).toEqual([]);
    });
  }
});
