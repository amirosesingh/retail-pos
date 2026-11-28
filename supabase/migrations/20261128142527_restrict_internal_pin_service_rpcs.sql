-- These routines belong to the authorized application services. Keep the
-- existing service_role and function owner privileges.
REVOKE EXECUTE ON FUNCTION
  public.legacy_cashiers_for_migration(),
  public.pin_throttle_fail(text, integer, integer, integer),
  public.pin_throttle_reset(text),
  public.pin_throttle_status(text)
FROM PUBLIC, anon, authenticated;
