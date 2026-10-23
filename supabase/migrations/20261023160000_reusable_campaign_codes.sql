-- Reusable campaign codes are promotions with no FOC product.
-- Include such global promotions in Windows bootstrap/counts/delete and the
-- incremental feed. The partner column is nullable for old application builds.
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS partner text;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS code_scope text;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS code_cluster_id text;
ALTER TABLE public.promotions ADD CONSTRAINT promotions_code_scope_valid
  CHECK (code_scope IS NULL OR code_scope IN ('bill','item'));
CREATE UNIQUE INDEX IF NOT EXISTS promotions_reusable_code_unique
  ON public.promotions (upper(btrim(title))) WHERE promo_type='code' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_apply_promotions(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.promotions
    (id,title,promo_type,min_spend,discount_percent,discount_amount,foc_product_id,
     points_per_dollar,tier_rates,partner,code_scope,code_cluster_id,is_active,start_date,end_date,created_at,
     updated_at,row_version,deleted_at)
  SELECT id,title,promo_type,min_spend,discount_percent,discount_amount,foc_product_id,
     points_per_dollar,tier_rates,partner,code_scope,code_cluster_id,is_active,start_date,end_date,created_at,
     updated_at,row_version,deleted_at
  FROM jsonb_populate_recordset(NULL::public.promotions, COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    title=EXCLUDED.title, promo_type=EXCLUDED.promo_type, min_spend=EXCLUDED.min_spend,
    discount_percent=EXCLUDED.discount_percent, discount_amount=EXCLUDED.discount_amount,
    foc_product_id=EXCLUDED.foc_product_id, points_per_dollar=EXCLUDED.points_per_dollar,
    tier_rates=EXCLUDED.tier_rates,
    partner=COALESCE(EXCLUDED.partner,public.promotions.partner),
    code_scope=COALESCE(EXCLUDED.code_scope,public.promotions.code_scope),
    code_cluster_id=CASE WHEN EXCLUDED.code_scope IS NULL THEN public.promotions.code_cluster_id ELSE EXCLUDED.code_cluster_id END,
    is_active=EXCLUDED.is_active, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
    created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
    row_version=EXCLUDED.row_version, deleted_at=EXCLUDED.deleted_at
  WHERE EXCLUDED.row_version>public.promotions.row_version;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_promotions(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_feed_promotions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trg$
DECLARE v_row public.promotions%ROWTYPE; v_branch text;
BEGIN
  IF TG_OP='DELETE' THEN v_row:=OLD; ELSE v_row:=NEW; END IF;
  SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') INTO v_branch
    FROM public.products p WHERE p.id=v_row.foc_product_id;
  INSERT INTO public.sync_change_feed
    (organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
  VALUES ('default',COALESCE(v_branch,'global'),NULL,'promotions',
    jsonb_build_object('id',v_row.id)::text,lower(TG_OP),v_row.row_version,
    TG_OP='DELETE');
  RETURN NULL;
END $trg$;
REVOKE ALL ON FUNCTION public.sync_feed_promotions() FROM PUBLIC, anon, authenticated;

-- These existing scoped functions have other authorization and pagination
-- rules. Replace only their promotion product-scope predicate, retaining all
-- unrelated policy and business logic. Abort if the expected contract changed.
DO $migration$
DECLARE
  v_fn record;
  v_def text;
  v_old constant text := 'EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'''') IS NULL OR p.owner_store_id::text=p_branch_id))';
  v_new constant text := '(x.foc_product_id IS NULL OR ' || v_old || ')';
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('pos_sync_bootstrap_scoped','pos_sync_counts_scoped','sync_delete_promotions')
  LOOP
    v_def:=pg_get_functiondef(v_fn.oid);
    IF position(v_old IN v_def)>0 THEN
      IF position(v_old IN substr(v_def,position(v_old IN v_def)+length(v_old)))>0 THEN
        RAISE EXCEPTION 'Unexpected repeated promotion scope in %',v_fn.proname;
      END IF;
      EXECUTE replace(v_def,v_old,v_new);
    ELSIF v_fn.proname <> 'sync_delete_promotions' THEN
      RAISE EXCEPTION 'Expected promotion scope not found in %',v_fn.proname;
    END IF;
  END LOOP;
END $migration$;

-- Validate new online sales at the authoritative transaction boundary. Historical
-- offline uploads use the sync path and are not re-priced against today's rules.
DO $sale_guard$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure) INTO v_def;
  IF position('IF existing_id IS NULL THEN' IN v_def)=0 THEN
    RAISE EXCEPTION 'Expected sale insertion boundary not found';
  END IF;
  EXECUTE replace(v_def, 'IF existing_id IS NULL THEN', $guard$IF existing_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.promotions p
      WHERE p.id::text=s->>'coupon_promo_id' AND p.promo_type='code'
        AND (p.is_active IS DISTINCT FROM true OR p.deleted_at IS NOT NULL
          OR upper(btrim(p.title)) IS DISTINCT FROM upper(btrim(s->>'coupon_code'))
          OR COALESCE(p.code_scope,'bill') IS DISTINCT FROM s->>'coupon_scope'
          OR (NULLIF(p.code_cluster_id,'') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.stores st WHERE st.id::text=s->>'store_id' AND st.group_id=p.code_cluster_id
          )))
    ) THEN RAISE EXCEPTION 'REUSABLE_CODE_NOT_VALID: refresh the code and check its store coverage'; END IF;
  $guard$);
END $sale_guard$;

-- Existing tills must receive previously omitted non-FOC promotions as well.
INSERT INTO public.sync_change_feed
  (organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
SELECT 'default','global',NULL,'promotions',jsonb_build_object('id',id)::text,
  'update',row_version,false FROM public.promotions WHERE foc_product_id IS NULL;
