-- Isolated preparation for the installed drawer audit. Publishing the saved
-- request and result never invokes or authorizes a physical drawer pulse.
BEGIN;

CREATE FUNCTION pos_sync_feed_v1.drawer_audit_stage(p_note text)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN CASE WHEN p_note='OPEN_REQUESTED' THEN 1 WHEN p_note='OPENED' OR p_note LIKE 'FAILED: %' THEN 2 END;

CREATE FUNCTION pos_sync_feed_v1.publish_drawer_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $publish$
DECLARE
  v_stage integer := pos_sync_feed_v1.drawer_audit_stage(NEW.note);
  v_epoch uuid;
  v_operation uuid;
  v_changes jsonb;
  v_metadata jsonb;
  v_prior pos_sync_feed_v1.extended_publications%ROWTYPE;
BEGIN
  IF v_stage IS NULL OR NEW.store_id IS NULL OR NEW.terminal_id IS NULL OR
     NEW.terminal_id !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  v_epoch:=pos_sync_feed_v1.extended_scope_epoch('default',NEW.store_id);
  IF v_epoch IS NULL THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
    IF pos_sync_feed_v1.drawer_audit_stage(OLD.note) IS DISTINCT FROM 1 OR v_stage<>2 OR
      (to_jsonb(NEW)-'note') IS DISTINCT FROM (to_jsonb(OLD)-'note') THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_DRAWER_AUDIT_TRANSITION_UNVERIFIED';
    END IF;
  END IF;
  IF NEW.created_at IS NULL OR length(NEW.store_id)>128 OR length(NEW.reason) NOT BETWEEN 3 AND 400
     OR length(NEW.note)>308 OR (NEW.shift_id IS NOT NULL AND NEW.shift_id !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
     OR greatest(length(NEW.staff_id),length(NEW.staff_name),length(NEW.role),length(NEW.approved_by))>1024 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_DRAWER_AUDIT_UNVERIFIED';
  END IF;
  v_operation:=left(encode(sha256(convert_to(jsonb_build_array(
    'drawer-audit-v1',NEW.store_id,v_epoch,NEW.id,v_stage)::text,'UTF8')),'hex'),32)::uuid;
  v_changes:=jsonb_build_array(pos_sync_feed_v1.financial_change('drawer_events',jsonb_build_object('id',NEW.id),
    jsonb_build_object('id',NEW.id,'store_id',NEW.store_id,'terminal_id',NEW.terminal_id,'shift_id',NEW.shift_id,
      'staff_id',NEW.staff_id,'staff_name',NEW.staff_name,'role',NEW.role,'reason',NEW.reason,'note',NEW.note,
      'approved_by',NEW.approved_by,'created_at',NEW.created_at),v_stage));
  v_metadata:=jsonb_build_object('financial',jsonb_build_object('kind','drawer_v1','event_id',NEW.id));
  SELECT * INTO v_prior FROM pos_sync_feed_v1.extended_publications
  WHERE organization_id='default' AND operation_id=v_operation;
  IF FOUND THEN
    IF (v_prior.scope_id,v_prior.epoch,v_prior.changes,v_prior.metadata) IS DISTINCT FROM
      (NEW.store_id,v_epoch,v_changes,v_metadata) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='POS_DRAWER_AUDIT_IDENTITY_CONFLICT';
    END IF;
    RETURN NULL;
  END IF;
  PERFORM pos_sync_feed_v1.append_extended_group('default',NEW.store_id,v_epoch,v_operation,v_changes,v_metadata);
  RETURN NULL;
END;
$publish$;

REVOKE ALL ON FUNCTION pos_sync_feed_v1.drawer_audit_stage(text),
  pos_sync_feed_v1.publish_drawer_audit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_sync_publish_drawer_audit AFTER INSERT OR UPDATE ON public.drawer_events
FOR EACH ROW EXECUTE FUNCTION pos_sync_feed_v1.publish_drawer_audit();

COMMIT;
