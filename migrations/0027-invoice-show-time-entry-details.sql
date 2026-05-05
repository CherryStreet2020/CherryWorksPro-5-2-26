-- Task #465: Optionally render the underlying time-entry detail rows
-- (day headers, per-entry rows, weekly subtotals) under each aggregated
-- invoice line on the PDF, public web view, and in-app preview.
--
-- Two new columns:
--   * orgs.show_time_entry_details         — org-wide default (NOT NULL,
--     defaults to false so existing tenants behave exactly as before).
--   * invoices.show_time_entry_details     — per-invoice override; NULL
--     means "use org default", true/false means "force this state for
--     this invoice regardless of the org default".
--
-- Money totals continue to be driven exclusively by `invoice_lines`;
-- these flags only control whether the detail block renders.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS show_time_entry_details boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS show_time_entry_details boolean;
