-- Read-only report API. Apply schema through an approved migration transaction.
-- These indexes support small per-product lookups in both temporal directions.
CREATE INDEX IF NOT EXISTS item_activity_logs_stock_balance_idx
 ON public.item_activity_logs (store_id COLLATE pg_catalog."C", product_id, created_at, id);
CREATE INDEX IF NOT EXISTS stock_adjustments_stock_balance_idx
 ON public.stock_adjustments (store_id COLLATE pg_catalog."C", product_id, created_at, id);

CREATE OR REPLACE FUNCTION public.pos_stock_activity_balances_v1(
 p_branch text, p_cutoff timestamptz, p_product_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
SET TimeZone = 'UTC'
AS $fn$
DECLARE
 result jsonb;
BEGIN
 -- The caller service authenticates staff and resolves the branch before this
 -- private-to-service endpoint. Scope each source before its order and limit.
 IF current_user <> 'service_role' THEN
  RAISE EXCEPTION 'STOCK_ACTIVITY_BALANCES_DENIED' USING ERRCODE = '42501';
 END IF;
 IF p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128
  OR p_branch <> btrim(p_branch) OR p_branch COLLATE pg_catalog."C" ~ '[[:cntrl:]]'
  OR p_cutoff IS NULL OR NOT isfinite(p_cutoff)
  OR p_product_ids IS NULL OR array_ndims(p_product_ids) IS DISTINCT FROM 1
  OR cardinality(p_product_ids) NOT BETWEEN 1 AND 50
  OR (SELECT count(DISTINCT product_id) FROM unnest(p_product_ids) AS ids(product_id)) <> cardinality(p_product_ids)
 THEN
  RAISE EXCEPTION 'STOCK_ACTIVITY_BALANCES_INVALID' USING ERRCODE = '22023';
 END IF;

 WITH evidence AS (
  SELECT ids.product_id, ids.position,
   COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC, a.id DESC) FROM (
     SELECT l.id, l.product_id, left(l.product_name, 300) AS product_name, l.store_id, l.created_at,
      l.activity_type, left(l.reference, 240) AS reference, l.quantity_delta, l.stock_before, l.stock_after
     FROM public.item_activity_logs l
     WHERE l.store_id COLLATE pg_catalog."C" = p_branch AND l.product_id = ids.product_id AND l.created_at <= p_cutoff
     ORDER BY l.created_at DESC, l.id DESC LIMIT 3
    ) a
   ), '[]'::jsonb) AS through_activity,
   COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC, a.id DESC) FROM (
     SELECT s.id, s.product_id, left(s.product_name, 300) AS product_name, s.store_id, s.created_at,
      s.delta, s.previous_stock, s.updated_stock
     FROM public.stock_adjustments s
     WHERE s.store_id COLLATE pg_catalog."C" = p_branch AND s.product_id = ids.product_id AND s.created_at <= p_cutoff
     ORDER BY s.created_at DESC, s.id DESC LIMIT 3
    ) a
   ), '[]'::jsonb) AS through_adjustments,
   COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id) FROM (
     SELECT l.id, l.product_id, left(l.product_name, 300) AS product_name, l.store_id, l.created_at,
      l.activity_type, left(l.reference, 240) AS reference, l.quantity_delta, l.stock_before, l.stock_after
     FROM public.item_activity_logs l
     WHERE l.store_id COLLATE pg_catalog."C" = p_branch AND l.product_id = ids.product_id AND l.created_at > p_cutoff
     ORDER BY l.created_at, l.id LIMIT 2
    ) a
   ), '[]'::jsonb) AS after_activity,
   COALESCE((
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id) FROM (
     SELECT s.id, s.product_id, left(s.product_name, 300) AS product_name, s.store_id, s.created_at,
      s.delta, s.previous_stock, s.updated_stock
     FROM public.stock_adjustments s
     WHERE s.store_id COLLATE pg_catalog."C" = p_branch AND s.product_id = ids.product_id AND s.created_at > p_cutoff
     ORDER BY s.created_at, s.id LIMIT 2
    ) a
   ), '[]'::jsonb) AS after_adjustments
  FROM unnest(p_product_ids) WITH ORDINALITY AS ids(product_id, position)
 )
 SELECT jsonb_agg(to_jsonb(evidence) - 'position' ORDER BY evidence.position) INTO result
 FROM evidence;
 RETURN result;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.pos_stock_activity_balances_v1(text,timestamptz,uuid[])
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_activity_balances_v1(text,timestamptz,uuid[]) TO service_role;
