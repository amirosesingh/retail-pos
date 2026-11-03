-- READ-35: reuse the existing Management replica READ admission for graph reads.
-- Source preparation only; write validation and privileges remain unchanged.
BEGIN;
DO $graph_read_scope$
DECLARE
 signature regprocedure := to_regprocedure('public.pos_sync_shift_graph(text,text,text,uuid)');
 definition text; source_body text; attributes jsonb;
 old_call text := 'PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);';
 new_call text := 'PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);';
 reviewed_body text := $reviewed$DECLARE graph jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 graph:=pos_sync_private.shift_graph(p_shift_id);
 PERFORM pos_sync_private.validate_graph(graph,p_branch_id,p_shift_id,false);
 RETURN jsonb_build_object('ok',true,'shiftGraphVersion',1,'branchId',p_branch_id,'shiftId',p_shift_id,
  'graphToken',CASE WHEN graph->0->'rows'->0->>'status'='CLOSED' AND graph->0->'rows'->0->>'state'='CLOSED'
    THEN pos_sync_private.graph_token(graph) ELSE NULL END,'closedAtRaw',graph->0->'rows'->0->'closed_at','tables',graph);
END$reviewed$;
BEGIN
 -- The dollar-quoted reference follows the migration's checkout line endings.
 reviewed_body:=replace(reviewed_body,E'\r\n',E'\n');
 IF signature IS NULL OR
    to_regprocedure('public.pos_sync_validate_scope(text,text,text)') IS NULL OR
    to_regprocedure('public.pos_sync_validate_read_scope(text,text,text)') IS NULL
 THEN RAISE EXCEPTION 'SHIFT_GRAPH_READ_REQUIRES_REVIEWED_PREREQUISITES'; END IF;
 SELECT pg_get_functiondef(p.oid),replace(p.prosrc,E'\r\n',E'\n'),to_jsonb(p)-'prosrc'
 INTO definition,source_body,attributes FROM pg_proc p WHERE p.oid=signature;
 IF attributes->>'prokind' IS DISTINCT FROM 'f' OR attributes->'prosecdef' IS DISTINCT FROM 'true'::jsonb OR
    attributes->'proretset' IS DISTINCT FROM 'false'::jsonb OR
    (attributes->>'prorettype')::oid IS DISTINCT FROM 'jsonb'::regtype::oid
 THEN RAISE EXCEPTION 'SHIFT_GRAPH_READ_UNRECOGNIZED_ROUTINE'; END IF;
 -- Accept only the exact reviewed body or its exact one-call upgraded form.
 -- No partial/mixed/unknown definition is rewritten to make an upgrade pass.
 IF btrim(source_body,E' \t\r\n')=replace(reviewed_body,old_call,new_call) THEN RETURN; END IF;
 IF btrim(source_body,E' \t\r\n') IS DISTINCT FROM reviewed_body OR
    (length(source_body)-length(replace(source_body,old_call,'')))/length(old_call)<>1 OR
    position(new_call IN source_body)>0
 THEN RAISE EXCEPTION 'SHIFT_GRAPH_READ_UNRECOGNIZED_ROUTINE'; END IF;
 EXECUTE replace(definition,old_call,new_call);
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=signature AND
    ((to_jsonb(p)-'prosrc') IS DISTINCT FROM attributes OR
     replace(p.prosrc,E'\r\n',E'\n') IS DISTINCT FROM replace(source_body,old_call,new_call)))
 THEN RAISE EXCEPTION 'SHIFT_GRAPH_READ_AUTHORITY_OR_BODY_CHANGED'; END IF;
END $graph_read_scope$;
NOTIFY pgrst,'reload schema';
COMMIT;
