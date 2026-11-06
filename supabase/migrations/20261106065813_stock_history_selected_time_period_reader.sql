-- STOCK401 preparation only. Same-snapshot selected-time inventory explanation.
-- No business writes, historical backfill, public grants or live activation.
BEGIN;
DO $preflight$ DECLARE current pg_proc%ROWTYPE;BEGIN
 IF to_regprocedure('private.stock_history_calendar_day(text,text)') IS NOT NULL OR to_regprocedure('private.stock_history_read_page_core(text,text,text,text,text,uuid,integer,text,boolean,uuid,text)') IS NOT NULL
  OR to_regprocedure('public.pos_stock_history_period_page(text,text,text,text,text,uuid,integer,text,boolean,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_ALREADY_PRESENT';END IF;
 SELECT * INTO current FROM pg_proc WHERE oid='public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)'::regprocedure;
 IF md5(replace(current.prosrc,E'\r\n',E'\n'))<>'76e033ba4ec3bbdac859792cc4b4d087' OR NOT current.prosecdef OR current.prokind<>'f' OR current.provolatile<>'v'
  OR current.prorettype<>'jsonb'::regtype OR current.proisstrict OR current.proleakproof OR current.proparallel<>'u'
  OR current.proargnames IS DISTINCT FROM ARRAY['p_actor','p_terminal','p_branch','p_cutoff','p_zone','p_after','p_limit','p_source_revision','p_export','p_closed_shift']::text[]
  OR current.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR NOT has_function_privilege('service_role',current.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(current.proacl,acldefault('f',current.proowner))) p
   WHERE p.grantee NOT IN(current.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role')) OR p.privilege_type<>'EXECUTE')
  THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_UNKNOWN_READER';END IF;
 IF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid='private.stock_history_authorize_read(text,text,text,boolean)'::regprocedure)<>'6bd51631803540e143b63041e25b3671'
  OR (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid='private.stock_history_ticks(text)'::regprocedure)<>'452bd8aabda37ee3a02504807a7b77aa'
  OR EXISTS(SELECT 1 FROM pg_proc helper CROSS JOIN LATERAL aclexplode(COALESCE(helper.proacl,acldefault('f',helper.proowner))) permission
   WHERE helper.oid IN('private.stock_history_authorize_read(text,text,text,boolean)'::regprocedure,'private.stock_history_ticks(text)'::regprocedure)
    AND(permission.grantee<>helper.proowner OR permission.privilege_type<>'EXECUTE'))
  OR EXISTS(SELECT 1 FROM pg_proc helper WHERE helper.oid IN('private.stock_history_authorize_read(text,text,text,boolean)'::regprocedure,'private.stock_history_ticks(text)'::regprocedure)
   AND(helper.proowner<>current.proowner OR helper.prosecdef OR helper.prokind<>'f' OR helper.proleakproof OR helper.proparallel<>'u'
    OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR CASE WHEN helper.proname='stock_history_ticks' THEN helper.provolatile<>'i' OR NOT helper.proisstrict OR helper.prorettype<>'numeric'::regtype
     ELSE helper.provolatile<>'v' OR helper.proisstrict OR helper.prorettype<>'void'::regtype END))
  THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_UNKNOWN_HELPER';END IF;
END $preflight$;
CREATE FUNCTION private.stock_history_calendar_day(p_date text,p_zone text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $calendar$
DECLARE day date;naive numeric;next_day numeric;low numeric;high numeric;segment_start numeric;previous numeric;sample numeric;
 prior_offset numeric;sample_offset numeric;left_second numeric;right_second numeric;middle numeric;middle_offset numeric;
 a numeric;b numeric;range_start numeric;range_end numeric;pieces integer:=0;start_instant timestamptz;end_instant timestamptz;
BEGIN
 IF p_date IS NULL OR p_date!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_zone IS NULL OR length(p_zone) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
 BEGIN day:=p_date::date;PERFORM clock_timestamp() AT TIME ZONE p_zone;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END;
 IF extract(year FROM day) NOT BETWEEN 1 AND 9999 OR to_char(day,'YYYY-MM-DD')<>p_date THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
 naive:=extract(epoch FROM (day::timestamp AT TIME ZONE 'UTC'));next_day:=naive+86400;low:=naive-172800;high:=next_day+172800;
 segment_start:=low;previous:=low;
 prior_offset:=extract(epoch FROM ((to_timestamp(low) AT TIME ZONE p_zone)-(to_timestamp(low) AT TIME ZONE 'UTC')));
 sample:=low+3600;
 -- Bounded named-zone conversions only; never enumerate pg_timezone_names.
 WHILE sample<=high LOOP
  sample_offset:=extract(epoch FROM ((to_timestamp(sample) AT TIME ZONE p_zone)-(to_timestamp(sample) AT TIME ZONE 'UTC')));
  IF sample_offset<>prior_offset THEN
   left_second:=previous;right_second:=sample;
   WHILE right_second-left_second>1 LOOP
    middle:=floor((left_second+right_second)/2);
    middle_offset:=extract(epoch FROM ((to_timestamp(middle) AT TIME ZONE p_zone)-(to_timestamp(middle) AT TIME ZONE 'UTC')));
    IF middle_offset=prior_offset THEN left_second:=middle;ELSE right_second:=middle;END IF;
   END LOOP;
   a:=greatest(segment_start,naive-prior_offset);b:=least(right_second,next_day-prior_offset);
   IF a<b THEN
    IF pieces=0 THEN range_start:=a;range_end:=b;pieces:=1;
    ELSIF range_end=a THEN range_end:=b;ELSE RAISE EXCEPTION 'STOCK_DAY_NONCONTIGUOUS';END IF;
   END IF;
   segment_start:=right_second;prior_offset:=sample_offset;
  END IF;
  previous:=sample;sample:=sample+3600;
 END LOOP;
 a:=greatest(segment_start,naive-prior_offset);b:=least(high,next_day-prior_offset);
 IF a<b THEN
  IF pieces=0 THEN range_start:=a;range_end:=b;pieces:=1;
  ELSIF range_end=a THEN range_end:=b;ELSE RAISE EXCEPTION 'STOCK_DAY_NONCONTIGUOUS';END IF;
 END IF;
 IF pieces=0 THEN RAISE EXCEPTION 'STOCK_DAY_SKIPPED';END IF;
 start_instant:=to_timestamp(range_start);end_instant:=to_timestamp(range_end);
 IF extract(year FROM start_instant AT TIME ZONE 'UTC') NOT BETWEEN 1 AND 9999 OR extract(year FROM end_instant AT TIME ZONE 'UTC') NOT BETWEEN 1 AND 9999
  THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
 RETURN jsonb_build_object('start',to_char(start_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z',
  'endExclusive',to_char(end_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z');
END $calendar$;
REVOKE ALL ON FUNCTION private.stock_history_calendar_day(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.stock_history_read_page_core(p_actor text,p_terminal text,p_branch text,p_cutoff text,p_zone text,
 p_after uuid,p_limit integer,p_source_revision text,p_export boolean,p_closed_shift uuid,p_period_start text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE period_start numeric;period_meta jsonb;period_range jsonb;opening numeric;incoming numeric;outgoing numeric;h public.stock_history_heads%ROWTYPE;b public.stock_history_baselines%ROWTYPE;
 cutoff numeric;read_raw text;revision text;reasons jsonb:='[]'::jsonb;actual_pairs bigint;page jsonb;next_id uuid;
 candidate record;wire jsonb;page_rows jsonb[]:=ARRAY[]::jsonb[];page_bytes integer:=2;last_id uuid;balance numeric;
 capture_state jsonb;capture_after jsonb;
BEGIN
 PERFORM private.stock_history_authorize_read(p_actor,p_terminal,p_branch,COALESCE(p_export,false));
 IF p_limit NOT BETWEEN 1 AND 500 OR p_limit IS NULL OR p_zone IS NULL OR length(p_zone) NOT BETWEEN 1 AND 100
  OR length(COALESCE(p_source_revision,''))>512 THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_REQUEST'; END IF;
 IF p_closed_shift IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.app_users person WHERE person.user_id=p_actor AND person.is_active IS TRUE AND
   (COALESCE(person.role::text='admin' OR person.role_slug='admin',false) OR
    (person.permissions->'can_shift_closing_history_view'='true'::jsonb AND person.permissions->'page:shifts' IS DISTINCT FROM 'false'::jsonb)))
   THEN RAISE EXCEPTION 'STOCK_HISTORY_SHIFT_PERMISSION_DENIED' USING ERRCODE='42501';END IF;
  SELECT to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z' INTO p_cutoff FROM public.shifts
   WHERE id=p_closed_shift AND store_id=p_branch AND closed_at IS NOT NULL AND lower(status) IN('closed','completed') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_SHIFT_UNAVAILABLE'; END IF;
 END IF;
 cutoff:=private.stock_history_ticks(p_cutoff);
 IF p_period_start IS NOT NULL THEN
  period_start:=private.stock_history_ticks(p_period_start);
  period_range:=private.stock_history_calendar_day(to_char(to_timestamp(floor(period_start/10000000)) AT TIME ZONE p_zone,'YYYY-MM-DD'),p_zone);
  IF private.stock_history_ticks(period_range->>'start')<>period_start OR cutoff<period_start
   OR cutoff>=private.stock_history_ticks(period_range->>'endExclusive') THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
  period_meta:=jsonb_build_object('start',period_range->>'start','endExclusive',period_range->>'endExclusive','through',p_cutoff,
   'fullDay',cutoff=private.stock_history_ticks(period_range->>'endExclusive')-1);
 END IF;
 read_raw:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
 IF cutoff>private.stock_history_ticks(read_raw) THEN reasons:=reasons||'"FUTURE_CUTOFF"'::jsonb; END IF;
 SELECT * INTO h FROM public.stock_history_heads WHERE store_id=p_branch FOR SHARE;
 IF NOT FOUND OR h.baseline_id IS NULL THEN
  RETURN jsonb_build_object('status','incomplete','reasons',reasons||'"NO_VERIFIED_OPENING"'::jsonb,
   'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,'rows','[]'::jsonb,'next',NULL,'restatable',true)||CASE WHEN period_meta IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('period',period_meta) END;
 END IF;
 -- A later verified opening must not erase an older supported date. Coverage
 -- and late pre-opening evidence are still checked against the selected one.
 SELECT * INTO b FROM public.stock_history_baselines WHERE store_id=p_branch AND verification_state='verified'
  AND cutoff_ticks<=CASE WHEN period_start IS NULL THEN cutoff ELSE period_start-1 END ORDER BY cutoff_ticks DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN SELECT * INTO b FROM public.stock_history_baselines WHERE id=h.baseline_id AND store_id=p_branch; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'STOCK_HISTORY_INVALID_OPENING'; END IF;
 -- An effect absorbed by a later opening is not coverage for an older report.
 -- Resolve the requested opening before checking its effect associations.
 IF to_regprocedure('private.stock_history_capture_state(text,uuid)') IS NOT NULL THEN
  EXECUTE 'SELECT private.stock_history_capture_state($1,$2)' INTO capture_state USING p_branch,b.id;
  IF (capture_state->>'unvalidatedEffects')::bigint>0 THEN reasons:=reasons||'"UNVALIDATED_STOCK_EFFECTS"'::jsonb;END IF;
  IF (capture_state->>'captureGaps')::bigint>0 THEN reasons:=reasons||'"CAPTURE_GAPS"'::jsonb;END IF;
 END IF;
 SELECT count(*) INTO actual_pairs FROM public.stock_history_openings WHERE baseline_id=b.id AND store_id=p_branch;
 IF b.verification_state<>'verified' OR b.expected_pairs<>actual_pairs THEN reasons:=reasons||'"UNVERIFIED_OPENING"'::jsonb; END IF;
 IF cutoff<b.cutoff_ticks OR (period_start IS NOT NULL AND b.cutoff_ticks>=period_start) THEN reasons:=reasons||'"BEFORE_BASELINE"'::jsonb; END IF;
 IF h.coverage_state<>'complete' OR h.coverage_from_ticks IS NULL OR h.coverage_through_ticks IS NULL
  OR h.coverage_from_ticks>b.cutoff_ticks OR h.coverage_through_ticks<cutoff THEN reasons:=reasons||'"INCOMPLETE_MOVEMENTS"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements WHERE store_id=p_branch AND effective_ticks<=b.cutoff_ticks
  AND ingested_cursor>b.source_cursor AND ingested_cursor<=h.committed_cursor) THEN reasons:=reasons||'"BASELINE_PREHISTORY_CHANGED"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements WHERE store_id=p_branch AND effective_ticks>b.cutoff_ticks
  AND effective_ticks<=cutoff AND ingested_cursor<=h.committed_cursor AND clock_state<>'verified') THEN reasons:=reasons||'"CLOCK_UNVERIFIED"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_history_movements m WHERE m.store_id=p_branch AND m.effective_ticks<=cutoff AND m.ingested_cursor<=h.committed_cursor
  AND NOT EXISTS(SELECT 1 FROM public.stock_history_openings o WHERE o.baseline_id=b.id AND o.store_id=p_branch AND o.product_id=m.product_id)) THEN reasons:=reasons||'"MISSING_OPENING"'::jsonb; END IF;
 revision:='stock-history.v1:'||p_branch||':'||h.committed_cursor||':'||h.coverage_generation||':'||b.id||':'||COALESCE(capture_state->>'revision','capture-uninstalled')||CASE WHEN period_start IS NULL THEN '' ELSE ':period:'||(period_range->>'start')||':'||cutoff::text END;
 IF p_source_revision IS NOT NULL AND p_source_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED'; END IF;
 IF jsonb_array_length(reasons)>0 THEN
  RETURN jsonb_build_object('status',CASE WHEN reasons ? 'BEFORE_BASELINE' OR reasons ? 'FUTURE_CUTOFF' THEN 'unsupported' ELSE 'incomplete' END,
   'reasons',reasons,'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,'baselineAt',b.cutoff_at_raw,'readAt',read_raw,
   'coverageThroughTicks',h.coverage_through_ticks::text,'sourceRevision',revision,'pendingCount','0','rows','[]'::jsonb,'next',NULL,'restatable',true)||CASE WHEN period_meta IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('period',period_meta) END;
 END IF;
 -- Build one immutable keyset page, stopping before its byte budget. A large
 -- product is never skipped or truncated; an oversized first row fails clearly.
 FOR candidate IN SELECT o.* FROM public.stock_history_openings o WHERE o.store_id=p_branch AND o.baseline_id=b.id
  AND (p_after IS NULL OR o.product_id>p_after) ORDER BY o.product_id LIMIT p_limit+1 LOOP
  IF cardinality(page_rows)>=p_limit THEN next_id:=last_id;EXIT;END IF;
  SELECT candidate.quantity+COALESCE(sum(m.quantity_delta),0),
   candidate.quantity+COALESCE(sum(m.quantity_delta) FILTER(WHERE m.effective_ticks<period_start),0),
   COALESCE(sum(m.quantity_delta) FILTER(WHERE m.effective_ticks>=period_start AND m.quantity_delta>0),0),
   COALESCE(-sum(m.quantity_delta) FILTER(WHERE m.effective_ticks>=period_start AND m.quantity_delta<0),0)
   INTO balance,opening,incoming,outgoing FROM public.stock_history_movements m
   WHERE m.store_id=p_branch AND m.product_id=candidate.product_id AND m.effective_ticks>b.cutoff_ticks
    AND m.effective_ticks<=cutoff AND m.ingested_cursor<=h.committed_cursor;
  wire:=jsonb_build_object('productId',candidate.product_id,'locationId',p_branch,'name',candidate.product_name,
   'sku',candidate.sku,'barcode',candidate.barcode,'quantity',balance::text,'negative',balance<0);
  IF period_meta IS NOT NULL THEN
   IF length(trunc(abs(opening))::text)>38 OR length(trunc(incoming)::text)>38 OR length(trunc(outgoing)::text)>38
    THEN RAISE EXCEPTION 'STOCK_HISTORY_ROW_OVERSIZED';END IF;
   wire:=wire||jsonb_build_object('openingQuantity',opening::text,'inQuantity',incoming::text,'outQuantity',outgoing::text);
  END IF;
  IF page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1>245760 THEN
   IF cardinality(page_rows)=0 THEN RAISE EXCEPTION 'STOCK_HISTORY_ROW_OVERSIZED';END IF;
   next_id:=last_id;EXIT;
  END IF;
  page_bytes:=page_bytes+octet_length(convert_to(wire::text,'UTF8'))+1;
  page_rows:=array_append(page_rows,wire);last_id:=candidate.product_id;
 END LOOP;
 page:=to_jsonb(page_rows);
 IF capture_state IS NOT NULL THEN
  EXECUTE 'SELECT private.stock_history_capture_state($1,$2)' INTO capture_after USING p_branch,b.id;
  IF capture_state IS DISTINCT FROM capture_after THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_CHANGED';END IF;
 END IF;
 RETURN jsonb_build_object('status','complete','reasons','[]'::jsonb,'cutoff',p_cutoff,'timeZone',p_zone,'branchId',p_branch,
  'baselineAt',b.cutoff_at_raw,'readAt',read_raw,'sourceRevision',revision,'pendingCount','0','restatable',true,'rows',page,'next',next_id)||CASE WHEN period_meta IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('period',period_meta) END;
END $fn$;
REVOKE ALL ON FUNCTION private.stock_history_read_page_core(text,text,text,text,text,uuid,integer,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_period_page(p_actor text,p_terminal text,p_branch text,p_cutoff text,p_zone text,
 p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100,p_source_revision text DEFAULT NULL,p_export boolean DEFAULT false,p_closed_shift uuid DEFAULT NULL,p_period_start text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $period$
BEGIN
 IF p_period_start IS NULL THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_INVALID';END IF;
 RETURN private.stock_history_read_page_core(p_actor,p_terminal,p_branch,p_cutoff,p_zone,p_after,p_limit,p_source_revision,p_export,p_closed_shift,p_period_start);
END $period$;
REVOKE ALL ON FUNCTION public.pos_stock_history_period_page(text,text,text,text,text,uuid,integer,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_period_page(text,text,text,text,text,uuid,integer,text,boolean,uuid,text) TO service_role;

-- Preserve the original RPC identity, owner, ACL and flags. The shared core
-- retains every original current-account, branch, export and source guard.
DO $upgrade$ DECLARE before pg_proc%ROWTYPE;after pg_proc%ROWTYPE;definition text;
 body text:=$body$BEGIN
 RETURN private.stock_history_read_page_core(p_actor,p_terminal,p_branch,p_cutoff,p_zone,p_after,p_limit,p_source_revision,p_export,p_closed_shift,NULL);
END $body$;
BEGIN
 SELECT * INTO before FROM pg_proc WHERE oid='public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)'::regprocedure;
 definition:=replace(pg_get_functiondef(before.oid),before.prosrc,body);EXECUTE definition;
 SELECT * INTO after FROM pg_proc WHERE oid=before.oid;
 IF after.prosrc IS DISTINCT FROM body OR ROW(after.proowner,after.proacl,after.proconfig,after.prosecdef,after.provolatile,after.prokind,after.proisstrict,after.proleakproof,after.proparallel)
  IS DISTINCT FROM ROW(before.proowner,before.proacl,before.proconfig,before.prosecdef,before.provolatile,before.prokind,before.proisstrict,before.proleakproof,before.proparallel)
  THEN RAISE EXCEPTION 'STOCK_HISTORY_PERIOD_READER_METADATA_CHANGED';END IF;
END $upgrade$;
COMMIT;
