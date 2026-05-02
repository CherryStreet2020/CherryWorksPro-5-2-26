-- Task #322: Allow each org to set its own large-audience warning
-- threshold for the marketing campaign editor. Previously a hard-coded
-- module constant of 1000 in server/routes/marketing/campaigns.ts.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS marketing_large_audience_threshold INTEGER NOT NULL DEFAULT 1000;
