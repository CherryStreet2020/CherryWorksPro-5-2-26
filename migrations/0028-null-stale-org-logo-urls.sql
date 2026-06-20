-- Task #467: production org-logo storage moved from local-disk
-- (`uploads/logos/` served via `/api/uploads/logos/<file>`) to durable
-- Replit Object Storage (served via `/api/public-objects/org-logos/<file>`).
-- Local-disk uploads were ephemeral on every redeploy, so any
-- `orgs.logo_url` value still pointing at the old prefix is guaranteed
-- to 404 in production. Null those rows so the in-app upload prompt
-- (added in client/src/pages/invoices.tsx) shows up and the affected
-- orgs re-upload their logo into durable storage.
--
-- Idempotent: re-running this migration is a no-op on rows whose
-- `logo_url` no longer matches the legacy prefix.
UPDATE orgs
SET logo_url = NULL
WHERE logo_url LIKE '/api/uploads/logos/%';
