// Fresh-schema assembly only. The exact live migration keeps its own preflight.
function historyIndexCanonicalBlock(migration) {
  const take = name => {
    const marker = `$${name}$`, parts = migration.replaceAll("\r\n", "\n").split(marker);
    if (parts.length !== 3) throw new Error("The reviewed history definition boundary changed.");
    return parts[1];
  };
  const index = take("index_definition"), rows = take("rows_definition"), shape = take("shape");
  const definitions = [[index, "pos_sync_history_index_v1"], [rows, "pos_sync_history_rows_v1"]];
  if (definitions.some(([text, name]) => !text.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`)))
    throw new Error("The reviewed history function names changed.");
  const runtime = index.match(/ IF NOT EXISTS\(SELECT 1 FROM pg_proc[\s\S]*?THEN RAISE EXCEPTION 'HISTORY_INDEX_UNSUPPORTED_SOURCE'; END IF;/)?.[0];
  if (!runtime) throw new Error("The reviewed history runtime guard changed.");
  return `-- AUTOMATIC_HISTORY_RECONCILE_BEGIN
-- Fresh canonical installation: no legacy audit rows are rewritten or seeded.
DO $history_index_canonical$
DECLARE
 expected_shape constant jsonb := $history_shape$${shape}$history_shape$;
 index_ddl constant text := $canonical_index$${index}$canonical_index$;
 rows_ddl constant text := $canonical_rows$${rows}$canonical_rows$;
 actual jsonb; signature text; ddl text; tag text; oid_value oid; installed integer:=0;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'HISTORY_INDEX_MIGRATION_OWNER'; END IF;
 PERFORM set_config('search_path','pg_catalog,public',true);
 LOCK TABLE public.change_history IN SHARE ROW EXCLUSIVE MODE NOWAIT;
${runtime}
 SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
  INTO actual FROM pg_attribute a WHERE a.attrelid='public.change_history'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM expected_shape OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O')
  THEN RAISE EXCEPTION 'HISTORY_INDEX_CANONICAL_SHAPE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal
  AND tgname NOT IN ('change_history_no_change','sync_feed_change'))
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='sync_feed_change'
   AND (tgfoid IS DISTINCT FROM to_regprocedure('public.sync_feed_change_history()')::oid OR tgenabled<>'O'
    OR pg_get_triggerdef(oid)<>'CREATE TRIGGER sync_feed_change AFTER INSERT OR DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION sync_feed_change_history()'
    OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=tgfoid
     AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='f9317de3f340884d1320a156560acf8c'
     AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND NOT p.proisstrict AND p.provolatile='v'
     AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND p.prorettype='trigger'::regtype
     AND p.prokind='f' AND p.proparallel='u' AND NOT p.proleakproof AND NOT p.proretset AND p.prosupport=0
     AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.procost=100 AND p.prorows=0
     AND pg_get_function_arguments(p.oid)=''
     AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v) IN
      (jsonb_build_array('postgres=X/postgres'),jsonb_build_array('postgres=X/postgres','service_role=X/postgres')))))
  THEN RAISE EXCEPTION 'HISTORY_INDEX_CANONICAL_TRIGGER'; END IF;
 FOR signature,ddl,tag IN VALUES
  ('public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean)',index_ddl,'$history_index$'),
  ('public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer)',rows_ddl,'$history_rows$')
 LOOP
  oid_value:=to_regprocedure(signature);
  IF oid_value IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=oid_value AND replace(p.prosrc,chr(13)||chr(10),chr(10))=split_part(replace(ddl,chr(13)||chr(10),chr(10)),tag,2)
    AND pg_get_userbyid(p.proowner)='postgres' AND NOT p.prosecdef AND NOT p.proisstrict
    AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, public']
    AND p.prorettype='jsonb'::regtype
    AND p.prokind='f' AND p.proparallel='u' AND NOT p.proleakproof AND NOT p.proretset AND p.prosupport=0
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.procost=100 AND p.prorows=0
    AND pg_get_function_arguments(p.oid)=CASE signature WHEN 'public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean)' THEN 'p_organization_id text, p_branch_id text, p_terminal_id text, p_action text, p_after_id uuid DEFAULT NULL::uuid, p_upper_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_keep_commerce boolean DEFAULT false'
      ELSE 'p_organization_id text, p_branch_id text, p_terminal_id text, p_ids jsonb, p_keep_commerce boolean DEFAULT false, p_max_bytes integer DEFAULT 2097152' END
    AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))
    THEN RAISE EXCEPTION 'HISTORY_INDEX_CANONICAL_EXISTING_CHANGED'; END IF;
   installed:=installed+1;
  END IF;
 END LOOP;
 IF installed NOT IN (0,2) THEN RAISE EXCEPTION 'HISTORY_INDEX_PARTIAL_INSTALL'; END IF;
 EXECUTE replace(index_ddl,chr(13)||chr(10),chr(10));
 EXECUTE replace(rows_ddl,chr(13)||chr(10),chr(10));
 REVOKE ALL ON FUNCTION public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.pos_sync_history_index_v1(text,text,text,text,uuid,uuid,integer,boolean) TO service_role;
 GRANT EXECUTE ON FUNCTION public.pos_sync_history_rows_v1(text,text,text,jsonb,boolean,integer) TO service_role;
 -- Fresh-schema safety: do not activate lossy full-history feed delivery to
 -- older binaries. Retire only the known generated trigger; reads use the
 -- exact ID reconciliation protocol. Live migration does not change triggers.
 DROP TRIGGER IF EXISTS sync_feed_change ON public.change_history;
END;
$history_index_canonical$;
-- AUTOMATIC_HISTORY_RECONCILE_END`;
}
function withHistoryIndexContract(schema, migration) {
  const begin = "-- AUTOMATIC_HISTORY_RECONCILE_BEGIN", end = "-- AUTOMATIC_HISTORY_RECONCILE_END";
  if (schema.includes(begin)) {
    if (schema.split(begin).length !== 2 || schema.split(end).length !== 2 || schema.indexOf(end) < schema.indexOf(begin))
      throw new Error("The canonical history contract boundary changed.");
    // Legacy contracts are relocated before this block is replaced. Collapse
    // only the separators left at its removal boundary so repeated generation
    // cannot accumulate their blank lines ahead of the relocated contracts.
    schema = schema.slice(0, schema.indexOf(begin)).trimEnd() + "\n\n"
      + schema.slice(schema.indexOf(end) + end.length).trimStart();
  } else if (schema.includes(end)) throw new Error("The canonical history contract boundary changed.");
  const block=historyIndexCanonicalBlock(migration),hardening=schema.lastIndexOf('-- Final public-schema privilege hardening');
  // Keep the existing final privilege closure after every function definition.
  if(hardening>=0)return schema.slice(0,hardening).trimEnd()+"\n\n"+block+"\n\n"+schema.slice(hardening).trimStart().trimEnd()+"\n";
  return schema.trimEnd() + "\n\n" + block + "\n";
}
module.exports = { historyIndexCanonicalBlock, withHistoryIndexContract };
