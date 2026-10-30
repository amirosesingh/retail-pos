-- Owner-approved preparation and isolated tests only; not approved for live apply.
-- Read-only service sync optimization. Explicit branch scope is distinct from
-- the authenticated browser's union of authorized catalogue branches.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogue_product_ids_for_branch(p_branch text)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH target AS MATERIALIZED (
  SELECT s.id,s.group_id,public.branch_catalogue_is_private(s.id) AS private
  FROM public.stores s WHERE s.id=p_branch
 ), branch_privacy AS MATERIALIZED (
  SELECT s.id,public.branch_catalogue_is_private(s.id) AS private FROM public.stores s
 ), cluster_count AS MATERIALIZED (
  SELECT count(DISTINCT NULLIF(btrim(s.group_id),'')) AS total FROM public.stores s
 ), received_catalogue AS MATERIALIZED (
  SELECT DISTINCT i.product_id FROM public.stock_transfer_items i
  JOIN public.stock_transfers t ON t.id=i.transfer_id
  JOIN public.stores destination ON destination.id=t.to_store_id
  JOIN target ON destination.id=target.id
    OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(destination.group_id)=btrim(target.group_id))
  WHERE t.posted_at IS NOT NULL AND t.status IN ('completed','completed_with_discrepancy')
    AND COALESCE(i.quantity_verified,i.quantity_received,0)>0
 )
 SELECT p.id FROM public.products p
 LEFT JOIN public.stores owner ON owner.id=p.owner_store_id
 CROSS JOIN target
 WHERE p.owner_store_id=target.id
  OR (NULLIF(btrim(owner.group_id),'') IS NOT NULL AND btrim(owner.group_id)=btrim(target.group_id))
  OR (owner.id IS NOT NULL AND NULLIF(btrim(owner.group_id),'') IS NULL AND NULLIF(btrim(target.group_id),'') IS NULL
      AND NOT (SELECT privacy.private FROM branch_privacy privacy WHERE privacy.id=owner.id)
      AND NOT target.private)
  OR EXISTS (SELECT 1 FROM received_catalogue received WHERE received.product_id=p.id)
  OR (NULLIF(btrim(p.owner_store_id),'') IS NULL AND (
   EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(p.stock_by_store,'{}'::jsonb)) stock
    JOIN public.stores evidence ON lower(evidence.id)=lower(stock.key)
    WHERE (evidence.id=target.id OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(evidence.group_id)=btrim(target.group_id)))
      AND CASE WHEN stock.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN stock.value::numeric<>0 ELSE false END
   )
   OR (NOT target.private AND (SELECT total FROM cluster_count)<=1)
  ))
$fn$;
REVOKE ALL ON FUNCTION public.catalogue_product_ids_for_branch(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogue_product_ids_for_branch(text) TO service_role;

DO $branch_catalogue_sync_reads$
DECLARE
 signature text;
 definition text;
 before_patch text;
 table_name text;
 marker text;
 start_at integer;
 end_at integer;
 read_case text;
 old_predicate text;
 new_predicate text;
 patched_case text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)',
  'public.pos_sync_counts_scoped(text,text,text,integer)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  before_patch:=definition;
  IF strpos(definition,'public.pos_sync_validate_read_scope(')=0 THEN
   RAISE EXCEPTION 'Expected validated read scope absent from %',signature;
  END IF;
  FOREACH table_name IN ARRAY ARRAY['products','product_barcodes'] LOOP
   IF signature LIKE '%bootstrap%' THEN
    marker:=format('WHEN %L THEN',table_name);
   ELSE
    marker:=format('SELECT %L::text table_name,',table_name);
   END IF;
   start_at:=strpos(definition,marker);
   IF start_at=0 THEN RAISE EXCEPTION 'Missing inspected sync table % in %',table_name,signature; END IF;
   IF signature LIKE '%bootstrap%' THEN
    end_at:=strpos(substring(definition FROM start_at),';');
   ELSE
    end_at:=strpos(substring(definition FROM start_at),' UNION ALL ')-1;
   END IF;
   IF end_at<=0 THEN RAISE EXCEPTION 'Unknown sync table boundary % in %',table_name,signature; END IF;
   read_case:=substring(definition FROM start_at FOR end_at);
   IF table_name='products' THEN
    old_predicate:='public.product_available_in_catalogue(x.id,p_branch_id)';
    new_predicate:='x.id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))';
   ELSE
    old_predicate:='EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND public.product_available_in_catalogue(p.id,p_branch_id))';
    new_predicate:='x.product_id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))';
   END IF;
   IF strpos(read_case,old_predicate)>0 THEN
    patched_case:=replace(read_case,old_predicate,new_predicate);
    definition:=overlay(definition PLACING patched_case FROM start_at FOR end_at);
   ELSIF strpos(read_case,new_predicate)=0 THEN
    RAISE EXCEPTION 'Unrecognized catalogue predicate % in %',table_name,signature;
   END IF;
  END LOOP;
  IF definition<>before_patch THEN EXECUTE definition; END IF;
 END LOOP;
END $branch_catalogue_sync_reads$;
NOTIFY pgrst,'reload schema';
COMMIT;
