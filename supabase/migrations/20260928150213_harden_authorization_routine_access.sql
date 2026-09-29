-- Authorization decisions and PIN checks are server-mediated. Direct Data API
-- execution would bypass the branch-bound request and audit layer.
REVOKE ALL ON FUNCTION public.verify_manager_pin(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_manager_pin(text, text, text, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.set_authorization_pin(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_authorization_pin(text, text, text)
  TO service_role;
