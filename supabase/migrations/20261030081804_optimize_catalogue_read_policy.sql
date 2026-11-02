-- Read-policy optimization only. Preserve the existing catalogue availability
-- predicates and all checkout, transfer, mutation and ownership helpers.
BEGIN;

CREATE OR REPLACE FUNCTION public.readable_catalogue_product_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH authorized_branches AS MATERIALIZED (
  SELECT s.id,s.group_id FROM public.stores s
  WHERE public.user_has_store_access(s.id)
 ), branch_privacy AS MATERIALIZED (
  -- Resolve the legacy and scoped JSON settings once per branch, not once
  -- per product/branch pair. Reuse the exact existing precedence semantics.
  SELECT s.id,public.branch_catalogue_is_private(s.id) AS private
  FROM public.stores s
 ), cluster_count AS MATERIALIZED (
  SELECT count(DISTINCT NULLIF(btrim(s.group_id),'')) AS total FROM public.stores s
 ), received_catalogue AS MATERIALIZED (
  SELECT DISTINCT i.product_id,destination.id,destination.group_id
  FROM public.stock_transfer_items i
  JOIN public.stock_transfers t ON t.id=i.transfer_id
  JOIN public.stores destination ON destination.id=t.to_store_id
  WHERE t.posted_at IS NOT NULL AND t.status IN ('completed','completed_with_discrepancy')
    AND COALESCE(i.quantity_verified,i.quantity_received,0)>0
 )
 SELECT p.id FROM public.products p
 LEFT JOIN public.stores owner ON owner.id=p.owner_store_id
 WHERE (SELECT public.is_staff_now()) AND EXISTS (
  SELECT 1 FROM authorized_branches target
  WHERE p.owner_store_id=target.id
   OR (NULLIF(btrim(owner.group_id),'') IS NOT NULL AND btrim(owner.group_id)=btrim(target.group_id))
   OR (owner.id IS NOT NULL AND NULLIF(btrim(owner.group_id),'') IS NULL AND NULLIF(btrim(target.group_id),'') IS NULL
       AND NOT (SELECT privacy.private FROM branch_privacy privacy WHERE privacy.id=owner.id)
       AND NOT (SELECT privacy.private FROM branch_privacy privacy WHERE privacy.id=target.id))
   OR EXISTS (
    SELECT 1 FROM received_catalogue received WHERE received.product_id=p.id
      AND (received.id=target.id OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(received.group_id)=btrim(target.group_id)))
   )
   OR (NULLIF(btrim(p.owner_store_id),'') IS NULL AND (
    EXISTS (
     SELECT 1 FROM jsonb_each_text(COALESCE(p.stock_by_store,'{}'::jsonb)) stock
     JOIN public.stores evidence ON lower(evidence.id)=lower(stock.key)
     WHERE (evidence.id=target.id OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(evidence.group_id)=btrim(target.group_id)))
       AND CASE WHEN stock.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN stock.value::numeric<>0 ELSE false END
    )
    OR (NOT (SELECT privacy.private FROM branch_privacy privacy WHERE privacy.id=target.id)
        AND (SELECT total FROM cluster_count)<=1)
   ))
 )
$fn$;
REVOKE ALL ON FUNCTION public.readable_catalogue_product_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.readable_catalogue_product_ids() TO authenticated,service_role;

-- The uncorrelated set is computed once per SELECT statement; the former
-- product-specific function repeated the same branch/settings work per row.
DROP POLICY IF EXISTS "Staff can read products" ON public.products;
CREATE POLICY "Staff can read products" ON public.products FOR SELECT TO authenticated
 USING (id IN (SELECT public.readable_catalogue_product_ids()));
NOTIFY pgrst,'reload schema';
COMMIT;
