-- Supply the required audit classification only. Preserve the reviewed
-- administrator correction, calculations, replay keys and function authority.
BEGIN;
DO $closed_shift_activity_type$
DECLARE
 signature oid := to_regprocedure('public.pos_admin_correct_closed_shift(uuid,numeric,numeric,numeric,text,text,text,text,text)');
 definition text; original_owner oid; original_acl aclitem[]; original_config text[];
 old_columns text := E'INSERT INTO public.activity_events\n    (severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,';
 new_columns text := E'INSERT INTO public.activity_events\n    (event_type, severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,';
 old_values text := E'VALUES\n    (\'warning\', \'Closed shift corrected\',';
 new_values text := E'VALUES\n    (\'shift_close_corrected\', \'warning\', \'Closed shift corrected\',';
BEGIN
 IF signature IS NULL THEN RAISE EXCEPTION 'SHIFT_CORRECTION_ACTIVITY_REQUIRES_REVIEWED_ROUTINE'; END IF;
 SELECT replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),p.proowner,p.proacl,p.proconfig
 INTO definition,original_owner,original_acl,original_config FROM pg_proc p WHERE p.oid=signature;
 IF (length(definition)-length(replace(definition,new_columns,'')))/length(new_columns)=1 AND
    (length(definition)-length(replace(definition,new_values,'')))/length(new_values)=1 AND
    position(old_columns IN definition)=0 AND position(old_values IN definition)=0 THEN RETURN; END IF;
 IF (length(definition)-length(replace(definition,old_columns,'')))/length(old_columns)<>1 OR
    (length(definition)-length(replace(definition,old_values,'')))/length(old_values)<>1 OR
    position(new_columns IN definition)>0 OR position(new_values IN definition)>0 THEN
  RAISE EXCEPTION 'SHIFT_CORRECTION_ACTIVITY_UNRECOGNIZED_ROUTINE';
 END IF;
 EXECUTE replace(replace(definition,old_columns,new_columns),old_values,new_values);
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=signature AND
   (p.proowner IS DISTINCT FROM original_owner OR p.proacl IS DISTINCT FROM original_acl OR p.proconfig IS DISTINCT FROM original_config)) THEN
  RAISE EXCEPTION 'SHIFT_CORRECTION_ACTIVITY_AUTHORITY_CHANGED';
 END IF;
END $closed_shift_activity_type$;
NOTIFY pgrst,'reload schema';
COMMIT;
