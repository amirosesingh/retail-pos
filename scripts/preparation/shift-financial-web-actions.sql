-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT APPLY TO OPERATOR DATABASE.
-- New web actions only: exact canonical v2 arithmetic under the actual existing
-- caller/action/branch guards. Legacy accepted replay returns remain untouched.
-- No new public RPC, permission grant, global report-helper change or data repair.
BEGIN;
DO $pins$
DECLARE p record;
BEGIN
 FOR p IN SELECT * FROM (VALUES
 ('pos_admin_correct_closed_shift','6322741fecb9b086e93f413bf78e3f62'),
 ('shift_cash_count_submit','7da4fe386d35979d7b7cbc89f00a0dc6'),
 ('shift_close_start','66e07e54e6a9bc23bc3098a7c2fae40e'),
 ('shift_variance_approve','902e778332c2dca9bc34d241a1f9e119'),
 ('shift_reconcile_now','04a2bce3bfad4277dcc9aa2751f6ddbd'),
 ('shift_recount_submit','fa77acc46f885c1734e18d883d4f7f89')) expected(name,digest) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc r WHERE r.pronamespace='public'::regnamespace AND r.proname=p.name AND md5(replace(pg_get_functiondef(r.oid),E'\r\n',E'\n')) IN (p.digest,CASE p.name WHEN 'shift_close_start' THEN '0017c1ad94bcd3b3db49fdaa803d70ce' WHEN 'shift_reconcile_now' THEN '920af85fa748db61b9d9c723c16eb495' ELSE p.digest END) AND r.proowner='postgres'::regrole AND r.prosecdef AND r.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')) THEN RAISE EXCEPTION 'FIN62_WEB_SOURCE_UNEXPECTED: %',p.name;END IF;
 END LOOP;
END $pins$;
CREATE SCHEMA fin62_web_preparation;
REVOKE ALL ON SCHEMA fin62_web_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_web_preparation.actions(
 count_id uuid PRIMARY KEY REFERENCES public.shift_cash_counts(id),shift_id uuid NOT NULL,branch_id text NOT NULL,
 action text NOT NULL CHECK(action IN('ORIGINAL','RECOUNT','ADMIN_CORRECTION')),
 formula text NOT NULL CHECK(formula='canonical-exact-decimal-v2'),basis_json text NOT NULL,basis_hash text NOT NULL CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
 expected_cash numeric NOT NULL,expected_card numeric NOT NULL,expected_digital numeric NOT NULL,
 counted_cash numeric NOT NULL,counted_card numeric,counted_digital numeric,
 snapshot_text text NOT NULL,creator_xid xid8 NOT NULL,actor_user_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(basis_json)<=6291456)
);
CREATE TABLE fin62_web_preparation.active_actions(pid integer NOT NULL,xid xid8 NOT NULL,count_id uuid NOT NULL,shift_id uuid NOT NULL,branch_id text NOT NULL,owns_graph_context boolean NOT NULL,PRIMARY KEY(pid,xid));
ALTER TABLE fin62_web_preparation.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_web_preparation.active_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fin62_web_preparation.actions,fin62_web_preparation.active_actions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_web_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'FIN62_WEB_ACTION_IMMUTABLE';END $$;
CREATE TRIGGER actions_immutable BEFORE UPDATE OR DELETE ON fin62_web_preparation.actions FOR EACH ROW EXECUTE FUNCTION fin62_web_preparation.immutable();
CREATE FUNCTION fin62_web_preparation.validate_counted(cash numeric,card numeric,digital numeric) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE amount numeric;
BEGIN
 FOREACH amount IN ARRAY ARRAY[cash,card,digital] LOOP
  IF amount IS NOT NULL THEN
   PERFORM fin62_preparation.math_decimal_text(amount::text);
   IF amount<>round(amount,2) THEN RAISE EXCEPTION 'FIN62_WEB_COUNT_WHOLE_CENTS_REQUIRED';END IF;
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION fin62_web_preparation.capture_expected(p_shift uuid,p_count uuid,p_action text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE sh public.shifts%ROWTYPE;c public.shift_cash_counts%ROWTYPE;basis jsonb;raw text;computed jsonb;snapshot text;protected boolean:=false;
BEGIN
 SELECT * INTO STRICT sh FROM public.shifts WHERE id=p_shift FOR UPDATE;
 SELECT * INTO STRICT c FROM public.shift_cash_counts WHERE id=p_count AND shift_id=p_shift AND store_id=sh.store_id;
 IF p_action NOT IN('ORIGINAL','RECOUNT','ADMIN_CORRECTION') OR (p_action='ORIGINAL') IS DISTINCT FROM (c.kind='ORIGINAL') THEN RAISE EXCEPTION 'FIN62_WEB_COUNT_SCOPE_MISMATCH';END IF;
 PERFORM fin62_web_preparation.validate_counted(c.counted_cash,c.counted_card,c.counted_digital);
 IF EXISTS(SELECT 1 FROM fin62_web_preparation.active_actions WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id()) THEN RAISE EXCEPTION 'FIN62_WEB_ACTION_CONTEXT_BUSY';END IF;
 -- One statement snapshot covers the COMPLETE actual server input set. No
 -- caller-supplied totals, subset lists, timestamps or authorized flags exist.
 WITH scope AS MATERIALIZED(SELECT * FROM public.shifts WHERE id=p_shift AND store_id=sh.store_id),inputs AS MATERIALIZED(
  SELECT s.* FROM public.sales s JOIN scope p ON s.store_id=p.store_id AND s.shift_id=p.id::text)
 SELECT jsonb_build_object('prototypeVersion',2,'formula','canonical-exact-decimal-v2','branchId',p.store_id,'shiftId',p.id,'openingFloat',p.opening_float::text,'parentSnapshot',to_jsonb(p),'inputs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'branchId',s.store_id,'shiftId',s.shift_id,'totalAmount',s.total_amount::text,'paymentType',s.payment_type,'paymentsJson',s.payments::text,'discountAmount',s.discount_amount::text,'isRefunded',s.is_refunded,'rowVersion',s.row_version::text) ORDER BY s.id) FROM inputs s),'[]'::jsonb)),pg_current_snapshot()::text INTO STRICT basis,snapshot FROM scope p;
 raw:=basis::text;computed:=fin62_preparation.validate_financial_math_text(raw);
 IF computed->>'status'<>'computed' OR computed->>'formula'<>'canonical-exact-decimal-v2' THEN RAISE EXCEPTION 'FIN62_WEB_MATH_UNVERIFIED';END IF;
 INSERT INTO fin62_web_preparation.actions(count_id,shift_id,branch_id,action,formula,basis_json,basis_hash,expected_cash,expected_card,expected_digital,counted_cash,counted_card,counted_digital,snapshot_text,creator_xid,actor_user_id)
 VALUES(p_count,p_shift,sh.store_id,p_action,'canonical-exact-decimal-v2',raw,encode(sha256(convert_to(raw,'UTF8')),'hex'),(computed#>>'{expected,cash}')::numeric,(computed#>>'{expected,card}')::numeric,(computed#>>'{expected,digital}')::numeric,c.counted_cash,c.counted_card,c.counted_digital,snapshot,pg_current_xact_id(),auth.uid());
 IF to_regclass('fin62_history_preparation.protected_shifts') IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts WHERE shift_id=p_shift AND branch_id=sh.store_id) INTO protected;
 END IF;
 IF protected THEN
  IF EXISTS(SELECT 1 FROM fin62_history_preparation.graph_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id()) THEN RAISE EXCEPTION 'FIN62_WEB_GRAPH_CONTEXT_BUSY';END IF;
  INSERT INTO fin62_history_preparation.graph_context VALUES(pg_backend_pid(),pg_current_xact_id(),sh.store_id,p_shift);
 END IF;
 INSERT INTO fin62_web_preparation.active_actions VALUES(pg_backend_pid(),pg_current_xact_id(),p_count,p_shift,sh.store_id,protected);
END $$;
CREATE FUNCTION fin62_web_preparation.action_expected(p_shift uuid,p_count uuid) RETURNS TABLE(expected_cash numeric,expected_card numeric,expected_digital numeric) LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fin62_web_preparation.active_actions WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id() AND count_id=p_count AND shift_id=p_shift) THEN RAISE EXCEPTION 'FIN62_WEB_ACTION_CONTEXT_REQUIRED';END IF;
 RETURN QUERY SELECT a.expected_cash,a.expected_card,a.expected_digital FROM fin62_web_preparation.actions a WHERE a.count_id=p_count AND a.shift_id=p_shift;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_WEB_ACTION_MISSING';END IF;
END $$;
CREATE FUNCTION fin62_web_preparation.end_action(p_shift uuid,p_count uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE active fin62_web_preparation.active_actions%ROWTYPE;
BEGIN
 SELECT * INTO STRICT active FROM fin62_web_preparation.active_actions WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id() AND shift_id=p_shift AND count_id=p_count;
 IF active.owns_graph_context THEN DELETE FROM fin62_history_preparation.graph_context WHERE pid=active.pid AND xid=active.xid AND branch_id=active.branch_id AND shift_id=active.shift_id;IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_WEB_GRAPH_CONTEXT_MISSING';END IF;END IF;
 DELETE FROM fin62_web_preparation.active_actions WHERE pid=active.pid AND xid=active.xid;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fin62_web_preparation FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE routine oid;before_row pg_proc%ROWTYPE;after_row pg_proc%ROWTYPE;definition text;
BEGIN
 SELECT oid INTO STRICT routine FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='pos_admin_correct_closed_shift';
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=routine;
 IF md5(replace(pg_get_functiondef(routine),E'\r\n',E'\n'))<>'6322741fecb9b086e93f413bf78e3f62' THEN RAISE EXCEPTION 'FIN62_WEB_SOURCE_CHANGED';END IF;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.pos_admin_correct_closed_shift(p_shift uuid, p_cash numeric, p_card numeric, p_digital numeric, p_reason text, p_actor_id text, p_actor_name text, p_terminal text, p_client_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public'', ''pg_temp''
AS $function$
DECLARE
  v public.shifts%ROWTYPE; e record; v_count uuid; v_rec uuid;
  v_existing_cash numeric; v_existing_card numeric; v_existing_digital numeric;
  v_reason text := btrim(coalesce(p_reason, ''''));
  v_before jsonb; v_after jsonb;
  v_var_cash numeric; v_var_card numeric; v_var_digital numeric; v_total numeric; v_status text;
BEGIN
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION ''A correction reason of at least 3 characters is required.'';
  END IF;
  IF nullif(btrim(coalesce(p_client_key, '''')), '''') IS NULL THEN
    RAISE EXCEPTION ''A client correction key is required.'';
  END IF;
  IF p_cash IS NULL OR p_cash < 0 OR (p_card IS NOT NULL AND p_card < 0)
     OR (p_digital IS NOT NULL AND p_digital < 0) THEN
    RAISE EXCEPTION ''Counted tender amounts cannot be negative.'';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_key, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(''pos-sync-shift:''||p_shift::text,0));
  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''That shift no longer exists.''; END IF;

  SELECT shift_id, counted_cash, counted_card, counted_digital
    INTO v_count, v_existing_cash, v_existing_card, v_existing_digital
    FROM public.shift_cash_counts
   WHERE client_key = p_client_key LIMIT 1;
  IF FOUND THEN
    IF v_count <> p_shift THEN
      RAISE EXCEPTION ''That correction key was already used for another shift.'';
    END IF;
    IF v_existing_cash IS DISTINCT FROM p_cash
       OR v_existing_card IS DISTINCT FROM p_card
       OR v_existing_digital IS DISTINCT FROM p_digital THEN
      RAISE EXCEPTION ''That correction key was already used with different counted amounts.'';
    END IF;
    RETURN jsonb_build_object(''ok'', true, ''replayed'', true, ''shift_id'', v_count);
  END IF;

  IF v.status IS DISTINCT FROM ''CLOSED'' OR coalesce(v.state, ''CLOSED'') <> ''CLOSED'' THEN
    RAISE EXCEPTION ''Only a closed shift can be corrected.'';
  END IF;
  -- Preserve existing raw API rounding; capture validates the actual saved count.
  v_before := jsonb_build_object(
    ''counted_cash'', v.counted_cash, ''counted_card'', v.counted_card,
    ''counted_digital'', v.counted_digital, ''expected_cash'', v.expected_cash,
    ''expected_card'', v.expected_card, ''expected_digital'', v.expected_digital,
    ''variance_cash'', v.variance_cash, ''variance_card'', v.variance_card,
    ''variance_digital'', v.variance_digital, ''variance_total'', v.variance_total,
    ''variance_status'', v.variance_status
  );

  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, client_key)
  VALUES
    (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), ''RECOUNT'', p_cash, p_card,
     p_digital, v_reason, nullif(p_actor_name, ''''), nullif(p_actor_id, ''''), p_client_key)
  RETURNING id INTO v_count;
  PERFORM fin62_web_preparation.capture_expected(p_shift,v_count,''ADMIN_CORRECTION'');
  SELECT * INTO e FROM fin62_web_preparation.action_expected(p_shift,v_count);
  v_var_cash := round(p_cash - e.expected_cash, 2);
  v_var_card := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total := round(v_var_cash + coalesce(v_var_card, 0) + coalesce(v_var_digital, 0), 2);
  v_status := CASE WHEN abs(v_total) <= 0.005 THEN ''NO_VARIANCE''
                   WHEN v_total > 0 THEN ''OVER'' ELSE ''SHORT'' END;

  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital, variance_cash, variance_card,
     variance_digital, variance_total, variance_status)
  VALUES
    (p_shift, v.store_id, v_count, e.expected_cash, e.expected_card, e.expected_digital,
     p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  PERFORM set_config(''pos.shift_fn'', ''on'', true);
  UPDATE public.shifts SET
    counted_cash = p_cash, final_counted_cash = p_cash, closing_float = p_cash,
    counted_card = p_card, counted_digital = p_digital,
    expected_cash = e.expected_cash, expected_card = e.expected_card,
    expected_digital = e.expected_digital, variance_cash = v_var_cash,
    variance_card = v_var_card, variance_digital = v_var_digital,
    variance_total = v_total, variance_status = v_status,
    row_version = coalesce(row_version, 0) + 1, updated_at = now()
  WHERE id = p_shift;
  PERFORM set_config(''pos.shift_fn'', '''', true);

  v_after := jsonb_build_object(
    ''counted_cash'', p_cash, ''counted_card'', p_card, ''counted_digital'', p_digital,
    ''expected_cash'', e.expected_cash, ''expected_card'', e.expected_card,
    ''expected_digital'', e.expected_digital, ''variance_cash'', v_var_cash,
    ''variance_card'', v_var_card, ''variance_digital'', v_var_digital,
    ''variance_total'', v_total, ''variance_status'', v_status
  );
  INSERT INTO public.record_edits
    (record_type, record_id, reference, store_id, terminal_id, action_key, edited_by,
     edited_by_name, authorized_by, authorized_by_name, mode_used, before_value,
     after_value, note)
  VALUES
    (''shift'', p_shift::text, p_shift::text, v.store_id, coalesce(p_terminal, v.terminal_id),
     ''SHIFT_CLOSE_CORRECTED'', nullif(p_actor_id, ''''), nullif(p_actor_name, ''''),
     nullif(p_actor_id, ''''), nullif(p_actor_name, ''''), ''admin'', v_before, v_after, v_reason);
  INSERT INTO public.activity_events
    (event_type, severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,
     entity_type, entity_id, amount, meta, client_event_id)
  VALUES
    (''shift_close_corrected'', ''warning'', ''Closed shift corrected'', v_reason, nullif(p_actor_id, ''''),
     nullif(p_actor_name, ''''), ''admin'', coalesce(p_terminal, v.terminal_id), v.store_id,
     ''shift'', p_shift::text, v_total,
     jsonb_build_object(''before'', v_before, ''after'', v_after, ''reconciliation_id'', v_rec),
     ''shift-correction:'' || p_client_key)
  ON CONFLICT DO NOTHING;
  PERFORM fin62_web_preparation.end_action(p_shift,v_count);
  RETURN jsonb_build_object(''ok'', true, ''replayed'', false, ''shift_id'', p_shift,
                            ''variance_total'', v_total, ''variance_status'', v_status);
END $function$
';
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=routine;
 IF after_row.proowner IS DISTINCT FROM before_row.proowner OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proargtypes IS DISTINCT FROM before_row.proargtypes OR after_row.proargdefaults::text IS DISTINCT FROM before_row.proargdefaults::text OR after_row.prorettype IS DISTINCT FROM before_row.prorettype THEN RAISE EXCEPTION 'FIN62_WEB_AUTHORITY_CHANGED';END IF;
 SELECT oid INTO STRICT routine FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='shift_cash_count_submit';
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=routine;
 IF md5(replace(pg_get_functiondef(routine),E'\r\n',E'\n'))<>'7da4fe386d35979d7b7cbc89f00a0dc6' THEN RAISE EXCEPTION 'FIN62_WEB_SOURCE_CHANGED';END IF;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.shift_cash_count_submit(p_shift uuid, p_cash numeric, p_card numeric DEFAULT NULL::numeric, p_digital numeric DEFAULT NULL::numeric, p_client_key text DEFAULT NULL::text, p_terminal text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public'', ''pg_temp''
AS $function$
DECLARE v public.shifts%ROWTYPE; v_me record; v_count uuid; v_res record;
BEGIN
  IF NOT (public.has_perm(''can_shift_cash_count'') OR public.has_perm(''can_close_shift'')) THEN
    RAISE EXCEPTION ''You do not have permission to submit a cash count.'';
  END IF;
  IF p_cash IS NULL OR p_cash < 0 THEN RAISE EXCEPTION ''Enter the cash counted in the drawer.''; END IF;
  IF p_card IS NOT NULL AND p_card < 0 THEN RAISE EXCEPTION ''The card total counted cannot be negative.''; END IF;
  IF p_digital IS NOT NULL AND p_digital < 0 THEN RAISE EXCEPTION ''The digital total counted cannot be negative.''; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(''pos-sync-shift:''||p_shift::text,0));
  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''That shift no longer exists.''; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION ''That shift belongs to another branch.''; END IF;
  IF v.state = ''ACTIVE'' THEN RAISE EXCEPTION ''Start the closing process before counting the drawer.''; END IF;
  IF v.state NOT IN (''CLOSING_STARTED'',''CASH_COUNT_REQUIRED'') THEN
    RETURN v.state;  -- already counted: never accept a second original count
  END IF;

  -- Preserve existing raw API rounding; capture validates the actual saved count.
  SELECT * INTO v_me FROM public.current_app_user();
  PERFORM set_config(''pos.shift_fn'', ''on'', true);
  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, counted_by_user_id, client_key)
  VALUES (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), ''ORIGINAL'',
          round(p_cash, 2), round(p_card, 2), round(p_digital, 2), v.close_reason,
          coalesce(v_me.full_name, v.opened_by_name), v_me.user_id, auth.uid(), p_client_key)
  ON CONFLICT (shift_id) WHERE kind = ''ORIGINAL'' DO NOTHING
  RETURNING id INTO v_count;

  IF v_count IS NULL THEN RAISE EXCEPTION ''FIN62_WEB_EXISTING_ORIGINAL_REQUIRES_REVIEW''; END IF;
  PERFORM fin62_web_preparation.capture_expected(p_shift,v_count,''ORIGINAL'');

  UPDATE public.shifts SET state = ''CASH_COUNT_SUBMITTED'', updated_at = now() WHERE id = p_shift;
  PERFORM set_config(''pos.shift_fn'', '''', true);

  IF v_count IS NULL THEN
    SELECT id INTO v_count FROM public.shift_cash_counts
      WHERE shift_id = p_shift AND kind = ''ORIGINAL'' LIMIT 1;
  END IF;

  PERFORM public.shift_log_event(p_shift, ''cash_count_submitted'', ''CASH_COUNT_REQUIRED'',
    ''CASH_COUNT_SUBMITTED'', jsonb_build_object(''count_id'', v_count), p_terminal);

  SELECT * INTO v_res FROM public.shift_reconcile_now(p_shift, v_count, round(p_cash,2), round(p_card,2), round(p_digital,2));
  PERFORM fin62_web_preparation.end_action(p_shift,v_count);
  RETURN v_res.state;  -- state only: never the variance
END $function$
';
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=routine;
 IF after_row.proowner IS DISTINCT FROM before_row.proowner OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proargtypes IS DISTINCT FROM before_row.proargtypes OR after_row.proargdefaults::text IS DISTINCT FROM before_row.proargdefaults::text OR after_row.prorettype IS DISTINCT FROM before_row.prorettype THEN RAISE EXCEPTION 'FIN62_WEB_AUTHORITY_CHANGED';END IF;
 SELECT oid INTO STRICT routine FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='shift_reconcile_now';
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=routine;
 IF md5(replace(pg_get_functiondef(routine),E'\r\n',E'\n')) NOT IN('04a2bce3bfad4277dcc9aa2751f6ddbd','920af85fa748db61b9d9c723c16eb495') THEN RAISE EXCEPTION 'FIN62_WEB_SOURCE_CHANGED';END IF;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.shift_reconcile_now(p_shift uuid, p_count_id uuid, p_cash numeric, p_card numeric, p_digital numeric)
 RETURNS TABLE(state text, variance_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public'', ''pg_temp''
AS $function$
DECLARE
  v public.shifts%ROWTYPE; e record; v_rec uuid;
  v_var_cash numeric; v_var_card numeric; v_var_digital numeric; v_total numeric;
  v_status text; v_threshold numeric := 0; v_state text;
  v_store_name text; v_cashier text; v_terminal text; v_msg text;
  v_total_sales numeric := 0; v_net_cash_sales numeric := 0;
BEGIN
  SELECT * INTO v FROM public.shifts WHERE id = p_shift;
  SELECT * INTO e FROM fin62_web_preparation.action_expected(p_shift,p_count_id);

  v_var_cash    := round(p_cash - e.expected_cash, 2);
  v_var_card    := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total       := round(v_var_cash + coalesce(v_var_card,0) + coalesce(v_var_digital,0), 2);

  SELECT coalesce(abs((r ->> ''variance_pin_threshold'')::numeric), 0) INTO v_threshold
    FROM public.pos_rules_get() AS r;
  IF v_threshold IS NULL THEN v_threshold := 0; END IF;

  v_status := CASE WHEN abs(v_total) <= 0.005 THEN ''NO_VARIANCE''
                   WHEN v_total > 0 THEN ''OVER'' ELSE ''SHORT'' END;

  -- The counted amount is final. A difference is recorded and reported, never
  -- a reason to keep the shift open.
  v_state := ''CLOSED'';

  PERFORM set_config(''pos.shift_fn'', ''on'', true);
  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital,
     variance_cash, variance_card, variance_digital, variance_total, variance_status)
  VALUES (p_shift, v.store_id, p_count_id, e.expected_cash, e.expected_card, e.expected_digital,
          p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  UPDATE public.shifts
     SET state = v_state,
         status = ''CLOSED'',
         closed_at = coalesce(closed_at, now()),
         final_counted_cash = p_cash,
         counted_cash = p_cash,
         closing_float = p_cash,
         counted_card = p_card,
         counted_digital = p_digital,
         expected_cash = e.expected_cash,
         expected_card = e.expected_card,
         expected_digital = e.expected_digital,
         variance_cash = v_var_cash,
         variance_card = v_var_card,
         variance_digital = v_var_digital,
         variance_total = v_total,
         variance_status = v_status,
         updated_at = now()
   WHERE id = p_shift;

  IF v_status <> ''NO_VARIANCE'' THEN
    SELECT coalesce(nullif(btrim(name), ''''), v.store_id) INTO v_store_name
      FROM public.stores WHERE id = v.store_id;
    v_store_name := coalesce(v_store_name, v.store_id, '''');
    SELECT coalesce(nullif(btrim(counted_by_name), ''''), v.opened_by_name, '''')
      INTO v_cashier
      FROM public.shift_cash_counts WHERE id = p_count_id;
    v_cashier := coalesce(v_cashier, v.opened_by_name, '''');
    v_terminal := coalesce(nullif(btrim(v.terminal_name), ''''), v.terminal_id, '''');
    SELECT coalesce(sum(s.total_amount), 0) INTO v_total_sales
      FROM public.sales s
     WHERE s.shift_id = p_shift::text AND coalesce(s.is_refunded, false) = false;
    v_net_cash_sales := round(e.expected_cash - coalesce(v.opening_float, 0), 2);

    INSERT INTO public.shift_variance_alerts
      (shift_id, store_id, reconciliation_id, variance_total, variance_status, severity, message)
    VALUES (p_shift, v.store_id, v_rec, v_total, v_status,
            CASE WHEN abs(v_total) > v_threshold THEN ''critical'' ELSE ''warning'' END,
            format(''Shift at %s closed %s by %s. Cashier %s, terminal %s. Opening %s, sales %s, net cash sales %s, expected cash %s, counted cash %s.'',
                   v_store_name, lower(v_status), abs(v_total), v_cashier, v_terminal,
                   to_char(coalesce(v.opening_float, 0), ''FM999999990.00''),
                   to_char(v_total_sales, ''FM999999990.00''),
                   to_char(v_net_cash_sales, ''FM999999990.00''),
                   to_char(e.expected_cash, ''FM999999990.00''), to_char(p_cash, ''FM999999990.00'')))
    ON CONFLICT (reconciliation_id) DO NOTHING;

    v_msg := format(
      E''Cashier: %s\nBranch: %s\nTerminal: %s\nShift: %s\nClosed: %s\n\nOpening float: %s\nTotal sales: %s\nNet cash sales: %s\nExpected cash: %s\nCounted cash: %s\nCard expected / counted: %s / %s\nDigital expected / counted: %s / %s\nVariance: %s\n\nType: Cash %s'',
      v_cashier, v_store_name, v_terminal,
      p_shift::text, to_char(now(), ''YYYY-MM-DD HH24:MI:SS TZ''),
      to_char(coalesce(v.opening_float, 0), ''FM999999990.00''),
      to_char(v_total_sales, ''FM999999990.00''),
      to_char(v_net_cash_sales, ''FM999999990.00''),
      to_char(e.expected_cash, ''FM999999990.00''),
      to_char(p_cash, ''FM999999990.00''),
      to_char(e.expected_card, ''FM999999990.00''), coalesce(to_char(p_card, ''FM999999990.00''), ''not counted''),
      to_char(e.expected_digital, ''FM999999990.00''), coalesce(to_char(p_digital, ''FM999999990.00''), ''not counted''),
      CASE WHEN v_total > 0 THEN ''+'' ELSE ''-'' END || to_char(abs(v_total), ''FM999999990.00''),
      CASE WHEN v_total > 0 THEN ''Overage'' ELSE ''Shortage'' END);

    -- The shared notification feed: one row per shift, so a replay of the
    -- close after an outage can never raise a second alert.
    INSERT INTO public.activity_events
      (event_type, severity, title, message, actor_name, terminal_id, store_id,
       branch_id, entity_type, entity_id, amount, meta, client_event_id, created_at)
    VALUES (''shift_cash_variance'',
            CASE WHEN abs(v_total) > v_threshold THEN ''critical'' ELSE ''warning'' END,
            ''Shift cash variance detected'', v_msg, nullif(v_cashier, ''''),
            nullif(v_terminal, ''''), v.store_id, v.store_id, ''shift'', p_shift::text, v_total,
            jsonb_build_object(''branch_name'', v_store_name, ''terminal_name'', v_terminal,
                               ''opened_at'', v.opened_at, ''closed_at'', now(),
                               ''opening_float'', coalesce(v.opening_float, 0),
                               ''total_sales'', v_total_sales, ''net_cash_sales'', v_net_cash_sales,
                               ''expected_cash'', e.expected_cash, ''counted_cash'', p_cash,
                               ''expected_card'', e.expected_card, ''counted_card'', p_card,
                               ''expected_digital'', e.expected_digital, ''counted_digital'', p_digital,
                               ''variance_total'', v_total, ''variance_status'', v_status,
                               ''reconciliation_id'', v_rec),
            ''shift:'' || p_shift::text || '':cash_variance'', now())
    ON CONFLICT (client_event_id) DO NOTHING;
  END IF;
  PERFORM set_config(''pos.shift_fn'', '''', true);

  PERFORM public.shift_log_event(p_shift, ''reconciled'', ''CASH_COUNT_SUBMITTED'', v_state,
    jsonb_build_object(''variance_status'', v_status, ''variance_total'', v_total), v.terminal_id);


  RETURN QUERY SELECT v_state, v_status;
END $function$
';
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=routine;
 IF after_row.proowner IS DISTINCT FROM before_row.proowner OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proargtypes IS DISTINCT FROM before_row.proargtypes OR after_row.proargdefaults::text IS DISTINCT FROM before_row.proargdefaults::text OR after_row.prorettype IS DISTINCT FROM before_row.prorettype THEN RAISE EXCEPTION 'FIN62_WEB_AUTHORITY_CHANGED';END IF;
 SELECT oid INTO STRICT routine FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='shift_recount_submit';
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=routine;
 IF md5(replace(pg_get_functiondef(routine),E'\r\n',E'\n'))<>'fa77acc46f885c1734e18d883d4f7f89' THEN RAISE EXCEPTION 'FIN62_WEB_SOURCE_CHANGED';END IF;
 EXECUTE 'CREATE OR REPLACE FUNCTION public.shift_recount_submit(p_shift uuid, p_cash numeric, p_reason text, p_card numeric DEFAULT NULL::numeric, p_digital numeric DEFAULT NULL::numeric, p_terminal text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public'', ''pg_temp''
AS $function$
DECLARE v public.shifts%ROWTYPE; v_me record; v_count uuid; v_res record; v_reason text := btrim(coalesce(p_reason,''''));
BEGIN
  IF NOT public.has_perm(''can_shift_cash_recount'') THEN
    RAISE EXCEPTION ''You do not have permission to recount a drawer.'';
  END IF;
  IF v_reason = '''' THEN RAISE EXCEPTION ''A reason for the recount is required.''; END IF;
  IF p_cash IS NULL OR p_cash < 0 THEN RAISE EXCEPTION ''Enter the recounted cash amount.''; END IF;
  IF p_card IS NOT NULL AND p_card < 0 THEN RAISE EXCEPTION ''The card total counted cannot be negative.''; END IF;
  IF p_digital IS NOT NULL AND p_digital < 0 THEN RAISE EXCEPTION ''The digital total counted cannot be negative.''; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(''pos-sync-shift:''||p_shift::text,0));
  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''That shift no longer exists.''; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION ''That shift belongs to another branch.''; END IF;
  IF v.state NOT IN (''VARIANCE_REVIEW_REQUIRED'',''RECONCILIATION'',''CLOSED'') THEN
    RAISE EXCEPTION ''This shift has not been counted yet.'';
  END IF;

  -- Preserve existing raw API rounding; capture validates the actual saved count.
  SELECT * INTO v_me FROM public.current_app_user();
  PERFORM set_config(''pos.shift_fn'', ''on'', true);
  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, counted_by_user_id)
  VALUES (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), ''RECOUNT'',
          round(p_cash,2), round(p_card,2), round(p_digital,2), v_reason,
          v_me.full_name, v_me.user_id, auth.uid())
  RETURNING id INTO v_count;
  PERFORM fin62_web_preparation.capture_expected(p_shift,v_count,''RECOUNT'');
  PERFORM set_config(''pos.shift_fn'', '''', true);

  PERFORM public.shift_log_event(p_shift, ''recount_submitted'', v.state, v.state,
    jsonb_build_object(''reason'', v_reason, ''count_id'', v_count), p_terminal);

  SELECT * INTO v_res FROM public.shift_reconcile_now(p_shift, v_count, round(p_cash,2), round(p_card,2), round(p_digital,2));
  PERFORM fin62_web_preparation.end_action(p_shift,v_count);
  RETURN v_res.state;
END $function$
';
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=routine;
 IF after_row.proowner IS DISTINCT FROM before_row.proowner OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proargtypes IS DISTINCT FROM before_row.proargtypes OR after_row.proargdefaults::text IS DISTINCT FROM before_row.proargdefaults::text OR after_row.prorettype IS DISTINCT FROM before_row.prorettype THEN RAISE EXCEPTION 'FIN62_WEB_AUTHORITY_CHANGED';END IF;
END $patch$;
CREATE FUNCTION fin62_web_preparation.begin_graph(p_shift uuid,p_branch text) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF to_regclass('fin62_history_preparation.protected_shifts') IS NULL THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts WHERE shift_id=p_shift AND branch_id=p_branch) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM fin62_history_preparation.graph_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id()) THEN RAISE EXCEPTION 'FIN62_WEB_GRAPH_CONTEXT_BUSY';END IF;
 INSERT INTO fin62_history_preparation.graph_context VALUES(pg_backend_pid(),pg_current_xact_id(),p_branch,p_shift);RETURN true;
END $$;
CREATE FUNCTION fin62_web_preparation.end_graph(p_shift uuid,p_branch text,p_owned boolean) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF p_owned THEN DELETE FROM fin62_history_preparation.graph_context WHERE pid=pg_backend_pid() AND xid=pg_current_xact_id() AND branch_id=p_branch AND shift_id=p_shift;IF NOT FOUND THEN RAISE EXCEPTION 'FIN62_WEB_GRAPH_CONTEXT_MISSING';END IF;END IF;
END $$;
REVOKE ALL ON FUNCTION fin62_web_preparation.begin_graph(uuid,text),fin62_web_preparation.end_graph(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $aliases$
DECLARE name text;routine oid;before_row pg_proc%ROWTYPE;after_row pg_proc%ROWTYPE;source text;
BEGIN
 FOREACH name IN ARRAY ARRAY['shift_close_start','shift_variance_approve'] LOOP
  SELECT oid INTO STRICT routine FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=name;
  SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=routine;
  source:=replace(pg_get_functiondef(routine),E'\r\n',E'\n');
  source:=replace(source,'SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;','PERFORM pg_advisory_xact_lock(hashtextextended(''pos-sync-shift:''||p_shift::text,0)); SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;');
  source:=replace(source,'DECLARE v public.shifts%ROWTYPE;','DECLARE v_fin62_graph boolean := false; v public.shifts%ROWTYPE;');
  IF name='shift_variance_approve' THEN
   source:=replace(source,'IF v.state = ''CLOSED'' THEN RETURN ''CLOSED''; END IF;','IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION ''That shift belongs to another branch.'';END IF; IF v.state = ''CLOSED'' THEN RETURN ''CLOSED''; END IF;');
  END IF;
  source:=replace(source,'PERFORM set_config(''pos.shift_fn'', ''on'', true);','v_fin62_graph := fin62_web_preparation.begin_graph(p_shift,v.store_id); PERFORM set_config(''pos.shift_fn'', ''on'', true);');
  IF name='shift_close_start' THEN source:=replace(source,'RETURN ''CASH_COUNT_REQUIRED'';','PERFORM fin62_web_preparation.end_graph(p_shift,v.store_id,v_fin62_graph); RETURN ''CASH_COUNT_REQUIRED'';');
  ELSE source:=replace(source,'RETURN ''CLOSED'';'||E'\nEND','PERFORM fin62_web_preparation.end_graph(p_shift,v.store_id,v_fin62_graph); RETURN ''CLOSED'';'||E'\nEND');END IF;
  IF source=pg_get_functiondef(routine) OR strpos(source,'v_fin62_graph := fin62_web_preparation.begin_graph')=0 OR strpos(source,'PERFORM fin62_web_preparation.end_graph')=0 THEN RAISE EXCEPTION 'FIN62_WEB_ALIAS_PATCH_UNEXPECTED';END IF;
  EXECUTE source;SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=routine;
  IF after_row.proowner IS DISTINCT FROM before_row.proowner OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proargtypes IS DISTINCT FROM before_row.proargtypes OR after_row.proargdefaults::text IS DISTINCT FROM before_row.proargdefaults::text OR after_row.prorettype IS DISTINCT FROM before_row.prorettype THEN RAISE EXCEPTION 'FIN62_WEB_AUTHORITY_CHANGED';END IF;
 END LOOP;
END $aliases$;
COMMIT;
