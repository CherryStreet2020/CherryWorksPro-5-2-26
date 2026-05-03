import { test, expect } from "../helpers/po/fixtures";
import { postJson } from "./_helpers";

function generateInvoiceCSV(invNum: string, clientName: string): Buffer {
  const header =
    "Client Name,Invoice #,Date Issued,Date Due,Invoice Status,Date Paid,Item Name,Item Description,Rate,Quantity,Discount Percentage,Line Subtotal,Tax 1 Type,Tax 1 Amount,Tax 2 Type,Tax 2 Amount,Line Total,Currency";
  const line1 = [
    clientName,
    invNum,
    "01/15/2026",
    "02/15/2026",
    "overdue",
    "",
    "Consulting Services",
    "Strategic consulting engagement",
    "150.00",
    "4",
    "0",
    "600.00",
    "",
    "0",
    "",
    "0",
    "600.00",
    "USD",
  ].join(",");
  const line2 = [
    clientName,
    invNum,
    "01/15/2026",
    "02/15/2026",
    "overdue",
    "",
    "Project Management",
    "PM oversight and coordination",
    "125.00",
    "2",
    "0",
    "250.00",
    "",
    "0",
    "",
    "0",
    "250.00",
    "USD",
  ].join(",");
  return Buffer.from([header, line1, line2].join("\n"), "utf-8");
}

test("import wizard: upload, selective import, idempotent check, rollback", async ({
  isolatedOrg,
}) => {
  const invNum = "9" + String(Date.now());
  const clientName = `E2E Import Client ${invNum}`;
  const csvBuffer = generateInvoiceCSV(invNum, clientName);

  const uploadRes = await isolatedOrg.request.post("/api/import/upload", {
    multipart: {
      files: {
        name: "invoice_details_generated.csv",
        mimeType: "text/csv",
        buffer: csvBuffer,
      },
    },
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(uploadRes.ok()).toBe(true);
  const uploadData = await uploadRes.json();
  expect(uploadData.importRunId).toBeTruthy();
  expect(uploadData.files.length).toBe(1);

  const importRunId = uploadData.importRunId;

  const invoicePreflight = uploadData.files[0];
  expect(invoicePreflight.type).toBe("invoice_details");
  expect(invoicePreflight.rowCount).toBe(2);
  expect(invoicePreflight.sha256).toHaveLength(64);
  expect(invoicePreflight.uniqueInvoiceNumbers).toEqual([invNum]);
  expect(invoicePreflight.totalInvoiceLineSum).toBe(850);
  expect(invoicePreflight.openARSum).toBe(850);

  const importOptions = {
    importClients: false,
    importServices: false,
    servicesNonZeroOnly: false,
    importTeamMembers: false,
    importInvoices: true,
    invoicePaidCutoffStart: "",
    invoicePaidCutoffEnd: "",
    importHistoricalPayments: true,
    importTimeEntries: false,
    timeEntryDateStart: "",
    timeEntryDateEnd: "",
    timeEntrySkipDuplicates: false,
    importImportedPayouts: false,
    payoutDateStart: "",
    payoutDateEnd: "",
  };

  const dryRunRes = await postJson(
    isolatedOrg,
    `/api/import/dry-run/${importRunId}`,
    importOptions,
  );
  expect(dryRunRes.ok()).toBe(true);
  const dryPlan = await dryRunRes.json();
  expect(dryPlan.invoicesToCreate).toBe(1);

  const execRes = await postJson(isolatedOrg, `/api/import/execute/${importRunId}`, {
    ...importOptions,
    planHash: dryPlan.planHash,
  });
  expect(execRes.ok()).toBe(true);
  const execData = await execRes.json();
  expect(execData.status).toBe("COMPLETED");
  expect(execData.counts.invoice).toBe(1);

  const runDetailRes = await isolatedOrg.request.get(`/api/import/runs/${importRunId}`);
  expect(runDetailRes.ok()).toBe(true);
  const runDetail = await runDetailRes.json();
  expect(runDetail.status).toBe("COMPLETED");
  expect(runDetail.importedKeyCount).toBeGreaterThan(0);

  const reExecRes = await postJson(
    isolatedOrg,
    `/api/import/execute/${importRunId}`,
    importOptions,
  );
  expect(reExecRes.ok()).toBe(false);
  const reExecData = await reExecRes.json();
  expect(reExecData.message).toContain("cannot execute");

  const uploadRes2 = await isolatedOrg.request.post("/api/import/upload", {
    multipart: {
      files: {
        name: "invoice_details_generated.csv",
        mimeType: "text/csv",
        buffer: csvBuffer,
      },
    },
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(uploadRes2.ok()).toBe(true);
  const uploadData2 = await uploadRes2.json();
  const importRunId2 = uploadData2.importRunId;

  const dryRunRes2 = await postJson(
    isolatedOrg,
    `/api/import/dry-run/${importRunId2}`,
    importOptions,
  );
  expect(dryRunRes2.ok()).toBe(true);
  const dryPlan2 = await dryRunRes2.json();
  expect(dryPlan2.invoicesToCreate).toBe(0);
  expect(dryPlan2.skippedDuplicateKeys).toBeGreaterThan(0);

  const rollbackRes = await postJson(
    isolatedOrg,
    `/api/import/rollback/${importRunId}`,
    {},
  );
  expect(rollbackRes.ok()).toBe(true);
  const rollbackData = await rollbackRes.json();
  expect(rollbackData.status).toBe("ROLLED_BACK");

  const runAfterRollback = await isolatedOrg.request.get(`/api/import/runs/${importRunId}`);
  const runAfterData = await runAfterRollback.json();
  expect(runAfterData.status).toBe("ROLLED_BACK");

  const runsListRes = await isolatedOrg.request.get("/api/import/runs");
  expect(runsListRes.ok()).toBe(true);
  const runsList = await runsListRes.json();
  expect(runsList.length).toBeGreaterThanOrEqual(2);
});
