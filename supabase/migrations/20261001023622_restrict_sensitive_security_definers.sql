-- PIN verification and scanner ingest are mediated by throttled, authenticated
-- application endpoints.  Direct Data API execution would bypass those checks.
REVOKE EXECUTE ON FUNCTION public.verify_cashier_pin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_terminal_pin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_report_findings(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_cashier_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_terminal_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_report_findings(text, text, jsonb) TO service_role;
