-- Web and Android reserve document numbers in the configured database, never in device counters.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.stock_document_counters (
 prefix text PRIMARY KEY CHECK (length(prefix) BETWEEN 1 AND 200),
 store_id text NOT NULL,
 next_value bigint NOT NULL CHECK (next_value BETWEEN 1 AND 9007199254740991),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.stock_document_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.stock_document_counters FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.reserve_stock_document_number(p_prefix text,p_minimum bigint,p_store_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_store text; v_owner text; v_saved bigint; v_last bigint; v_next bigint;
BEGIN
 IF coalesce((SELECT auth.role()),'') <> 'service_role' THEN RAISE EXCEPTION 'STOCK_NUMBER_SERVICE_REQUIRED'; END IF;
 IF p_prefix IS NULL OR p_prefix !~ '^[A-Z0-9-]{1,200}$' OR p_minimum IS NULL OR
    p_minimum < 1 OR p_minimum >= 9007199254740991
 THEN RAISE EXCEPTION 'STOCK_NUMBER_REQUEST_INVALID'; END IF;
 SELECT id INTO v_store FROM public.stores WHERE id=p_store_id OR
   (p_store_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND lower(id)=lower(p_store_id))
 ORDER BY (id=p_store_id) DESC LIMIT 1;
 IF v_store IS NULL THEN RAISE EXCEPTION 'STOCK_NUMBER_REQUEST_INVALID'; END IF;
 INSERT INTO private.stock_document_counters(prefix,store_id,next_value)
 VALUES(p_prefix,v_store,p_minimum) ON CONFLICT(prefix) DO NOTHING;
 SELECT store_id,next_value INTO v_owner,v_saved FROM private.stock_document_counters WHERE prefix=p_prefix FOR UPDATE;
 IF v_owner IS DISTINCT FROM v_store THEN RAISE EXCEPTION 'STOCK_NUMBER_BRANCH_FORBIDDEN'; END IF;
 SELECT max(CASE WHEN substring(reference FROM length(p_prefix)+2) ~ '^[0-9]{1,16}$'
   THEN substring(reference FROM length(p_prefix)+2)::bigint ELSE 0 END) INTO v_last
 FROM (SELECT reference FROM public.stock_count_drafts UNION ALL SELECT reference FROM public.purchase_orders
       UNION ALL SELECT ref AS reference FROM public.stock_transfers) documents
 WHERE reference LIKE p_prefix||'-%';
 v_next:=greatest(p_minimum,v_saved,coalesce(v_last,0)+1);
 IF v_next>=9007199254740991 THEN RAISE EXCEPTION 'STOCK_NUMBER_LIMIT'; END IF;
 UPDATE private.stock_document_counters SET next_value=v_next+1,updated_at=now() WHERE prefix=p_prefix;
 RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_stock_document_number(text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stock_document_number(text,bigint,text) TO service_role;
