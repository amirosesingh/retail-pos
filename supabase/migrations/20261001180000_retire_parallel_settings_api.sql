-- The live POS settings authority is pos_settings + settings_overrides.
-- settings_scoped remains only as the backward-compatible storage used by
-- branch product-price overrides. Preserve all historical rows, but retire
-- the unused generic RPC surface so duplicate printer/tax/session/etc. keys
-- cannot become a second writable source of truth.
REVOKE EXECUTE ON FUNCTION public.settings_effective(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settings_upsert(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settings_sync_batch(text, text, text[]) FROM anon, authenticated;

COMMENT ON TABLE public.settings_scoped IS
  'Backward-compatible scoped product-price overrides only. POS configuration resolves from pos_settings and settings_overrides.';
