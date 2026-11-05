-- PREPARATION ONLY. Exact ROSEGILL pos qhrufhtbeguxydenzfey approval required.
-- Single atomic statement; does not commit an enclosing operator transaction.
-- One saved WEB closing; owner superseded prior original-cashier authority.
DO $repair$
DECLARE
 expected jsonb := $evidence$[{"shift_id":"1a349429-cea1-4f45-8d2b-36678d37ad27","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-31 02:22:18.108+00","closed_at":"2026-11-01 13:38:37.207159+00","row_version":5,"parent_fingerprint":"996d4f3d74e9d7704fb68403f0818d1b","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"fb96ca0c-f5bf-4af1-a941-079e7f9787e1","count_id":"e4de3b43-5667-48e6-b493-e8622f7a026e","reconciliation_fingerprint":"95bd47354a85c55ea1576491f3e2579e","count_ids":["e4de3b43-5667-48e6-b493-e8622f7a026e"],"counts_fingerprint":"dd99b8aaa332971755df3c8dc9c2a5d4","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"fd55a0dbab4401786c7f801407330bb4","authority_source":"owner_selected_saved_web_closing"}]$evidence$::jsonb;
 trigger_expected jsonb := $triggers$[{"name":"sync_feed_delete","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_delete AFTER DELETE ON public.audit_logs REFERENCING OLD TABLE AS old_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_delete()","body_md5":"c232143d97ad08ea5c63d6ac7dc2a904"},{"name":"sync_feed_insert","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_insert AFTER INSERT ON public.audit_logs REFERENCING NEW TABLE AS new_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_insert()","body_md5":"2ed8a858c85562e2c8f3cbeb0b24c3fe"},{"name":"sync_feed_update","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_update AFTER UPDATE ON public.audit_logs REFERENCING NEW TABLE AS new_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_update()","body_md5":"72f36486de2ae53fe755ddce16151ab0"},{"name":"shifts_aa_stale_guard","table":"shifts","definition":"CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update()","body_md5":"3733e4ac528c834bfd20f8764a466f03"},{"name":"shifts_bump_row_version","table":"shifts","definition":"CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version()","body_md5":"590b3078ce355a216f389c60b8008d8d"},{"name":"shifts_guard_client_writes","table":"shifts","definition":"CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes()","body_md5":"ebe71ffe053a6f6f397b3a53c2e8e566"},{"name":"shifts_set_updated_at","table":"shifts","definition":"CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()","body_md5":"749d6e72e457701152e365704cde3807"},{"name":"shifts_sync_status_trg","table":"shifts","definition":"CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status()","body_md5":"45652b7ffe1794ac619f32e0a9e5cb81"},{"name":"shifts_unfinished_tickets","table":"shifts","definition":"CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets()","body_md5":"1539979362f3d8509800d00a44709ba1"},{"name":"sync_feed_change","table":"shifts","definition":"CREATE TRIGGER sync_feed_change AFTER INSERT OR DELETE OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION sync_feed_shifts()","body_md5":"a0a9de529599da6ce8b86c41f07a9d51"}]$triggers$::jsonb;
 repair_key constant text := 'SHIFT52-saved-web-null-parent-summaries-20261104';
 branch constant text := 'a611a328-2217-4d77-944a-5f6a637d123b';
 target constant uuid := '1a349429-cea1-4f45-8d2b-36678d37ad27';
 item jsonb; trig jsonb; child_table text; parent public.shifts%ROWTYPE; recon public.shift_reconciliations%ROWTYPE;
 counted public.shift_cash_counts%ROWTYPE; audit public.audit_logs%ROWTYPE;
 before_parent jsonb; after_parent jsonb; before_graph jsonb; after_graph jsonb;
 audit_id uuid; prior_setting text; prior_timezone text; affected integer; existing integer; total integer:=0;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' THEN
  RAISE EXCEPTION 'SHIFT52 wrong database or maintenance identity'; END IF;
 IF jsonb_array_length(expected)<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE (e->>'shift_id')::uuid IS DISTINCT FROM target OR e->>'store_id'<>branch OR e->>'authority_source' IS DISTINCT FROM 'owner_selected_saved_web_closing')
  OR (SELECT count(DISTINCT e->>'shift_id') FROM jsonb_array_elements(expected) e)<>1 THEN
  RAISE EXCEPTION 'SHIFT52 invalid exact repair scope'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(repair_key,0)) THEN RAISE EXCEPTION 'SHIFT52 repair busy'; END IF;
 prior_timezone:=current_setting('TimeZone');
 PERFORM set_config('TimeZone','UTC',true);
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
   WHERE p.oid='pos_sync_private.shift_graph(uuid)'::regprocedure
    AND md5(replace(p.prosrc,E'\r\n',E'\n'))='eb2f45f5514dbc6fefc5b4b812427339'
    AND NOT p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict AND o.rolname='postgres'
    AND p.proconfig=ARRAY['search_path=public, pg_temp','TimeZone=UTC'])
  OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
   WHERE p.oid='pos_sync_private.validate_graph(jsonb,text,uuid,boolean)'::regprocedure
    AND md5(replace(p.prosrc,E'\r\n',E'\n'))='9099e008247f011a59527c9383dc4c37'
    AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict AND o.rolname='postgres'
    AND p.proconfig=ARRAY['search_path=public, pg_temp','TimeZone=UTC']) THEN
  RAISE EXCEPTION 'SHIFT52 graph validator metadata changed'; END IF;
 FOREACH child_table IN ARRAY ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid=('public.'||child_table)::regclass
   AND c.confrelid='public.shifts'::regclass AND NOT c.condeferrable AND NOT c.condeferred AND c.confdeltype='c'
   AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='shift_id')]::smallint[]
   AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]) THEN
   RAISE EXCEPTION 'SHIFT52 child lock prerequisite changed'; END IF;
 END LOOP;
 -- Pin every captured user trigger and its body; never disable or replace one.
 IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid IN('public.shifts'::regclass,'public.audit_logs'::regclass) AND NOT t.tgisinternal)<>jsonb_array_length(trigger_expected) THEN
  RAISE EXCEPTION 'SHIFT52 trigger set changed'; END IF;
 FOR trig IN SELECT value FROM jsonb_array_elements(trigger_expected) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=('public.'||(trig->>'table'))::regclass AND t.tgname=trig->>'name' AND NOT t.tgisinternal
     AND t.tgenabled='O' AND pg_get_triggerdef(t.oid)=trig->>'definition' AND md5(p.prosrc)=trig->>'body_md5') THEN
   RAISE EXCEPTION 'SHIFT52 trigger definition changed'; END IF;
 END LOOP;
 SELECT count(*) INTO existing FROM public.audit_logs a WHERE a.id IN(
  SELECT md5(repair_key||':'||(e->>'shift_id'))::uuid FROM jsonb_array_elements(expected) e);
 IF existing NOT IN(0,1) THEN RAISE EXCEPTION 'SHIFT52 invalid audit receipt set'; END IF;
 -- Parent FOR UPDATE also prevents new FK-linked children during the repair.
 FOR item IN SELECT value FROM jsonb_array_elements(expected) ORDER BY value->>'shift_id' LOOP
  SELECT * INTO STRICT parent FROM public.shifts WHERE id=(item->>'shift_id')::uuid FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.shift_cash_counts WHERE shift_id=parent.id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.shift_reconciliations WHERE shift_id=parent.id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.shift_close_events WHERE shift_id=parent.id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.shift_notifications WHERE shift_id=parent.id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.shift_variance_alerts WHERE shift_id=parent.id ORDER BY id FOR UPDATE NOWAIT;
 END LOOP;
 prior_setting:=current_setting('pos.shift_fn',true);
 FOR item IN SELECT value FROM jsonb_array_elements(expected) ORDER BY value->>'shift_id' LOOP
  SELECT * INTO STRICT parent FROM public.shifts WHERE id=(item->>'shift_id')::uuid;
  before_parent:=to_jsonb(parent); before_graph:=pos_sync_private.shift_graph(parent.id);
  audit_id:=md5(repair_key||':'||parent.id::text)::uuid;
  IF existing=1 THEN
   SELECT * INTO STRICT audit FROM public.audit_logs WHERE id=audit_id FOR UPDATE NOWAIT;
   IF audit.action_category IS DISTINCT FROM 'maintenance' OR audit.action_name IS DISTINCT FROM 'shift_summary_repair'
    OR audit.store_id IS DISTINCT FROM branch OR audit.user_name IS DISTINCT FROM 'postgres maintenance (owner-approved repair)'
    OR audit.details->>'repair_key' IS DISTINCT FROM repair_key OR audit.details->>'shift_id' IS DISTINCT FROM parent.id::text
    OR audit.details->>'authority_source' IS DISTINCT FROM 'owner_selected_saved_web_closing'
    OR md5(audit.before_state::text) IS DISTINCT FROM item->>'parent_fingerprint'
    OR audit.after_state IS DISTINCT FROM before_parent
    OR audit.details->>'after_graph_fingerprint' IS DISTINCT FROM md5(before_graph::text)
    OR md5(jsonb_set(before_graph,'{0,rows,0}',audit.before_state)::text) IS DISTINCT FROM item->>'entire_graph_fingerprint'
    OR (before_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
     IS DISTINCT FROM (audit.before_state-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
    OR (before_parent->>'row_version')::bigint<>(item->>'row_version')::bigint+1 THEN
     RAISE EXCEPTION 'SHIFT52 replay facts changed'; END IF;
   PERFORM pos_sync_private.validate_graph(before_graph,branch,parent.id,true);
   CONTINUE;
  END IF;
  IF parent.store_id IS DISTINCT FROM branch OR parent.id IS DISTINCT FROM target OR parent.row_version IS DISTINCT FROM (item->>'row_version')::bigint
   OR md5(before_parent::text) IS DISTINCT FROM item->>'parent_fingerprint'
   OR md5(before_graph::text) IS DISTINCT FROM item->>'entire_graph_fingerprint'
   OR parent.status IS DISTINCT FROM 'CLOSED' OR parent.state IS DISTINCT FROM 'CLOSED' OR parent.closed_at IS NULL
   OR parent.expected_cash IS NOT NULL OR parent.expected_card IS NOT NULL OR parent.expected_digital IS NOT NULL
   OR parent.variance_cash IS NOT NULL OR parent.variance_total IS NOT NULL THEN
    RAISE EXCEPTION 'SHIFT52 parent before-image changed'; END IF;
  IF (SELECT count(*) FROM public.shift_cash_counts WHERE shift_id=parent.id)<>1
   OR (SELECT count(*) FROM public.shift_reconciliations WHERE shift_id=parent.id)<>1 THEN
    RAISE EXCEPTION 'SHIFT52 child cardinality changed'; END IF;
  SELECT * INTO STRICT recon FROM public.shift_reconciliations WHERE id=(item->>'reconciliation_id')::uuid AND shift_id=parent.id;
  SELECT * INTO STRICT counted FROM public.shift_cash_counts WHERE id=(item->>'count_id')::uuid AND shift_id=parent.id;
  IF recon.store_id IS DISTINCT FROM branch OR counted.store_id IS DISTINCT FROM branch OR counted.kind IS DISTINCT FROM 'ORIGINAL'
   OR recon.count_id IS DISTINCT FROM counted.id OR md5(to_jsonb(recon)::text) IS DISTINCT FROM item->>'reconciliation_fingerprint'
   OR md5(jsonb_build_array(to_jsonb(counted))::text) IS DISTINCT FROM item->>'counts_fingerprint'
   OR ROW(counted.counted_cash,counted.counted_card,counted.counted_digital) IS DISTINCT FROM ROW(recon.counted_cash,recon.counted_card,recon.counted_digital)
   OR ROW(COALESCE(parent.final_counted_cash,parent.counted_cash),parent.counted_card,parent.counted_digital,parent.variance_card,parent.variance_digital,parent.variance_status)
    IS DISTINCT FROM ROW(recon.counted_cash,recon.counted_card,recon.counted_digital,recon.variance_card,recon.variance_digital,recon.variance_status) THEN
    RAISE EXCEPTION 'SHIFT52 saved reconciliation changed'; END IF;
  -- Exact saved facts, never current sales or expectation recomputation.
  PERFORM set_config('pos.shift_fn','on',true);
  UPDATE public.shifts SET expected_cash=recon.expected_cash,expected_card=recon.expected_card,expected_digital=recon.expected_digital,
    variance_cash=recon.variance_cash,variance_total=recon.variance_total WHERE id=parent.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM set_config('pos.shift_fn',COALESCE(prior_setting,''),true);
  IF affected<>1 THEN RAISE EXCEPTION 'SHIFT52 update not acknowledged'; END IF;
  SELECT to_jsonb(s) INTO after_parent FROM public.shifts s WHERE s.id=parent.id;
  after_graph:=pos_sync_private.shift_graph(parent.id);
  IF (after_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
    IS DISTINCT FROM (before_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
   OR (after_parent->>'row_version')::bigint<>parent.row_version+1
   OR (after_graph-0) IS DISTINCT FROM (before_graph-0) THEN
    RAISE EXCEPTION 'SHIFT52 unrelated facts changed'; END IF;
  PERFORM pos_sync_private.validate_graph(after_graph,branch,parent.id,true);
  INSERT INTO public.audit_logs(id,user_name,action_category,action_name,target_module,details,user_id,action,entity,before_state,after_state,store_id)
   VALUES(audit_id,'postgres maintenance (owner-approved repair)','maintenance','shift_summary_repair','shifts',
    jsonb_build_object('repair_key',repair_key,'shift_id',parent.id,'database_session_user',session_user,'authority_source',item->>'authority_source',
     'reason','Restore five NULL parent summaries from the owner-selected saved web closing reconciliation; no count or timing correction',
     'before_graph_fingerprint',md5(before_graph::text),'after_graph_fingerprint',md5(after_graph::text)),
    NULL,'repair','shifts',before_parent,after_parent,branch);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 OR NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=audit_id AND a.before_state=before_parent AND a.after_state=after_parent AND a.details->>'repair_key'=repair_key) THEN
   RAISE EXCEPTION 'SHIFT52 audit not acknowledged'; END IF;
  total:=total+1;
 END LOOP;
 IF existing=0 AND total<>1 THEN RAISE EXCEPTION 'SHIFT52 repair count mismatch'; END IF;
 PERFORM set_config('TimeZone',prior_timezone,true);
 RAISE NOTICE 'SHIFT52 exact saved-web shift repair verified; existing audit receipts: %, changed rows: %',existing,total;
END $repair$;
