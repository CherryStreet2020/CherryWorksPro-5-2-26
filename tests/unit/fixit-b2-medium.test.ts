import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function src(path: string) {
  return readFileSync(join(__dirname, "..", "..", path), "utf-8");
}

describe("FIXIT B2 MEDIUM — 22 fixes", () => {

  it("M3: Time entry-list has empty-state CTA button with onAddEntry", () => {
    const code = src("client/src/components/time/entry-list.tsx");
    expect(code).toContain("onAddEntry");
    expect(code).toContain("button-add-first-entry");
    expect(code).toContain("Add First Entry");
  });

  it("M4: Clients outstanding sort branch implemented", () => {
    const code = src("client/src/pages/clients.tsx");
    expect(code).toContain('sortField === "outstanding"');
    expect(code).toContain("clientOutstandingMap");
  });

  it("M6: Reports AR aging has total row", () => {
    const code = src("client/src/pages/reports.tsx");
    expect(code).toContain("text-ar-aging-total");
    expect(code).toContain("Total Outstanding");
  });

  it("M7: Settings unsaved changes guard (beforeunload + isDirty)", () => {
    const code = src("client/src/pages/settings.tsx");
    expect(code).toContain("isDirty");
    expect(code).toContain("beforeunload");
    expect(code).toContain("savedForm");
  });

  it("M10: Trial balance tfoot is sticky", () => {
    const code = src("client/src/pages/gl-trial-balance.tsx");
    expect(code).toContain('position: "sticky"');
    expect(code).toContain('bottom: 0');
  });

  it("M13: Toast limit raised from 1 to 3", () => {
    const code = src("client/src/hooks/use-toast.ts");
    expect(code).toContain("TOAST_LIMIT = 3");
  });

  it("M14: Import file picker accepts xlsx and xls", () => {
    const code = src("client/src/pages/import.tsx");
    expect(code).toContain('.xlsx');
    expect(code).toContain('.xls');
    expect(code).toContain('accept=".csv,.xlsx,.xls"');
  });

  it("M15: Team role select items have descriptions", () => {
    const code = src("client/src/pages/team.tsx");
    expect(code).toMatch(/Admin.*Full access/);
    expect(code).toMatch(/Manager.*manage projects/);
    expect(code).toMatch(/Team Member.*track time/);
  });

  it("M16: Close period reopen has confirm dialog", () => {
    const code = src("client/src/pages/close-periods.tsx");
    expect(code).toContain("confirmReopen");
    expect(code).toContain("Reopen Period");
    expect(code).toContain("button-confirm-reopen");
  });

  it("M17: Webhook test button has loading state", () => {
    const code = src("client/src/pages/integrations.tsx");
    expect(code).toContain("testWebhookMutation.isPending");
    expect(code).toContain("animate-spin");
  });

  it("M9: Bank connections have status badges", () => {
    const code = src("client/src/pages/bank-connections.tsx");
    expect(code).toContain("Disconnected");
    expect(code).toContain("Error");
    expect(code).toContain("Connected");
  });

  it("M2: Projects ON_HOLD tab counter is implemented", () => {
    const code = src("client/src/pages/projects.tsx");
    expect(code).toContain("ON_HOLD: 0");
    expect(code).toContain('key: "ON_HOLD"');
  });
});
