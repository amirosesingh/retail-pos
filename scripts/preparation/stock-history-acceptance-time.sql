-- Schema only. Apply after the recorded-continuation and multi-day readers.
-- Keep the existing function identity and private grants on installed databases.
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=to_regprocedure('private.stock_history_recorded_through(text)')
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
   AND p.proconfig=ARRAY['search_path=""'] AND p.proacl::text='{postgres=X/postgres}'
   AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) IN
     ('492a2b551cb5f8a940a67d0b0c8c7af0','806d7fbca81031d27c685380f1d67ca4'))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.pos_stock_history_recorded_page(text,text,text,text,text,uuid,integer,text,text)')
    AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='v'
    AND p.proconfig=ARRAY['search_path=""'] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='a25c752bf2a20974f435ef72472774d9')
 THEN RAISE EXCEPTION 'STOCK_HISTORY_ACCEPTANCE_DEPENDENCY_CHANGED'; END IF;
END $guard$;

-- Certify a complete receipt prefix from an independently verified opening.
CREATE OR REPLACE FUNCTION private.stock_history_recorded_through(p_branch text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH basis AS MATERIALIZED (
  SELECT h.store_id,h.committed_cursor,b.id,b.cutoff_ticks,b.source_cursor
  FROM public.stock_history_heads h
  JOIN public.stock_history_baselines b ON (b.id,b.store_id)=(h.baseline_id,h.store_id)
  JOIN private.stock_history_cutover_scope g ON g.store_id=b.store_id
  WHERE h.store_id=p_branch AND h.coverage_state='incomplete'
   AND ((b.opening_kind='physical_count' AND EXISTS(SELECT 1 FROM private.stock_history_cutover_publications p
     WHERE (p.baseline_id,p.store_id,p.project_origin)=(b.id,b.store_id,g.project_origin)))
    OR (b.opening_kind='system_snapshot' AND b.terminal_watermarks->>'kind'='fenced_rollout_snapshot'
     AND b.terminal_watermarks->>'projectOrigin'=g.project_origin
     AND b.terminal_watermarks->>'sourceCursor'=b.source_cursor::text
     AND EXISTS(SELECT 1 FROM private.stock_history_cutover_leases l
      WHERE l.id=b.id AND l.store_id=b.store_id AND l.cutoff_at=b.cutoff_at_raw
        AND l.armed_at IS NOT NULL AND l.released_at IS NOT NULL AND l.expired_write_at IS NULL)))
   AND b.verification_state='verified' AND h.coverage_from_ticks=b.cutoff_ticks
   AND h.committed_cursor-b.source_cursor BETWEEN 1 AND 20000
   AND private.stock_history_cutover_guard_ready(g.store_id,g.cluster_id)
   AND private.stock_history_opening_capture_ready()
   AND b.expected_pairs=(SELECT count(*) FROM public.stock_history_openings o WHERE (o.baseline_id,o.store_id)=(b.id,b.store_id))
   AND NOT EXISTS(SELECT 1 FROM public.products item WHERE public.product_available_in_catalogue(item.id,b.store_id)
     AND NOT EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE (o.baseline_id,o.store_id,o.product_id)=(b.id,b.store_id,item.id)))
 ), prefix AS MATERIALIZED (
  SELECT m.id,m.operation_id,m.product_id,m.source_kind,m.ingested_cursor,m.ingested_at,m.payload_hash,m.payload_json,
   b.id baseline_id,b.store_id,b.cutoff_ticks,
   lag(m.ingested_at) OVER(ORDER BY m.ingested_cursor) previous_at
  FROM basis b JOIN public.stock_history_movements m ON m.store_id=b.store_id
   AND m.ingested_cursor>b.source_cursor AND m.ingested_cursor<=b.committed_cursor
 ), sale_effect_transactions AS MATERIALIZED (
  SELECT p.operation_id,p.store_id,min(e.transaction_id) transaction_id
  FROM prefix p JOIN private.stock_history_effect_coverage c ON c.movement_id=p.id
  JOIN private.stock_history_accepted_effects e ON (e.id,e.store_id)=(c.effect_id,p.store_id)
  GROUP BY p.operation_id,p.store_id HAVING count(DISTINCT e.transaction_id)=1
 )
 SELECT private.stock_history_ticks(private.stock_history_cutover_utc(max(prefix.ingested_at)))
 FROM prefix
 GROUP BY prefix.baseline_id,prefix.store_id
 HAVING count(*)=(SELECT committed_cursor-source_cursor FROM basis)
  -- A sale has one immutable business step and one physical effect transaction.
  -- All its branch effects must belong to this complete post-opening prefix.
  AND count(DISTINCT prefix.operation_id)=(SELECT count(*) FROM sale_effect_transactions)
  AND NOT EXISTS(SELECT 1 FROM sale_effect_transactions sale
   WHERE (SELECT count(*) FROM fin62_history_preparation.sale_steps step
     WHERE (step.operation_id,step.branch_id)=(sale.operation_id,sale.store_id)
      AND step.action='SALE' AND step.before_fact IS NULL)<>1
    OR EXISTS(SELECT 1 FROM private.stock_history_accepted_effects effect
     WHERE (effect.transaction_id,effect.store_id)=(sale.transaction_id,sale.store_id)
      AND NOT EXISTS(SELECT 1 FROM private.stock_history_effect_coverage c JOIN prefix included ON included.id=c.movement_id
       WHERE c.effect_id=effect.id AND included.operation_id=sale.operation_id)))
  AND max(prefix.ingested_at)<=statement_timestamp()
  AND bool_and(prefix.source_kind='sale' AND prefix.ingested_at IS NOT NULL
   AND private.stock_history_ticks(private.stock_history_cutover_utc(prefix.ingested_at))>prefix.cutoff_ticks
   AND (prefix.previous_at IS NULL OR prefix.ingested_at>prefix.previous_at)
   AND EXISTS(SELECT 1 FROM public.stock_history_openings o
    WHERE (o.baseline_id,o.store_id,o.product_id)=(prefix.baseline_id,prefix.store_id,prefix.product_id))
   AND EXISTS(SELECT 1 FROM private.stock_history_effect_coverage e WHERE e.movement_id=prefix.id)
   AND EXISTS(SELECT 1 FROM private.stock_history_claim_receipts r WHERE r.movement_id=prefix.id
    AND r.store_id=prefix.store_id AND r.ingested_cursor=prefix.ingested_cursor AND r.accepted_at=prefix.ingested_at
    AND r.payload_hash=prefix.payload_hash AND r.payload_json=prefix.payload_json
    AND r.effect_ids=ARRAY(SELECT c.effect_id FROM private.stock_history_effect_coverage c
     WHERE c.movement_id=prefix.id ORDER BY c.effect_id)))
  AND (private.stock_history_capture_state(p_branch,prefix.baseline_id)->>'unvalidatedEffects')='0'
  AND (private.stock_history_capture_state(p_branch,prefix.baseline_id)->>'captureGaps')='0'
$fn$;

CREATE OR REPLACE FUNCTION public.pos_stock_history_acceptance_page_v1(p_actor text,p_terminal text,p_branch text,
 p_cutoff text,p_zone text,p_after uuid,p_limit integer,p_source_revision text,p_period_start text,p_export boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE page jsonb; recorded_revision text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_export IS NULL THEN RAISE EXCEPTION 'SYNC_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_export THEN PERFORM private.stock_history_authorize_read(p_actor,p_terminal,p_branch,true); END IF;
 IF p_source_revision IS NOT NULL THEN
  IF NOT starts_with(p_source_revision,'stock-history-acceptance.v1:') THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED'; END IF;
  recorded_revision:='stock-history-recorded.v1:'||substr(p_source_revision,length('stock-history-acceptance.v1:')+1);
 END IF;
 page:=public.pos_stock_history_recorded_page(p_actor,p_terminal,p_branch,p_cutoff,p_zone,p_after,p_limit,recorded_revision,p_period_start);
 IF page->'coverage'->>'acceptedLedger' IS DISTINCT FROM 'complete'
  OR page->'coverage'->>'timeGrade' IS DISTINCT FROM 'recorded'
  OR NOT starts_with(COALESCE(page->>'sourceRevision',''),'stock-history-recorded.v1:')
  OR page->'reasons' IS DISTINCT FROM '["WRITER_COVERAGE_UNKNOWN"]'::jsonb
 THEN
  IF p_source_revision IS NOT NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED'; END IF;
  RETURN NULL;
 END IF;
 RETURN page || jsonb_build_object('status','complete','reasons','[]'::jsonb,
  'sourceRevision','stock-history-acceptance.v1:'||substr(page->>'sourceRevision',length('stock-history-recorded.v1:')+1),
  'coverage',jsonb_build_object('acceptedLedger','complete','writers','unknown','balanceGrade','verified','timeGrade','accepted'));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_acceptance_page_v1(text,text,text,text,text,uuid,integer,text,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_acceptance_page_v1(text,text,text,text,text,uuid,integer,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.pos_stock_history_acceptance_movements_v1(p_actor text,p_terminal text,p_branch text,p_product uuid,
 p_cutoff text,p_zone text,p_source_revision text,p_period_start text,p_after_effective text,p_after_id uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE page jsonb; baseline public.stock_history_baselines%ROWTYPE; head public.stock_history_heads%ROWTYPE;
 cutoff numeric:=private.stock_history_ticks(p_cutoff); start_tick numeric;
 after_time timestamptz; rows jsonb; next_cursor jsonb;
BEGIN
 IF p_product IS NULL OR p_source_revision IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR (p_after_effective IS NULL) IS DISTINCT FROM (p_after_id IS NULL)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_MOVEMENT_CURSOR_INVALID'; END IF;
 page:=public.pos_stock_history_acceptance_page_v1(p_actor,p_terminal,p_branch,p_cutoff,p_zone,NULL,1,p_source_revision,p_period_start,false);
 IF page IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED'; END IF;
 SELECT * INTO STRICT head FROM public.stock_history_heads WHERE store_id=p_branch;
 SELECT * INTO STRICT baseline FROM public.stock_history_baselines WHERE (store_id,id)=(p_branch,head.baseline_id);
 IF NOT EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE (o.store_id,o.baseline_id,o.product_id)=(p_branch,baseline.id,p_product))
 THEN RAISE EXCEPTION 'STOCK_HISTORY_BRANCH_DENIED' USING ERRCODE='42501'; END IF;
 IF p_period_start IS NOT NULL THEN start_tick:=private.stock_history_ticks(p_period_start); END IF;
 IF p_after_effective IS NOT NULL THEN
  after_time:=p_after_effective::timestamptz;
  IF private.stock_history_cutover_utc(after_time) IS DISTINCT FROM p_after_effective
  THEN RAISE EXCEPTION 'STOCK_HISTORY_MOVEMENT_CURSOR_INVALID'; END IF;
 END IF;
 WITH accepted AS MATERIALIZED (
  SELECT m.operation_id,max(m.ingested_at) at
  FROM public.stock_history_movements m WHERE m.store_id=p_branch
   AND m.ingested_cursor>baseline.source_cursor AND m.ingested_cursor<=head.committed_cursor
  GROUP BY m.operation_id
 ), eligible AS MATERIALIZED (
  SELECT m.id,a.at,m.effective_at_raw,m.source_kind,m.quantity_delta,private.stock_history_cutover_utc(a.at) wire_at
  FROM public.stock_history_movements m JOIN accepted a ON a.operation_id=m.operation_id
  WHERE m.store_id=p_branch AND m.product_id=p_product
   AND m.ingested_cursor>baseline.source_cursor AND m.ingested_cursor<=head.committed_cursor
   AND private.stock_history_ticks(private.stock_history_cutover_utc(a.at))<=cutoff
   AND (start_tick IS NULL OR private.stock_history_ticks(private.stock_history_cutover_utc(a.at))>=start_tick)
 ), candidates AS MATERIALIZED (
  SELECT e.*,row_number() OVER(ORDER BY e.at,e.id) idx FROM eligible e
  WHERE after_time IS NULL OR (e.at,e.id)>(after_time,p_after_id) ORDER BY e.at,e.id LIMIT p_limit+1
 )
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'effectiveAt',c.wire_at,'recordedAt',c.wire_at,
  'originalAt',c.effective_at_raw,'kind',c.source_kind,'delta',c.quantity_delta::text) ORDER BY c.idx)
  FROM candidates c WHERE c.idx<=p_limit),'[]'::jsonb),
  (SELECT jsonb_build_object('id',c.id,'effectiveAt',c.wire_at) FROM candidates c WHERE c.idx=p_limit
   AND EXISTS(SELECT 1 FROM candidates extra WHERE extra.idx>p_limit))
 INTO rows,next_cursor
 WHERE after_time IS NULL OR EXISTS(SELECT 1 FROM eligible e WHERE (e.at,e.id)=(after_time,p_after_id));
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_MOVEMENT_CURSOR_INVALID'; END IF;
 -- Reject a change in stock, capture or report-head revision during the read.
 PERFORM public.pos_stock_history_acceptance_page_v1(p_actor,p_terminal,p_branch,p_cutoff,p_zone,NULL,1,p_source_revision,p_period_start,false);
 RETURN jsonb_build_object('status','complete','reasons','[]'::jsonb,'branchId',p_branch,'productId',p_product,
  'cutoff',p_cutoff,'timeZone',p_zone,'sourceRevision',p_source_revision,'baselineAt',page->'baselineAt','coverage',page->'coverage',
  'rows',rows,'next',next_cursor) || CASE WHEN p_period_start IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('periodStart',p_period_start) END;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_acceptance_movements_v1(text,text,text,uuid,text,text,text,text,text,uuid,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_acceptance_movements_v1(text,text,text,uuid,text,text,text,text,text,uuid,integer) TO service_role;
