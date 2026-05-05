-- orgs.show_time_entry_details: org-wide default (NOT NULL, defaults to false).
-- invoices.show_time_entry_details: per-invoice override; NULL = use org default.
-- Display-only; money totals stay driven by `invoice_lines`.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS show_time_entry_details boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS show_time_entry_details boolean;
