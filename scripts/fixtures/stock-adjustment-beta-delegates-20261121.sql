CREATE OR REPLACE FUNCTION public.sync_apply_stock_adjustments(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer; v_row jsonb;
BEGIN


  INSERT INTO public."stock_adjustments" ("id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id")
  SELECT "id","product_id","product_name","sku","barcode","store_id","terminal_id","reason","note","previous_stock","updated_stock","delta","cost_impact","staff_id","staff_name","role","created_at","row_version","draft_id" FROM jsonb_populate_recordset(NULL::public."stock_adjustments", COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS v_count=ROW_COUNT;



  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.sync_apply_stock_delta_applied(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer:=0; v_row jsonb;
BEGIN FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
  PERFORM public.stock_apply_delta((v_row->>'movement_id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'delta')::integer,0)); v_count:=v_count+1;
 END LOOP; RETURN v_count; END $function$;
