-- Isolated preparation after the FIN62 guards and extended feed.
-- The original protected writer still owns authorization and financial math.
-- Capture the complete committed closing graph once, after all writer effects.
BEGIN;

CREATE FUNCTION pos_sync_feed_v1.publish_managed_shift_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $publish$
DECLARE
  v_shift uuid;
  v_branch text;
  v_version integer;
  v_epoch uuid;
  v_graph jsonb;
  v_raw text;
  v_digest text;
  v_operation uuid;
  v_changes jsonb;
  v_metadata jsonb;
  v_prior pos_sync_feed_v1.extended_publications%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='shifts' THEN v_shift:=NEW.id;
  ELSE v_shift:=NEW.shift_id; END IF;
  IF v_shift IS NULL THEN RETURN NULL; END IF;
  SELECT sh.store_id,sh.row_version INTO v_branch,v_version FROM public.shifts AS sh
  JOIN fin62_history_preparation.protected_shifts AS managed ON managed.shift_id=sh.id AND managed.branch_id=sh.store_id
  WHERE sh.id=v_shift AND sh.store_id=NEW.store_id AND sh.status='CLOSED' AND sh.state='CLOSED'
    AND sh.closed_at IS NOT NULL FOR NO KEY UPDATE OF sh;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_epoch:=pos_sync_feed_v1.extended_scope_epoch('default',v_branch);
  IF v_epoch IS NULL THEN RETURN NULL; END IF;
  IF v_version IS NULL OR v_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_MANAGED_SHIFT_GROUP_REVISION_UNVERIFIED';
  END IF;

  v_graph:=pos_sync_private.shift_graph(v_shift);
  PERFORM pos_sync_private.validate_graph(v_graph,v_branch,v_shift,true);
  v_raw:=jsonb_build_object('ok',true,'shiftGraphVersion',1,'branchId',v_branch,'shiftId',v_shift,
    'graphToken',pos_sync_private.graph_token(v_graph),'closedAtRaw',v_graph->0->'rows'->0->'closed_at',
    'tables',v_graph)::text;
  IF octet_length(v_raw)>196608 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_MANAGED_SHIFT_GROUP_TOO_LARGE';
  END IF;
  v_digest:=encode(sha256(convert_to(v_raw,'UTF8')),'hex');
  v_operation:=left(encode(sha256(convert_to(jsonb_build_array(
    'managed-shift-v1',v_branch,v_epoch,v_shift,v_digest)::text,'UTF8')),'hex'),32)::uuid;
  v_changes:=jsonb_build_array(jsonb_build_object('table_name','shifts',
    'entity_id',jsonb_build_object('id',v_shift)::text,'row_version',v_version::text,'tombstone',false,
    'row_data',jsonb_build_object('id',v_shift,'store_id',v_branch,'row_version',v_version,
      'graph_json',v_raw,'graph_sha256',v_digest)));
  v_metadata:=jsonb_build_object('financial',jsonb_build_object('kind','shift_v1','shift_id',v_shift));
  SELECT * INTO v_prior FROM pos_sync_feed_v1.extended_publications
  WHERE organization_id='default' AND operation_id=v_operation;
  IF FOUND THEN
    IF (v_prior.scope_id,v_prior.epoch,v_prior.changes,v_prior.metadata) IS DISTINCT FROM
      (v_branch,v_epoch,v_changes,v_metadata) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_MANAGED_SHIFT_GROUP_IDENTITY_CONFLICT';
    END IF;
    RETURN NULL;
  END IF;
  PERFORM pos_sync_feed_v1.append_extended_group('default',v_branch,v_epoch,v_operation,v_changes,v_metadata);
  RETURN NULL;
END;
$publish$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.publish_managed_shift_graph() FROM PUBLIC,anon,authenticated,service_role;
DO $install$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events',
    'shift_notifications','shift_variance_alerts'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER pos_sync_publish_managed_shift AFTER INSERT OR UPDATE ON public.%I
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_managed_shift_graph()',relation);
  END LOOP;
END;
$install$;

COMMIT;
