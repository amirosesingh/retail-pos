-- Stock history recorded by central admission. Schema only. Applying this
-- preparation changes no opening, business row, claim or existing replica.
BEGIN;

ALTER TABLE private.stock_history_replica_snapshots DROP CONSTRAINT stock_history_replica_snapshots_coverage_state_check;
ALTER TABLE private.stock_history_replica_snapshots ADD CONSTRAINT stock_history_replica_snapshots_coverage_state_check
 CHECK(coverage_state IN('complete','recorded'));

-- A first physical opening supports this distinct provisional timeline only
-- while the installed Beta cohort and capture still match and the complete
-- immutable post-opening prefix reconciles to accepted effects. Source clock
-- values stay as submitted. No effective-time certificate is created.
CREATE FUNCTION private.stock_history_recorded_through(p_branch text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH basis AS MATERIALIZED (
  SELECT h.store_id,h.committed_cursor,b.id,b.cutoff_ticks,b.source_cursor
  FROM public.stock_history_heads h
  JOIN public.stock_history_baselines b ON (b.id,b.store_id)=(h.baseline_id,h.store_id)
  JOIN private.stock_history_cutover_publications p ON (p.baseline_id,p.store_id)=(b.id,b.store_id)
  JOIN private.stock_history_cutover_scope g ON (g.store_id,g.project_origin)=(p.store_id,p.project_origin)
  WHERE h.store_id=p_branch AND h.coverage_state='incomplete' AND b.opening_kind='physical_count'
   AND b.verification_state='verified' AND h.coverage_from_ticks=b.cutoff_ticks
   AND h.committed_cursor-b.source_cursor BETWEEN 1 AND 20000
   AND private.stock_history_cutover_guard_ready(g.store_id,g.cluster_id)
   AND private.stock_history_opening_capture_ready()
   AND b.expected_pairs=(SELECT count(*) FROM public.stock_history_openings o WHERE (o.baseline_id,o.store_id)=(b.id,b.store_id))
   AND NOT EXISTS(SELECT 1 FROM public.products item WHERE public.product_available_in_catalogue(item.id,b.store_id)
     AND NOT EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE (o.baseline_id,o.store_id,o.product_id)=(b.id,b.store_id,item.id)))
 ), prefix AS MATERIALIZED (
  SELECT m.id,m.operation_id,m.product_id,m.source_kind,m.ingested_cursor,m.ingested_at,b.id baseline_id,b.store_id,b.cutoff_ticks,
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
    AND r.store_id=prefix.store_id AND r.ingested_cursor=prefix.ingested_cursor AND r.accepted_at=prefix.ingested_at))
  AND (private.stock_history_capture_state(p_branch,prefix.baseline_id)->>'unvalidatedEffects')='0'
  AND (private.stock_history_capture_state(p_branch,prefix.baseline_id)->>'captureGaps')='0'
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_recorded_through(text) FROM PUBLIC,anon,authenticated,service_role;

-- Keep the independently verified opening readable at its own instant only.
-- Every original late-claim, catalogue, capture and shift/export check remains.
DO $opening_point$
DECLARE signature regprocedure:='private.stock_history_read_page_core(text,text,text,text,text,uuid,integer,text,boolean,uuid,text,uuid,text,uuid)'::regprocedure;
 original text;replacement text;body text;definition text;
BEGIN
 original:='IF h.coverage_state<>''complete'' OR h.coverage_from_ticks IS NULL OR h.coverage_through_ticks IS NULL';
 replacement:='IF (h.coverage_state<>''complete'' AND NOT (cutoff=b.cutoff_ticks AND private.stock_history_recorded_through(p_branch) IS NOT NULL)) OR h.coverage_from_ticks IS NULL OR h.coverage_through_ticks IS NULL';
 SELECT prosrc,pg_get_functiondef(oid) INTO STRICT body,definition FROM pg_proc WHERE oid=signature;
 IF length(body)-length(replace(body,original,''))<>length(original) THEN RAISE EXCEPTION 'STOCK_HISTORY_RECORDED_READER_DEPENDENCY_CHANGED';END IF;
 EXECUTE replace(definition,body,replace(body,original,replacement));
END $opening_point$;

CREATE OR REPLACE FUNCTION private.stock_history_replica_source(p_branch text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT encode(sha256(convert_to((jsonb_build_array(h.store_id,h.baseline_id,h.committed_cursor::text,
  h.coverage_generation::text,h.coverage_from_ticks::text,
  COALESCE(recorded.through,h.coverage_through_ticks)::text,b.evidence_hash,e.capture->>'revision')
  ||CASE WHEN recorded.through IS NULL THEN '[]'::jsonb ELSE '["recorded"]'::jsonb END)::text,'UTF8')),'hex')
 FROM public.stock_history_heads h JOIN public.stock_history_baselines b ON b.id=h.baseline_id AND b.store_id=h.store_id
 CROSS JOIN LATERAL (SELECT private.stock_history_capture_state(p_branch,b.id) capture) e
 CROSS JOIN LATERAL (SELECT CASE WHEN h.coverage_state='incomplete' THEN private.stock_history_recorded_through(p_branch) END through) recorded
 WHERE h.store_id=p_branch AND (h.coverage_state='complete' OR recorded.through IS NOT NULL) AND b.verification_state='verified'
  AND h.coverage_from_ticks=b.cutoff_ticks AND h.coverage_through_ticks>=b.cutoff_ticks
  AND h.committed_cursor>=b.source_cursor AND e.capture->>'unvalidatedEffects'='0' AND e.capture->>'captureGaps'='0'
$fn$;
REVOKE ALL ON FUNCTION private.stock_history_replica_source(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.stock_history_build_replica_snapshot(p_branch text,p_key text,p_generation bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE h public.stock_history_heads%ROWTYPE; b public.stock_history_baselines%ROWTYPE;
 snapshot uuid:=gen_random_uuid(); group_kind text; packed text:='['; page_count integer:=0; page_id integer:=0;
 total_bytes integer:=0; seen_openings bigint:=0; next_cursor bigint; recorded_through numeric; item record; pages jsonb:='[]'; row_bytes integer;
BEGIN
 SELECT * INTO STRICT h FROM public.stock_history_heads WHERE store_id=p_branch FOR SHARE;
 SELECT * INTO STRICT b FROM public.stock_history_baselines WHERE id=h.baseline_id AND store_id=p_branch;
 IF p_key IS DISTINCT FROM private.stock_history_replica_source(p_branch)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_CHANGED'; END IF;
 IF b.expected_pairs>20000 OR h.committed_cursor-b.source_cursor>20000 OR octet_length(b.terminal_watermarks::text)>262144
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;

 recorded_through:=private.stock_history_recorded_through(p_branch);
 next_cursor:=b.source_cursor;
 FOR item IN
  (SELECT 'openings'::text kind, o.product_id product, 0::bigint cursor,
    jsonb_build_array(o.id,o.product_id,o.quantity::text,o.product_name,o.sku,o.barcode,o.owner_store_id)::text payload
   FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch
   UNION ALL
   SELECT 'movements', NULL::uuid, m.ingested_cursor,
    jsonb_build_array(m.ingested_cursor::text,to_char(m.ingested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
     m.payload_hash,m.payload_json)::text
   FROM public.stock_history_movements m
   WHERE m.store_id=p_branch AND m.ingested_cursor>b.source_cursor AND m.ingested_cursor<=h.committed_cursor
     AND (recorded_through IS NOT NULL OR (m.effective_ticks>b.cutoff_ticks AND m.effective_ticks<=h.coverage_through_ticks AND m.clock_state='verified'))
     AND m.payload_hash=encode(sha256(convert_to(m.payload_json,'UTF8')),'hex')
     AND jsonb_array_length(m.payload_json::jsonb)=18
     AND (m.payload_json::jsonb)->0='1'::jsonb
     AND ((m.payload_json::jsonb)->>1,(m.payload_json::jsonb)->>2,(m.payload_json::jsonb)->>3,
      (m.payload_json::jsonb)->>4,(m.payload_json::jsonb)->>5,(m.payload_json::jsonb)->>6,
      (m.payload_json::jsonb)->>7,(m.payload_json::jsonb)->>8,(m.payload_json::jsonb)->>9,
      (m.payload_json::jsonb)->>10,(m.payload_json::jsonb)->>11,(m.payload_json::jsonb)->>12,
      (m.payload_json::jsonb)->>13,(m.payload_json::jsonb)->>14,(m.payload_json::jsonb)->>15)
     IS NOT DISTINCT FROM (m.id::text,m.operation_id::text,m.product_id::text,m.store_id,m.terminal_id,m.actor_id,
      m.source_kind,m.quantity_delta::text,m.effective_at_raw,m.effective_ticks::text,m.recorded_at_raw,
      m.product_name,m.sku,m.barcode,m.clock_state)
     AND EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch AND o.product_id=m.product_id))
  ORDER BY kind DESC,product,cursor
 LOOP
  IF item.kind='openings' THEN seen_openings:=seen_openings+1;
  ELSE
   next_cursor:=next_cursor+1;
   IF item.cursor<>next_cursor THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_PREFIX_INVALID'; END IF;
  END IF;
  row_bytes:=octet_length(item.payload);
  IF row_bytes>245758 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
  IF page_count>0 AND (item.kind<>group_kind OR page_count=100 OR octet_length(packed)+row_bytes+2>245760) THEN
   pages:=pages||jsonb_build_array(private.stock_history_save_replica_page(snapshot,page_id,group_kind,page_count,packed||']'));
   total_bytes:=total_bytes+octet_length(packed)+1;
   IF total_bytes>33554432 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
   page_id:=page_id+1;page_count:=0;packed:='[';
  END IF;
  group_kind:=item.kind;
  packed:=packed||CASE WHEN page_count=0 THEN '' ELSE ',' END||item.payload;
  page_count:=page_count+1;
 END LOOP;
 IF page_count>0 THEN
  pages:=pages||jsonb_build_array(private.stock_history_save_replica_page(snapshot,page_id,group_kind,page_count,packed||']'));
  total_bytes:=total_bytes+octet_length(packed)+1;
 END IF;
 IF total_bytes>33554432 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_TOO_LARGE'; END IF;
 IF seen_openings<>b.expected_pairs OR next_cursor<>h.committed_cursor
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_PREFIX_INVALID'; END IF;
 IF p_key IS DISTINCT FROM private.stock_history_replica_source(p_branch)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_REPLICA_CHANGED'; END IF;
 INSERT INTO private.stock_history_replica_snapshots VALUES(snapshot,p_branch,p_generation,p_key,b.id,h.committed_cursor,
  CASE WHEN recorded_through IS NULL THEN h.coverage_state ELSE 'recorded' END,
  h.coverage_from_ticks,COALESCE(recorded_through,h.coverage_through_ticks),jsonb_build_array(b.id,b.cutoff_at_raw,b.captured_at_raw,
   b.source_cursor::text,b.opening_kind,b.expected_pairs,b.verified_by,b.evidence_hash,b.terminal_watermarks::text),pages);
 RETURN snapshot;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_build_replica_snapshot(text,text,bigint)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_recorded_page(p_actor text,p_terminal text,p_branch text,p_cutoff text,p_zone text,
 p_after uuid,p_limit integer,p_source_revision text,p_period_start text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE h public.stock_history_heads%ROWTYPE;b public.stock_history_baselines%ROWTYPE;
 cutoff numeric:=private.stock_history_ticks(p_cutoff);through_ticks numeric;period_start numeric;period_range jsonb;period_meta jsonb;
 revision text;source_key text;read_raw text;last_recorded text;candidate record;wire jsonb;page_rows jsonb[]:=ARRAY[]::jsonb[];
 last_id uuid;next_id uuid;page_bytes integer:=2;opening numeric;incoming numeric;outgoing numeric;balance numeric;
BEGIN
 PERFORM private.stock_history_authorize_read(p_actor,p_terminal,p_branch,false);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR p_zone IS NULL OR length(p_zone) NOT BETWEEN 1 AND 100
   OR length(COALESCE(p_source_revision,''))>512 THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_REQUEST';END IF;
 SELECT * INTO h FROM public.stock_history_heads WHERE store_id=p_branch FOR SHARE;
 SELECT * INTO b FROM public.stock_history_baselines WHERE id=h.baseline_id AND store_id=p_branch;
 through_ticks:=private.stock_history_recorded_through(p_branch);
 IF p_period_start IS NOT NULL THEN
  period_start:=private.stock_history_ticks(p_period_start);
  period_range:=private.stock_history_calendar_day(to_char(to_timestamp(floor(period_start/10000000)) AT TIME ZONE p_zone,'YYYY-MM-DD'),p_zone);
  IF private.stock_history_ticks(period_range->>'start')<>period_start OR cutoff<period_start
   OR cutoff>=private.stock_history_ticks(period_range->>'endExclusive') THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
  period_meta:=jsonb_build_object('start',period_range->>'start','endExclusive',period_range->>'endExclusive','through',p_cutoff,
   'fullDay',cutoff=private.stock_history_ticks(period_range->>'endExclusive')-1);
 END IF;
 read_raw:=private.stock_history_cutover_utc(clock_timestamp());
 IF through_ticks IS NULL OR through_ticks>private.stock_history_ticks(read_raw)
  OR cutoff<b.cutoff_ticks OR (period_start IS NOT NULL AND period_start<=b.cutoff_ticks) THEN
  IF p_source_revision IS NOT NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
  RETURN NULL;
 END IF;
 IF cutoff>through_ticks THEN
  IF p_source_revision IS NOT NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
  SELECT private.stock_history_cutover_utc(ingested_at) INTO STRICT last_recorded FROM public.stock_history_movements
   WHERE store_id=p_branch AND ingested_cursor=h.committed_cursor;
  RETURN jsonb_build_object('status','incomplete','reasons','["INCOMPLETE_MOVEMENTS"]'::jsonb,'cutoff',p_cutoff,'timeZone',p_zone,
   'branchId',p_branch,'baselineAt',b.cutoff_at_raw,'readAt',read_raw,'coverageThroughTicks',through_ticks::text,
   'recordedThrough',last_recorded,
   'rows','[]'::jsonb,'next',NULL)||CASE WHEN period_meta IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('period',period_meta) END;
 END IF;
 source_key:=private.stock_history_replica_source(p_branch);
 IF source_key IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
 revision:='stock-history-recorded.v1:'||source_key||':'||COALESCE(p_period_start,'point')||':'||cutoff::text||':'||p_zone;
 IF p_source_revision IS NOT NULL AND p_source_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
 FOR candidate IN SELECT o.* FROM public.stock_history_openings o WHERE o.store_id=p_branch AND o.baseline_id=b.id
  AND (p_after IS NULL OR o.product_id>p_after) ORDER BY o.product_id LIMIT p_limit+1 LOOP
  IF cardinality(page_rows)>=p_limit THEN next_id:=last_id;EXIT;END IF;
  SELECT candidate.quantity+COALESCE(sum(m.quantity_delta),0),
   candidate.quantity+COALESCE(sum(m.quantity_delta) FILTER(WHERE m.recorded_tick<period_start),0),
   COALESCE(sum(m.quantity_delta) FILTER(WHERE m.recorded_tick>=period_start AND m.quantity_delta>0),0),
   COALESCE(-sum(m.quantity_delta) FILTER(WHERE m.recorded_tick>=period_start AND m.quantity_delta<0),0)
  INTO balance,opening,incoming,outgoing
  FROM (SELECT m.quantity_delta,private.stock_history_ticks(private.stock_history_cutover_utc((
    SELECT max(leg.ingested_at) FROM public.stock_history_movements leg
    WHERE (leg.operation_id,leg.store_id)=(m.operation_id,m.store_id)
     AND leg.ingested_cursor>b.source_cursor AND leg.ingested_cursor<=h.committed_cursor))) recorded_tick
   FROM public.stock_history_movements m WHERE m.store_id=p_branch AND m.product_id=candidate.product_id
    AND m.ingested_cursor>b.source_cursor AND m.ingested_cursor<=h.committed_cursor) m WHERE m.recorded_tick<=cutoff;
  wire:=jsonb_build_object('productId',candidate.product_id,'locationId',p_branch,'name',candidate.product_name,
   'sku',candidate.sku,'barcode',candidate.barcode,'quantity',balance::text,'negative',balance<0);
  IF period_meta IS NOT NULL THEN
   wire:=wire||jsonb_build_object('openingQuantity',opening::text,'inQuantity',incoming::text,'outQuantity',outgoing::text);
  END IF;
  IF length(trunc(abs(balance))::text)>38 OR (period_meta IS NOT NULL AND
   (length(trunc(abs(opening))::text)>38 OR length(trunc(incoming)::text)>38 OR length(trunc(outgoing)::text)>38))
   THEN RAISE EXCEPTION 'STOCK_HISTORY_ROW_OVERSIZED';END IF;
  IF page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1>245760 THEN
   IF cardinality(page_rows)=0 THEN RAISE EXCEPTION 'STOCK_HISTORY_ROW_OVERSIZED';END IF;
   next_id:=last_id;EXIT;
  END IF;
  page_bytes:=page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1;
  page_rows:=array_append(page_rows,wire);last_id:=candidate.product_id;
 END LOOP;
 IF source_key IS DISTINCT FROM private.stock_history_replica_source(p_branch) THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
 RETURN jsonb_build_object('status','incomplete','reasons','["WRITER_COVERAGE_UNKNOWN"]'::jsonb,'cutoff',p_cutoff,'timeZone',p_zone,
  'branchId',p_branch,'baselineAt',b.cutoff_at_raw,'readAt',read_raw,'coverageThroughTicks',through_ticks::text,'sourceRevision',revision,
  'restatable',true,'rows',to_jsonb(page_rows),'next',next_id,
  'coverage',jsonb_build_object('acceptedLedger','complete','writers','unknown','balanceGrade','recorded_provisional','timeGrade','recorded'))
  ||CASE WHEN period_meta IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('period',period_meta) END;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_stock_history_recorded_page(text,text,text,text,text,uuid,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_recorded_page(text,text,text,text,text,uuid,integer,text,text) TO service_role;

COMMIT;
