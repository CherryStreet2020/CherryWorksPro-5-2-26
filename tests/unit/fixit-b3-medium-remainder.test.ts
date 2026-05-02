import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function src(path: string) {
  return readFileSync(join(__dirname, "..", "..", path), "utf-8");
}

describe("FIXIT B3 MEDIUM REMAINDER — 11 fixes", () => {

  it("M5: Invoices bulk delete with confirmation dialog", () => {
    const code = src("client/src/pages/invoices.tsx");
    expect(code).toContain("bulk-delete");
    expect(code).toContain("button-bulk-delete");
    expect(code).toContain("selectedIds");
  });

  it("M6: Estimates ACCEPTED row has Convert-to-Invoice button", () => {
    const code = src("client/src/pages/estimates.tsx");
    expect(code).toContain("convert-to-invoice");
    expect(code).toContain("ACCEPTED");
  });

  it("M7: Payments KPI wired to date filter range", () => {
    const code = src("client/src/pages/payments.tsx");
    expect(code).toContain("kpiPayments");
    expect(code).toContain("dateFrom");
    expect(code).toContain("dateTo");
  });

  it("M10: Services unique name index in migrate-production", () => {
    const code = src("server/migrate-production.ts");
    expect(code).toContain("uq_services_org_name");
    expect(code).toContain("lower(name)");
  });

  it("M10: Services route returns 409 on duplicate", () => {
    const code = src("server/routes/project-routes.ts");
    expect(code).toContain("409");
    expect(code).toContain("23505");
  });

  it("M12: Payouts CSV export button", () => {
    const code = src("client/src/pages/payouts.tsx");
    expect(code).toContain("button-export-payouts-csv");
    expect(code).toContain("text/csv");
  });

  it("M14: Chart of Accounts search input wired", () => {
    const code = src("client/src/pages/gl-accounts.tsx");
    expect(code).toContain("input-search-accounts");
    expect(code).toContain("searchQuery");
  });

  it("M15: GL Ledger URL params for date filters", () => {
    const code = src("client/src/pages/gl-ledger.tsx");
    expect(code).toContain("URLSearchParams");
    expect(code).toContain("replaceState");
  });

  it("M16: Journal Entries preview modal before posting", () => {
    const code = src("client/src/pages/gl-journal-entries.tsx");
    expect(code).toContain("previewOpen");
    expect(code).toContain("handlePreview");
    expect(code).toContain("handleConfirmPost");
    expect(code).toContain("Review Journal Entry");
    expect(code).toContain("button-confirm-post-je");
  });

  it("M19: AR Aging PDF export endpoint exists", () => {
    const code = src("server/routes/report-routes.ts");
    expect(code).toContain("/api/reports/ar-aging/pdf");
    expect(code).toContain("PDFDocument");
    expect(code).toContain("Accounts Receivable Aging Report");
  });

  it("M19: AR Aging PDF button on reports page", () => {
    const code = src("client/src/pages/reports.tsx");
    expect(code).toContain("btn-pdf-ar");
    expect(code).toContain("/api/reports/ar-aging/pdf");
  });

  it("M25: Profile avatar upload endpoint exists", () => {
    const code = src("server/routes/auth-routes.ts");
    expect(code).toContain("/api/auth/me/avatar");
    expect(code).toContain("avatarUpload");
    expect(code).toContain("multer");
  });

  it("M25: Profile page has avatar upload UI", () => {
    const code = src("client/src/pages/profile.tsx");
    expect(code).toContain("button-avatar-upload");
    expect(code).toContain("input-avatar-file");
    expect(code).toContain("avatarMutation");
    expect(code).toContain("avatarPreview");
  });

  it("M13: Approvals bulk approve pre-existing", () => {
    const code = src("client/src/pages/approvals.tsx");
    expect(code).toContain("bulk-approve");
    expect(code).toContain("button-bulk-approve");
  });
});
