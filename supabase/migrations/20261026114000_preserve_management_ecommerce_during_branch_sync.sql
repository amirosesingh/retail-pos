-- Management edits use the online write path. Branch SQL replication must never
-- replace management-owned commerce values, including from an older till.
BEGIN;
ALTER TABLE public.products ALTER COLUMN ecom_visible SET DEFAULT false;
DO $patch$
DECLARE definition text; prefix text; selection text; tail text;
BEGIN
  definition:=pg_get_functiondef('public.sync_apply_products(jsonb)'::regprocedure);
  IF position('"ecom_price"=EXCLUDED."ecom_price",' in definition)>0 THEN
    prefix:=split_part(definition,'  SELECT ',1);
    selection:=split_part(split_part(definition,'  SELECT ',2),'  ON CONFLICT',1);
    tail:='  ON CONFLICT'||split_part(definition,'  ON CONFLICT',2);
    IF prefix=definition OR selection='' OR tail='  ON CONFLICT' THEN RAISE EXCEPTION 'Unexpected product sync function shape'; END IF;
    selection:=replace(selection,'"ecom_price"','NULL::numeric');
    selection:=replace(selection,'"ecom_visible"','false');
    tail:=replace(tail,'"ecom_price"=EXCLUDED."ecom_price",','');
    tail:=replace(tail,'"ecom_visible"=EXCLUDED."ecom_visible",','');
    EXECUTE prefix||'  SELECT '||selection||tail;
  END IF;
END;
$patch$;
-- Keep management's branch-specific commerce override when a till edits retail price.
CREATE OR REPLACE FUNCTION public.preserve_product_commerce_override()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF TG_TABLE_NAME='settings_scoped' THEN
   IF NEW.key LIKE 'product_price:%' AND jsonb_typeof(NEW.value)='object' AND NOT (NEW.value ? 'ecom_price') AND OLD.value ? 'ecom_price' THEN
     NEW.value:=NEW.value||jsonb_build_object('ecom_price',OLD.value->'ecom_price');
   ELSIF NEW.key='pos_field:integration_settings' AND jsonb_typeof(NEW.value)='object' AND NOT (NEW.value ? 'ecommerceEnabled') AND OLD.value ? 'ecommerceEnabled' THEN
     NEW.value:=NEW.value||jsonb_build_object('ecommerceEnabled',OLD.value->'ecommerceEnabled');
   END IF;
 ELSIF TG_TABLE_NAME='pos_settings' AND jsonb_typeof(NEW.integration_settings)='object' AND NOT (NEW.integration_settings ? 'ecommerceEnabled') AND OLD.integration_settings ? 'ecommerceEnabled' THEN
   NEW.integration_settings:=NEW.integration_settings||jsonb_build_object('ecommerceEnabled',OLD.integration_settings->'ecommerceEnabled');
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.preserve_product_commerce_override() FROM PUBLIC,anon,authenticated;
DO $scoped$
DECLARE definition text;
BEGIN
 IF to_regclass('public.settings_scoped') IS NOT NULL THEN
   DROP TRIGGER IF EXISTS preserve_product_commerce_override ON public.settings_scoped;
   CREATE TRIGGER preserve_product_commerce_override BEFORE UPDATE OF value ON public.settings_scoped FOR EACH ROW EXECUTE FUNCTION public.preserve_product_commerce_override();
 END IF;
 IF to_regclass('public.pos_settings') IS NOT NULL THEN
   DROP TRIGGER IF EXISTS preserve_product_commerce_override ON public.pos_settings;
   CREATE TRIGGER preserve_product_commerce_override BEFORE UPDATE OF integration_settings ON public.pos_settings FOR EACH ROW EXECUTE FUNCTION public.preserve_product_commerce_override();
 END IF;
 IF to_regprocedure('public.sync_apply_settings_scoped(jsonb)') IS NOT NULL THEN
   definition:=pg_get_functiondef('public.sync_apply_settings_scoped(jsonb)'::regprocedure);
   definition:=replace(definition,'SELECT "scope","scope_id","key","value",','SELECT "scope","scope_id","key",CASE WHEN "key" LIKE ''product_price:%'' THEN "value"-''ecom_price'' WHEN "key"=''pos_field:integration_settings'' THEN "value"-''ecommerceEnabled'' ELSE "value" END,');
   definition:=replace(definition,'"value"=EXCLUDED."value",',$guard$
   "value"=CASE
     WHEN EXCLUDED."key" LIKE 'product_price:%' THEN
       (EXCLUDED."value"-'ecom_price')||CASE WHEN public.settings_scoped.value ? 'ecom_price' THEN jsonb_build_object('ecom_price',public.settings_scoped.value->'ecom_price') ELSE '{}'::jsonb END
     WHEN EXCLUDED."key"='pos_field:integration_settings' THEN
       (EXCLUDED."value"-'ecommerceEnabled')||CASE WHEN public.settings_scoped.value ? 'ecommerceEnabled' THEN jsonb_build_object('ecommerceEnabled',public.settings_scoped.value->'ecommerceEnabled') ELSE '{}'::jsonb END
     ELSE EXCLUDED."value"
   END,
   $guard$);
   EXECUTE definition;
 END IF;
 IF to_regprocedure('public.sync_apply_pos_settings(jsonb)') IS NOT NULL THEN
   definition:=pg_get_functiondef('public.sync_apply_pos_settings(jsonb)'::regprocedure);
   definition:=regexp_replace(definition,'"?integration_settings"?\s*=\s*EXCLUDED\."?integration_settings"?,',$guard$
   "integration_settings"=(EXCLUDED."integration_settings"-'ecommerceEnabled')||CASE WHEN public.pos_settings.integration_settings ? 'ecommerceEnabled' THEN jsonb_build_object('ecommerceEnabled',public.pos_settings.integration_settings->'ecommerceEnabled') ELSE '{}'::jsonb END,
   $guard$,'g');
   EXECUTE definition;
 END IF;
END;
$scoped$;
DO $ready$ BEGIN
 IF to_regclass('public.public_flags') IS NOT NULL THEN
   INSERT INTO public.public_flags(key,enabled) VALUES('management_commerce_isolation_ready',true)
   ON CONFLICT(key) DO UPDATE SET enabled=true,updated_at=now();
 END IF;
END $ready$;
COMMIT;
