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

test.describe("/import wizard malformed/dry-run", () => {
  test("malformed CSV upload returns no healthy parsed file", async ({ isolatedOrg }) => {
    const csv = Buffer.from("not,a,real,header\nfoo,bar,baz,qux\n", "utf-8");
    const r = await isolatedOrg.request.post("/api/import/upload", {
      headers: { "X-CSRF-Token": isolatedOrg.csrf, "X-Forwarded-For": freshIp() },
      multipart: {
        files: { name: "invoice_details_bogus.csv", mimeType: "text/csv", buffer: csv },
      },
    });
    expect([200, 400, 422]).toContain(r.status());
    if (r.status() === 200) {
      const j = await r.json();
      expect(j).toHaveProperty("files");
      const anyHealthy = (j.files ?? []).some(
        (f: { type?: string; rowCount?: number }) =>
          f.type && f.type !== "unknown" && (f.rowCount ?? 0) > 0,
      );
      expect(anyHealthy, "malformed header must NOT yield a healthy file entry").toBe(false);
    }
  });

  test("dry-run hash is stable across reruns and execute requires matching planHash", async ({ isolatedOrg }) => {
    const invNum = "E2E" + Date.now().toString(36);
    const buffer = Buffer.from(
      [VALID_HEADER, row(invNum, `E2E Client ${invNum}`)].join("\n"),
      "utf-8",
    );
    const ip = freshIp();
    const ipHeaders = { "X-CSRF-Token": isolatedOrg.csrf, "X-Forwarded-For": ip };

    const upload = await isolatedOrg.request.post("/api/import/upload", {
      headers: ipHeaders,
      multipart: { files: { name: "invoice_details_e2e.csv", mimeType: "text/csv", buffer } },
    });
    expect(upload.ok()).toBe(true);
    const { importRunId } = await upload.json();

    const options = {
      importClients: true, importServices: false, servicesNonZeroOnly: false,
      importTeamMembers: false, importInvoices: true,
      invoicePaidCutoffStart: "", invoicePaidCutoffEnd: "",
      importHistoricalPayments: false, importTimeEntries: false,
      timeEntryDateStart: "", timeEntryDateEnd: "", timeEntrySkipDuplicates: false,
      importImportedPayouts: false, payoutDateStart: "", payoutDateEnd: "",
    };

    const dry1 = await (await isolatedOrg.request.post(
      `/api/import/dry-run/${importRunId}`,
      { headers: ipHeaders, data: options },
    )).json();
    const dry2 = await (await isolatedOrg.request.post(
      `/api/import/dry-run/${importRunId}`,
      { headers: ipHeaders, data: options },
    )).json();
    expect(dry1.planHash).toBeTruthy();
    expect(dry1.planHash).toBe(dry2.planHash);
    expect(dry1.invoicesToCreate).toBe(1);

    const badExec = await isolatedOrg.request.post(
      `/api/import/execute/${importRunId}`,
      { headers: ipHeaders, data: { ...options, planHash: "deadbeef" } },
    );
    expect([400, 409, 422]).toContain(badExec.status());

    const goodExec = await isolatedOrg.request.post(
      `/api/import/execute/${importRunId}`,
      { headers: ipHeaders, data: { ...options, planHash: dry1.planHash } },
    );
    expect(goodExec.ok()).toBe(true);
    const ex = await goodExec.json();
    expect(ex.status).toBe("COMPLETED");
    // dry-run reconciliation legs are present on the executed run
    expect(dry1.reconciliation).toBeTruthy();
    expect(dry1.reconciliation.invoiceTotal).toBeTruthy();
    expect(dry1.reconciliation.timeHours).toBeTruthy();
    expect(dry1.reconciliation.expenseTotal).toBeTruthy();
  });
});
