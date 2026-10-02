-- Terminal-scoped replacements are already installed. Remove the obsolete
-- overloads so no service client can bypass terminal validation or receive an
-- unredacted membership row through the older RPC signatures.
DROP FUNCTION IF EXISTS public.pos_sync_pull(text, text, bigint, integer);
DROP FUNCTION IF EXISTS public.pos_sync_bootstrap(text, text, text, text, integer, integer);

NOTIFY pgrst, 'reload schema';
