/**
 * Regression coverage for the masked-recipient suppression admin gate.
 *
 * The suppression endpoints
 *   GET    /api/admin/email/masked-suppressions
 *   POST   /api/admin/email/masked-suppressions
 *   DELETE /api/admin/email/masked-suppressions/:hash
 * are all wrapped in `requireAdmin`. A regression here would let any
 * logged-in non-admin team member silently block (or unblock) sends to
 * a recipient for the entire org, so this spec asserts that a non-admin
 * session is rejected with 403 on every verb.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const NON_ADMIN_EMAIL = "team.test@cwpro.dev";
const NON_ADMIN_PASS = "team123";

async function loginAsNonAdmin(
  api: APIRequestContext,
): Promise<{ csrf: string }> {
  const r = await api.post("/api/auth/login", {
    data: { email: NON_ADMIN_EMAIL, password: NON_ADMIN_PASS },
  });
  expect(r.status(), "non-admin login should succeed").toBe(200);
  const tok = await api.get("/api/csrf-token");
  expect(tok.status()).toBe(200);
  const body = await tok.json();
  const csrf = (body.token ?? body.csrfToken) as string;
  expect(csrf, "csrf token should be returned").toBeTruthy();
  return { csrf };
}

test.describe("Masked-recipient suppression — non-admin denial", () => {
  test("non-admin is rejected from GET, POST, and DELETE", async ({
    request,
  }) => {
    const { csrf } = await loginAsNonAdmin(request);

    const getRes = await request.get("/api/admin/email/masked-suppressions");
    expect(
      getRes.status(),
      "GET masked-suppressions must be admin-only",
    ).toBe(403);

    const postRes = await request.post(
      "/api/admin/email/masked-suppressions",
      {
        data: {
          recipient: "b***@e***.com (#abcd)",
          reason: "non-admin attempt",
        },
        headers: { "x-csrf-token": csrf },
      },
    );
    expect(
      postRes.status(),
      "POST masked-suppressions must be admin-only",
    ).toBe(403);

    const delRes = await request.delete(
      "/api/admin/email/masked-suppressions/abcd",
      { headers: { "x-csrf-token": csrf } },
    );
    expect(
      delRes.status(),
      "DELETE masked-suppressions must be admin-only",
    ).toBe(403);
  });
});
