/**
 * Task #443 — /import wizard malformed/partial/dry-run coverage.
 *
 * Three scenarios on an isolated org's APIRequestContext:
 *   1. Malformed CSV: header without recognizable columns → upload
 *      either rejects (4xx) OR returns an empty/invalid-typed file
 *      preflight that the wizard surfaces.
 *   2. Partial / valid CSV: dry-run vs execute hash divergence is
 *      enforced; a mismatched planHash on execute is rejected.
 *   3. Dry-run-only flow: the planHash is stable across two
 *      back-to-back dry runs of the same upload + options.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { freshIp } from "../tests/helpers/po/auth";

test.use({ navigationTimeout: 30_000 });

const VALID_HEADER =
  "Client Name,Invoice #,Date Issued,Date Due,Invoice Status,Date Paid,Item Name,Item Description,Rate,Quantity,Discount Percentage,Line Subtotal,Tax 1 Type,Tax 1 Amount,Tax 2 Type,Tax 2 Amount,Line Total,Currency";

function row(invNum: string, clientName: string): string {
  return [
    clientName, invNum, "01/15/2026", "02/15/2026", "overdue", "",
    "E2E Service", "E2E line", "100.00", "1", "0", "100.00",
    "", "0", "", "0", "100.00", "USD",
  ].join(",");
}

test.describe("/import wizard malformed/partial/dry-run", () => {
  test("malformed CSV upload surfaces a recoverable error", async ({ isolatedOrg }) => {
    const csv = Buffer.from("not,a,real,header\nfoo,bar,baz,qux\n", "utf-8");
    const r = await isolatedOrg.request.post("/api/import/upload", {
      headers: {
        "X-CSRF-Token": isolatedOrg.csrf,
        // Per-test source IP isolates the per-IP importLimiter (1hr/10).
        "X-Forwarded-For": freshIp(),
      },
      multipart: {
        files: { name: "invoice_details_bogus.csv", mimeType: "text/csv", buffer: csv },
      },
    });
    // The wizard accepts the file but the parser flags it as
    // unrecognized — assertable via either a 4xx or a file entry
    // marked with a non-matching type / 0 row count.
    if (!r.ok()) {
      expect([400, 422]).toContain(r.status());
      return;
    }
    const j = await r.json();
    expect(j).toHaveProperty("files");
    if (j.files?.length) {
      const f = j.files[0];
      // Either the type is recognised (then rowCount must be 0/low) or
      // it's flagged as unknown — either way it is NOT a healthy parse.
      const healthy = f.type && f.type !== "unknown" && f.rowCount > 0;
      expect(healthy).toBe(false);
    }
  });

  test("dry-run hash is stable; execute requires matching planHash", async ({ isolatedOrg }) => {
    const invNum = "E2E" + Date.now().toString(36);
    const buffer = Buffer.from(
      [VALID_HEADER, row(invNum, `E2E Client ${invNum}`)].join("\n"),
      "utf-8",
    );

    const ip = freshIp();
    const ipHeaders = { "X-CSRF-Token": isolatedOrg.csrf, "X-Forwarded-For": ip };

    const upload = await isolatedOrg.request.post("/api/import/upload", {
      headers: ipHeaders,
      multipart: {
        files: { name: "invoice_details_e2e.csv", mimeType: "text/csv", buffer },
      },
    });
    expect(upload.ok()).toBe(true);
    const { importRunId } = await upload.json();

    const options = {
      importClients: true,
      importServices: false,
      servicesNonZeroOnly: false,
      importTeamMembers: false,
      importInvoices: true,
      invoicePaidCutoffStart: "",
      invoicePaidCutoffEnd: "",
      importHistoricalPayments: false,
      importTimeEntries: false,
      timeEntryDateStart: "",
      timeEntryDateEnd: "",
      timeEntrySkipDuplicates: false,
      importImportedPayouts: false,
      payoutDateStart: "",
      payoutDateEnd: "",
    };

    const dry1 = await (await isolatedOrg.request.post(
      `/api/import/dry-run/${importRunId}`,
      { headers: ipHeaders, data: options },
    )).json();
    const dry2 = await (await isolatedOrg.request.post(
      `/api/import/dry-run/${importRunId}`,
      { headers: ipHeaders, data: options },
    )).json();
    expect(dry1.planHash).toBe(dry2.planHash);
    expect(dry1.invoicesToCreate).toBe(1);

    // Mismatched plan hash: the execute endpoint must refuse.
    const badExec = await isolatedOrg.request.post(
      `/api/import/execute/${importRunId}`,
      {
        headers: ipHeaders,
        data: { ...options, planHash: "deadbeef" },
      },
    );
    expect([400, 409, 422]).toContain(badExec.status());

    // Correct hash: execute succeeds.
    const goodExec = await isolatedOrg.request.post(
      `/api/import/execute/${importRunId}`,
      {
        headers: ipHeaders,
        data: { ...options, planHash: dry1.planHash },
      },
    );
    expect(goodExec.ok()).toBe(true);
    const ex = await goodExec.json();
    expect(ex.status).toBe("COMPLETED");
  });
});
