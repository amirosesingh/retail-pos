-- PREPARATION ONLY. Exact ROSEGILL pos qhrufhtbeguxydenzfey approval required.
-- Single atomic statement; does not commit an enclosing operator transaction.
-- Seven NULL-summary repairs only. Held STR1 original-authority shift excluded.
DO $repair$
DECLARE
 expected jsonb := $evidence$[{"shift_id":"2e735bd8-0db2-44fb-a6f7-e28edc64f7e0","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-09 03:37:07.082+00","closed_at":"2026-10-09 11:22:50.674387+00","row_version":5,"parent_fingerprint":"e966db0a2849d650861747e494962225","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"7e9ce80c-bdbc-42eb-96ab-a40df58f662e","count_id":"43dec0c4-d933-4e71-a0a1-e510f54a94f0","reconciliation_fingerprint":"ff2219ebb8b0e3f2ee7228dcfc4c9fe0","count_ids":["43dec0c4-d933-4e71-a0a1-e510f54a94f0"],"counts_fingerprint":"75935c250b8eb69ffd57968ad0aff9f7","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"4bcfc113978513a241605aa01097f092"},{"shift_id":"85902cc1-9804-4d6f-af4f-f73a1e7799b8","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-10 01:57:44.15+00","closed_at":"2026-10-11 02:13:41.543669+00","row_version":5,"parent_fingerprint":"fb8bd6d6a1f36fd9daee30b72ed7e4aa","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"e2f7cacd-bbe4-4241-8ed0-59b848a13bf6","count_id":"a6c1f213-90a3-4d05-ab6e-835465220b05","reconciliation_fingerprint":"fa5f065bae5185e832c0b5397035d878","count_ids":["a6c1f213-90a3-4d05-ab6e-835465220b05"],"counts_fingerprint":"c136cc88cf1ff71e03d1c1dddf85f683","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"0675ced393d57a49c36b7d0a6321411c"},{"shift_id":"d252a275-ebf7-4a09-8cd7-a45706c594a3","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-11 02:15:47.982+00","closed_at":"2026-10-11 15:36:19.677029+00","row_version":5,"parent_fingerprint":"b41a88f1a5a1413a7cad3c85b394af28","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"a7db4559-019e-4dd0-8ade-ff70ab0b1316","count_id":"f85a1d17-5ba1-4d85-856f-b7f80f94d4bf","reconciliation_fingerprint":"38b66fb1ef5d532ce58295135a33a6f1","count_ids":["f85a1d17-5ba1-4d85-856f-b7f80f94d4bf"],"counts_fingerprint":"e01cfec0c60bc2ada5bfdbcc0ba3d253","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"dee35eb627f98cf1d5eadbcf5cc221a2"},{"shift_id":"a23393c7-a38b-4bcb-93fe-1a3b057e0fe2","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-26 14:34:02.556696+00","closed_at":"2026-10-26 15:32:03.895139+00","row_version":4,"parent_fingerprint":"f4efd614cb959c8f1e1ab485f84b5e8a","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"56d51913-e03c-4d19-93d8-dbee8a35b4f5","count_id":"42133a20-03eb-43eb-8a6c-9d48e58df3a7","reconciliation_fingerprint":"bbe3d5e85142198f85b769d3fb46e851","count_ids":["42133a20-03eb-43eb-8a6c-9d48e58df3a7"],"counts_fingerprint":"872571d181d2c1129a519151241f7216","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"c926d09acc392752efc6b5333c0698ad"},{"shift_id":"f725325a-8919-4d9d-b9cb-24f43d185147","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-29 01:19:32.597+00","closed_at":"2026-10-30 14:15:37.759194+00","row_version":4,"parent_fingerprint":"959a6146fba30c8b1f1c14e00461e53e","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"298dd006-7088-424f-bfe3-412a5da37f56","count_id":"d60e264d-a06a-4221-bd9b-a36935d0699e","reconciliation_fingerprint":"2aa80b63c9d460586237bbd76b48bb4e","count_ids":["d60e264d-a06a-4221-bd9b-a36935d0699e"],"counts_fingerprint":"54d2995b5fc16064acd7d9a27e05bf35","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"c06045bde616132dfb581d3db2790d62"},{"shift_id":"8be4c1e9-3f88-4e7b-b52f-a6f31b5005c8","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-10-30 07:04:32.461+00","closed_at":"2026-10-30 14:15:06.46265+00","row_version":4,"parent_fingerprint":"9d45df1f2488a1d6bfef5ba13919e36c","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"1f88606d-ded3-4f06-b849-1d2d387c6574","count_id":"f65f0b25-d870-4cea-9327-aa95bd11e4a8","reconciliation_fingerprint":"279a8ac766d1919cc998fd531c3a5b25","count_ids":["f65f0b25-d870-4cea-9327-aa95bd11e4a8"],"counts_fingerprint":"343434a5e8604cdd7b00a440b4c178a2","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"a96da12fa10caef8ca2f7d68b8a51de9"},{"shift_id":"acbc1ed1-2fc1-44c7-9c71-c338da7fda2f","authority_repair_on_hold":false,"parent_exists":true,"store_id":"a611a328-2217-4d77-944a-5f6a637d123b","opened_at":"2026-11-01 02:29:21.604+00","closed_at":"2026-11-01 13:37:52.317008+00","row_version":5,"parent_fingerprint":"cd440bfafcaf057713210de431688d0c","closed_header_valid":true,"exactly_five_destinations_null":true,"count_rows":1,"original_count_rows":1,"reconciliation_rows":1,"reconciliation_id":"f78aeab8-f671-4435-858f-636276f9230c","count_id":"dbe918e1-df5e-4eba-9518-a47c6893f40d","reconciliation_fingerprint":"745723155e27cbd338c44aa654c20384","count_ids":["dbe918e1-df5e-4eba-9518-a47c6893f40d"],"counts_fingerprint":"5c067ed0147648ea3f930b973ae33ecd","reconciliation_branch_matches":true,"original_link_valid":true,"count_reconciliation_tenders_match":true,"untouched_summaries_match":true,"entire_graph_fingerprint":"8630b7e417668dc77d5d0d9772da0f36"}]$evidence$::jsonb;
 trigger_expected jsonb := $triggers$[{"name":"sync_feed_delete","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_delete AFTER DELETE ON public.audit_logs REFERENCING OLD TABLE AS old_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_delete()","body_md5":"c232143d97ad08ea5c63d6ac7dc2a904"},{"name":"sync_feed_insert","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_insert AFTER INSERT ON public.audit_logs REFERENCING NEW TABLE AS new_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_insert()","body_md5":"2ed8a858c85562e2c8f3cbeb0b24c3fe"},{"name":"sync_feed_update","table":"audit_logs","definition":"CREATE TRIGGER sync_feed_update AFTER UPDATE ON public.audit_logs REFERENCING NEW TABLE AS new_audit_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_feed_audit_logs_update()","body_md5":"72f36486de2ae53fe755ddce16151ab0"},{"name":"shifts_aa_stale_guard","table":"shifts","definition":"CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update()","body_md5":"e421522c8ce32d643bdafe9396231d15"},{"name":"shifts_bump_row_version","table":"shifts","definition":"CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version()","body_md5":"7163917341ebd05bf1c0db6cbf3da0bf"},{"name":"shifts_guard_client_writes","table":"shifts","definition":"CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes()","body_md5":"c5f6351d1febcb8b5b8b4ca09bb9caa4"},{"name":"shifts_set_updated_at","table":"shifts","definition":"CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()","body_md5":"301a884953d37769916294bb60562e05"},{"name":"shifts_sync_status_trg","table":"shifts","definition":"CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status()","body_md5":"0899de827f0d211a5f29b966de325cf3"},{"name":"shifts_unfinished_tickets","table":"shifts","definition":"CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets()","body_md5":"d348906a270341dcd329adce5278009d"},{"name":"sync_feed_change","table":"shifts","definition":"CREATE TRIGGER sync_feed_change AFTER INSERT OR DELETE OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION sync_feed_shifts()","body_md5":"89d04e77c6dd485e27acb96bd99355f1"}]$triggers$::jsonb;
 repair_key constant text := 'SHIFT49-seven-null-parent-summaries-20261103';
 branch constant text := 'a611a328-2217-4d77-944a-5f6a637d123b';
 held constant uuid := '1a349429-cea1-4f45-8d2b-36678d37ad27';
 item jsonb; trig jsonb; child_table text; parent public.shifts%ROWTYPE; recon public.shift_reconciliations%ROWTYPE;
 counted public.shift_cash_counts%ROWTYPE; audit public.audit_logs%ROWTYPE;
 before_parent jsonb; after_parent jsonb; before_graph jsonb; after_graph jsonb;
 audit_id uuid; prior_setting text; prior_timezone text; affected integer; existing integer; total integer:=0;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' THEN
  RAISE EXCEPTION 'SHIFT49 wrong database or maintenance identity'; END IF;
 IF jsonb_array_length(expected)<>7 OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE (e->>'shift_id')::uuid=held OR e->>'store_id'<>branch OR (e->>'authority_repair_on_hold')::boolean)
  OR (SELECT count(DISTINCT e->>'shift_id') FROM jsonb_array_elements(expected) e)<>7 THEN
  RAISE EXCEPTION 'SHIFT49 invalid exact repair scope'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(repair_key,0)) THEN RAISE EXCEPTION 'SHIFT49 repair busy'; END IF;
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
  RAISE EXCEPTION 'SHIFT49 graph validator metadata changed'; END IF;
 FOREACH child_table IN ARRAY ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid=('public.'||child_table)::regclass
   AND c.confrelid='public.shifts'::regclass AND NOT c.condeferrable AND NOT c.condeferred AND c.confdeltype='c'
   AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='shift_id')]::smallint[]
   AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]) THEN
   RAISE EXCEPTION 'SHIFT49 child lock prerequisite changed'; END IF;
 END LOOP;
 -- Pin every captured user trigger and its body; never disable or replace one.
 IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid IN('public.shifts'::regclass,'public.audit_logs'::regclass) AND NOT t.tgisinternal)<>jsonb_array_length(trigger_expected) THEN
  RAISE EXCEPTION 'SHIFT49 trigger set changed'; END IF;
 FOR trig IN SELECT value FROM jsonb_array_elements(trigger_expected) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=('public.'||(trig->>'table'))::regclass AND t.tgname=trig->>'name' AND NOT t.tgisinternal
     AND t.tgenabled='O' AND pg_get_triggerdef(t.oid)=trig->>'definition' AND md5(p.prosrc)=trig->>'body_md5') THEN
   RAISE EXCEPTION 'SHIFT49 trigger definition changed'; END IF;
 END LOOP;
 SELECT count(*) INTO existing FROM public.audit_logs a WHERE a.id IN(
  SELECT md5(repair_key||':'||(e->>'shift_id'))::uuid FROM jsonb_array_elements(expected) e);
 IF existing NOT IN(0,7) THEN RAISE EXCEPTION 'SHIFT49 partial audit receipt set'; END IF;
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
  IF existing=7 THEN
   SELECT * INTO STRICT audit FROM public.audit_logs WHERE id=audit_id FOR UPDATE NOWAIT;
   IF audit.action_category IS DISTINCT FROM 'maintenance' OR audit.action_name IS DISTINCT FROM 'shift_summary_repair'
    OR audit.store_id IS DISTINCT FROM branch OR audit.user_name IS DISTINCT FROM 'postgres maintenance (owner-approved repair)'
    OR audit.details->>'repair_key' IS DISTINCT FROM repair_key OR audit.details->>'shift_id' IS DISTINCT FROM parent.id::text
    OR md5(audit.before_state::text) IS DISTINCT FROM item->>'parent_fingerprint'
    OR audit.after_state IS DISTINCT FROM before_parent
    OR audit.details->>'after_graph_fingerprint' IS DISTINCT FROM md5(before_graph::text)
    OR md5(jsonb_set(before_graph,'{0,rows,0}',audit.before_state)::text) IS DISTINCT FROM item->>'entire_graph_fingerprint'
    OR (before_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
     IS DISTINCT FROM (audit.before_state-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
    OR (before_parent->>'row_version')::bigint<>(item->>'row_version')::bigint+1 THEN
     RAISE EXCEPTION 'SHIFT49 replay facts changed'; END IF;
   PERFORM pos_sync_private.validate_graph(before_graph,branch,parent.id,true);
   CONTINUE;
  END IF;
  IF parent.store_id IS DISTINCT FROM branch OR parent.id=held OR parent.row_version IS DISTINCT FROM (item->>'row_version')::bigint
   OR md5(before_parent::text) IS DISTINCT FROM item->>'parent_fingerprint'
   OR md5(before_graph::text) IS DISTINCT FROM item->>'entire_graph_fingerprint'
   OR parent.status IS DISTINCT FROM 'CLOSED' OR parent.state IS DISTINCT FROM 'CLOSED' OR parent.closed_at IS NULL
   OR parent.expected_cash IS NOT NULL OR parent.expected_card IS NOT NULL OR parent.expected_digital IS NOT NULL
   OR parent.variance_cash IS NOT NULL OR parent.variance_total IS NOT NULL THEN
    RAISE EXCEPTION 'SHIFT49 parent before-image changed'; END IF;
  IF (SELECT count(*) FROM public.shift_cash_counts WHERE shift_id=parent.id)<>1
   OR (SELECT count(*) FROM public.shift_reconciliations WHERE shift_id=parent.id)<>1 THEN
    RAISE EXCEPTION 'SHIFT49 child cardinality changed'; END IF;
  SELECT * INTO STRICT recon FROM public.shift_reconciliations WHERE id=(item->>'reconciliation_id')::uuid AND shift_id=parent.id;
  SELECT * INTO STRICT counted FROM public.shift_cash_counts WHERE id=(item->>'count_id')::uuid AND shift_id=parent.id;
  IF recon.store_id IS DISTINCT FROM branch OR counted.store_id IS DISTINCT FROM branch OR counted.kind IS DISTINCT FROM 'ORIGINAL'
   OR recon.count_id IS DISTINCT FROM counted.id OR md5(to_jsonb(recon)::text) IS DISTINCT FROM item->>'reconciliation_fingerprint'
   OR md5(jsonb_build_array(to_jsonb(counted))::text) IS DISTINCT FROM item->>'counts_fingerprint'
   OR ROW(counted.counted_cash,counted.counted_card,counted.counted_digital) IS DISTINCT FROM ROW(recon.counted_cash,recon.counted_card,recon.counted_digital)
   OR ROW(COALESCE(parent.final_counted_cash,parent.counted_cash),parent.counted_card,parent.counted_digital,parent.variance_card,parent.variance_digital,parent.variance_status)
    IS DISTINCT FROM ROW(recon.counted_cash,recon.counted_card,recon.counted_digital,recon.variance_card,recon.variance_digital,recon.variance_status) THEN
    RAISE EXCEPTION 'SHIFT49 saved reconciliation changed'; END IF;
  -- Exact saved facts, never current sales or expectation recomputation.
  PERFORM set_config('pos.shift_fn','on',true);
  UPDATE public.shifts SET expected_cash=recon.expected_cash,expected_card=recon.expected_card,expected_digital=recon.expected_digital,
    variance_cash=recon.variance_cash,variance_total=recon.variance_total WHERE id=parent.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM set_config('pos.shift_fn',COALESCE(prior_setting,''),true);
  IF affected<>1 THEN RAISE EXCEPTION 'SHIFT49 update not acknowledged'; END IF;
  SELECT to_jsonb(s) INTO after_parent FROM public.shifts s WHERE s.id=parent.id;
  after_graph:=pos_sync_private.shift_graph(parent.id);
  IF (after_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
    IS DISTINCT FROM (before_parent-ARRAY['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])
   OR (after_parent->>'row_version')::bigint<>parent.row_version+1
   OR (after_graph-0) IS DISTINCT FROM (before_graph-0) THEN
    RAISE EXCEPTION 'SHIFT49 unrelated facts changed'; END IF;
  PERFORM pos_sync_private.validate_graph(after_graph,branch,parent.id,true);
  INSERT INTO public.audit_logs(id,user_name,action_category,action_name,target_module,details,user_id,action,entity,before_state,after_state,store_id)
   VALUES(audit_id,'postgres maintenance (owner-approved repair)','maintenance','shift_summary_repair','shifts',
    jsonb_build_object('repair_key',repair_key,'shift_id',parent.id,'database_session_user',session_user,
     'reason','Restore five NULL parent summaries from the exact existing reconciliation; no count or timing correction',
     'before_graph_fingerprint',md5(before_graph::text),'after_graph_fingerprint',md5(after_graph::text)),
    NULL,'repair','shifts',before_parent,after_parent,branch);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 OR NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=audit_id AND a.before_state=before_parent AND a.after_state=after_parent AND a.details->>'repair_key'=repair_key) THEN
   RAISE EXCEPTION 'SHIFT49 audit not acknowledged'; END IF;
  total:=total+1;
 END LOOP;
 IF existing=0 AND total<>7 THEN RAISE EXCEPTION 'SHIFT49 repair count mismatch'; END IF;
 PERFORM set_config('TimeZone',prior_timezone,true);
 RAISE NOTICE 'SHIFT49 exact seven-row repair verified; existing audit receipts: %, changed rows: %',existing,total;
END $repair$;
