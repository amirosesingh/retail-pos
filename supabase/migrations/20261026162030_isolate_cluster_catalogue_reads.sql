-- Read availability is separate from permission to edit another branch's product.
-- No ownership backfill, product rewrite, or widening of upload/write permissions.
BEGIN;
-- A product carries only destination branch IDs, not private transfer history.
-- Users without transfer-history permission still need this proof after a
-- legitimate receipt has subsequently sold down to zero.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalogue_store_ids text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.received_product_catalogue_stores(p_product uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE(array_agg(DISTINCT t.to_store_id ORDER BY t.to_store_id),ARRAY[]::text[])
 FROM public.stock_transfer_items i JOIN public.stock_transfers t ON t.id=i.transfer_id
 WHERE i.product_id=p_product AND t.posted_at IS NOT NULL
  AND t.status IN ('completed','completed_with_discrepancy')
  AND COALESCE(i.quantity_verified,i.quantity_received,0)>0
$fn$;
REVOKE ALL ON FUNCTION public.received_product_catalogue_stores(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.received_product_catalogue_stores(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.protect_product_catalogue_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 -- Ignore forged or stale cloud/cache projections, including service uploads.
 NEW.catalogue_store_ids:=public.received_product_catalogue_stores(NEW.id);
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.protect_product_catalogue_projection() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS products_catalogue_projection ON public.products;
CREATE TRIGGER products_catalogue_projection BEFORE INSERT OR UPDATE ON public.products
 FOR EACH ROW EXECUTE FUNCTION public.protect_product_catalogue_projection();

CREATE OR REPLACE FUNCTION public.refresh_transfer_catalogue_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE affected uuid[]; old_id uuid; new_id uuid;
BEGIN
 IF TG_TABLE_NAME='stock_transfer_items' THEN
  IF TG_OP<>'INSERT' THEN old_id:=OLD.product_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.product_id; END IF;
  affected:=ARRAY[old_id,new_id];
 ELSE
  IF TG_OP<>'INSERT' THEN old_id:=OLD.id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.id; END IF;
  SELECT array_agg(DISTINCT i.product_id) INTO affected FROM public.stock_transfer_items i
   WHERE i.transfer_id=ANY(ARRAY[old_id,new_id]);
 END IF;
 UPDATE public.products p SET catalogue_store_ids=public.received_product_catalogue_stores(p.id)
 WHERE p.id=ANY(affected) AND p.catalogue_store_ids IS DISTINCT FROM public.received_product_catalogue_stores(p.id);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.refresh_transfer_catalogue_projection() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stock_transfers_catalogue_projection ON public.stock_transfers;
CREATE TRIGGER stock_transfers_catalogue_projection AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfers
 FOR EACH ROW EXECUTE FUNCTION public.refresh_transfer_catalogue_projection();
DROP TRIGGER IF EXISTS stock_transfer_items_catalogue_projection ON public.stock_transfer_items;
CREATE TRIGGER stock_transfer_items_catalogue_projection AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfer_items
 FOR EACH ROW EXECUTE FUNCTION public.refresh_transfer_catalogue_projection();

UPDATE public.products p SET catalogue_store_ids=public.received_product_catalogue_stores(p.id)
 WHERE p.catalogue_store_ids IS DISTINCT FROM public.received_product_catalogue_stores(p.id);

CREATE OR REPLACE FUNCTION public.branch_catalogue_is_private(p_branch text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT s.private_catalogue FROM public.stores s WHERE s.id=p_branch),true)
 OR EXISTS (
  SELECT 1 FROM public.pos_settings settings
  CROSS JOIN LATERAL jsonb_each(COALESCE(settings.integration_settings->'branches','{}'::jsonb)) branch
  WHERE lower(branch.key)=lower(p_branch) AND branch.value->>'privateCatalogue'='true'
 ) OR EXISTS (
  SELECT 1 FROM public.settings_scoped settings
  CROSS JOIN LATERAL jsonb_each(COALESCE(settings.value->'branches','{}'::jsonb)) branch
  WHERE settings.scope='GLOBAL' AND settings.scope_id='' AND settings.key='pos_field:integration_settings'
   AND lower(branch.key)=lower(p_branch) AND branch.value->>'privateCatalogue'='true'
 )
$fn$;
REVOKE ALL ON FUNCTION public.branch_catalogue_is_private(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.branch_catalogue_is_private(text) TO service_role;
CREATE OR REPLACE FUNCTION public.product_available_in_catalogue(p_product uuid,p_branch text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS (
  SELECT 1 FROM public.products p JOIN public.stores target ON target.id=p_branch
  LEFT JOIN public.stores owner ON owner.id=p.owner_store_id
  WHERE p.id=p_product AND (
   p.owner_store_id=target.id
   OR (NULLIF(btrim(owner.group_id),'') IS NOT NULL AND btrim(owner.group_id)=btrim(target.group_id))
   OR (owner.id IS NOT NULL AND NULLIF(btrim(owner.group_id),'') IS NULL AND NULLIF(btrim(target.group_id),'') IS NULL
       AND NOT public.branch_catalogue_is_private(owner.id) AND NOT public.branch_catalogue_is_private(target.id))
   OR EXISTS (
    SELECT 1 FROM public.stock_transfer_items i
    JOIN public.stock_transfers t ON t.id=i.transfer_id
    JOIN public.stores destination ON destination.id=t.to_store_id
    WHERE i.product_id=p.id AND t.posted_at IS NOT NULL
      AND t.status IN ('completed','completed_with_discrepancy')
      AND COALESCE(i.quantity_verified,i.quantity_received,0)>0
      AND (destination.id=target.id OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(destination.group_id)=btrim(target.group_id)))
   )
   OR (NULLIF(btrim(p.owner_store_id),'') IS NULL AND (
    EXISTS (
     SELECT 1 FROM jsonb_each_text(COALESCE(p.stock_by_store,'{}'::jsonb)) stock
     JOIN public.stores evidence ON lower(evidence.id)=lower(stock.key)
     WHERE (evidence.id=target.id OR (NULLIF(btrim(target.group_id),'') IS NOT NULL AND btrim(evidence.group_id)=btrim(target.group_id)))
       AND CASE WHEN stock.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN stock.value::numeric<>0 ELSE false END
    )
    OR (NOT public.branch_catalogue_is_private(target.id) AND (SELECT count(DISTINCT NULLIF(btrim(s.group_id),'')) FROM public.stores s)<=1)
   ))
  )
 )
$fn$;
REVOKE ALL ON FUNCTION public.product_available_in_catalogue(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_available_in_catalogue(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.product_catalogue_visible_to_me(p_product uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT public.is_staff_now() AND EXISTS (
  SELECT 1 FROM public.stores s WHERE public.user_has_store_access(s.id)
   AND public.product_available_in_catalogue(p_product,s.id)
 )
$fn$;
REVOKE ALL ON FUNCTION public.product_catalogue_visible_to_me(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_catalogue_visible_to_me(uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Staff can read products" ON public.products;
CREATE POLICY "Staff can read products" ON public.products FOR SELECT TO authenticated
 USING (public.product_catalogue_visible_to_me(id));

-- Patch only exact, inspected read predicates. Abort on an unfamiliar deployed
-- function contract instead of guessing at or replacing other business logic.
DO $read_contracts$
DECLARE signature text; definition text; before_patch text; old_predicate text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)',
  'public.pos_sync_counts_scoped(text,text,text,integer)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  before_patch:=definition;
  old_predicate:='(NULLIF(x.owner_store_id::text,'''') IS NULL OR x.owner_store_id::text=p_branch_id)';
  IF position(old_predicate IN definition)=0 AND position('product_available_in_catalogue(x.id,p_branch_id)' IN definition)=0 THEN
   RAISE EXCEPTION 'Expected product read scope not found in %',signature;
  END IF;
  definition:=replace(definition,old_predicate,'public.product_available_in_catalogue(x.id,p_branch_id)');
  old_predicate:='(NULLIF(p.owner_store_id::text,'''') IS NULL OR p.owner_store_id::text=p_branch_id)';
  IF position(old_predicate IN definition)=0 AND position('product_available_in_catalogue(p.id,p_branch_id)' IN definition)=0 THEN
   RAISE EXCEPTION 'Expected linked-product read scope not found in %',signature;
  END IF;
  definition:=replace(definition,old_predicate,'public.product_available_in_catalogue(p.id,p_branch_id)');
  IF definition<>before_patch THEN EXECUTE definition; END IF;
 END LOOP;
 SELECT pg_get_functiondef('public.pos_sync_pull(text,text,text,bigint,integer)'::regprocedure) INTO definition;
 FOREACH signature IN ARRAY ARRAY['products','product_barcodes','promotions'] LOOP
  old_predicate:=format('FROM public."%s" x WHERE x."id"=((f.entity_id::jsonb)->>''id'')::uuid LIMIT 1)',signature);
  IF position(old_predicate IN definition)=0 AND position('-- cluster-catalogue-read-filter' IN definition)=0 THEN
   RAISE EXCEPTION 'Expected delta row contract not found for %',signature;
  END IF;
  definition:=replace(definition,old_predicate,replace(old_predicate,' LIMIT 1)',CASE signature
   WHEN 'products' THEN ' AND public.product_available_in_catalogue(x.id,p_branch_id) LIMIT 1)'
   WHEN 'product_barcodes' THEN ' AND public.product_available_in_catalogue(x.product_id,p_branch_id) LIMIT 1)'
   ELSE ' AND (x.foc_product_id IS NULL OR public.product_available_in_catalogue(x.foc_product_id,p_branch_id)) LIMIT 1)' END));
 END LOOP;
 IF position('-- cluster-catalogue-read-filter' IN definition)=0 THEN
  IF position('RETURN QUERY WITH feed_page' IN definition)=0 THEN RAISE EXCEPTION 'Expected delta pagination contract not found'; END IF;
  definition:=replace(definition,'RETURN QUERY WITH feed_page',E'-- cluster-catalogue-read-filter\n RETURN QUERY WITH feed_page');
  EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.prepare_sponsorship(uuid,text,text,text,text,jsonb,text)'::regprocedure) INTO definition;
 old_predicate:='IF product.owner_store_id IS NOT NULL AND product.owner_store_id<>p_store THEN';
 IF position(old_predicate IN definition)>0 THEN
  EXECUTE replace(definition,old_predicate,'IF NOT public.product_available_in_catalogue(product.id,p_store) THEN');
 ELSIF position('IF NOT public.product_available_in_catalogue(product.id,p_store) THEN' IN definition)=0 THEN
  RAISE EXCEPTION 'Expected sponsorship catalogue guard not found';
 END IF;
END $read_contracts$;

-- Every branch may receive an ID-only invalidation; the guarded pull above
-- returns product values only for its own catalogue. This makes sibling and
-- explicitly received catalogues update without full refreshes or reassigning owners.
DO $feed_contracts$
DECLARE signature text; definition text; old_scope text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.sync_feed_products()','public.sync_feed_product_barcodes()'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  old_scope:=CASE WHEN signature='public.sync_feed_products()'
    THEN 'COALESCE(NULLIF(COALESCE(NEW.owner_store_id,OLD.owner_store_id)::text,''''),''global'')'
    ELSE 'COALESCE(NULLIF(p.owner_store_id::text,''''),''global'')' END;
  IF position(old_scope IN definition)>0 THEN EXECUTE replace(definition,old_scope,'''global''::text');
  ELSIF position('''global''::text branch_id' IN definition)=0 THEN RAISE EXCEPTION 'Expected product feed scope not found in %',signature; END IF;
 END LOOP;
 SELECT pg_get_functiondef('public.sync_feed_promotions()'::regprocedure) INTO definition;
 old_scope:='COALESCE(NULLIF(p.owner_store_id::text,''''),''global'')';
 IF position(old_scope IN definition)>0 THEN EXECUTE replace(definition,old_scope,'''global''::text');
 ELSIF position('SELECT ''global''::text INTO v_branch' IN definition)=0 THEN RAISE EXCEPTION 'Expected promotion feed scope not found'; END IF;
END $feed_contracts$;
COMMIT;
