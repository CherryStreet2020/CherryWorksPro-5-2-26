-- Task #339 — Sanctioned bypass of the audit_logs immutability trigger
-- so end-to-end tests can fully tear down the throwaway orgs they
-- provision. The trigger `prevent_audit_log_modification` continues
-- to forbid UPDATE / DELETE on audit_logs for normal app traffic; the
-- only escape hatch is a session-local GUC that has to be set
-- explicitly inside the same transaction as the delete:
--
--   BEGIN;
--   SELECT set_config('app.allow_audit_log_modification', 'on', true);
--   DELETE FROM audit_logs WHERE org_id = $1;
--   COMMIT;
--
-- `set_config(..., true)` makes the setting transaction-local so it
-- cannot leak to a subsequent statement on the same pooled connection.
-- Application code never sets this GUC, so the immutability guarantee
-- is preserved end-to-end for production traffic.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('app.allow_audit_log_modification', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Audit logs are immutable: UPDATE and DELETE operations are not allowed';
END;
$function$;
