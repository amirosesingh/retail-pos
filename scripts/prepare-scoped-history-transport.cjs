"use strict";
// Deterministic preparation from reviewed repository definitions. No DB access.
const fs = require("node:fs");
const path = require("node:path");
const { build: reviewedScope, md5 } = require("./prepare-history-scope.cjs");

const MIGRATION = "20261107094311_add_scoped_history_transport.sql";
const NAMES = {
  pos_sync_history_company_scope_v1: "pos_sync_history_company_scope_transport_v1",
  pos_sync_history_row_visible_v1: "pos_sync_history_row_visible_transport_v1",
  pos_sync_history_index_v2: "pos_sync_history_index_v3",
  pos_sync_history_rows_v2: "pos_sync_history_rows_v3",
  pos_sync_history_page_v1: "pos_sync_history_page_v2",
  pos_sync_feed_page_v1: "pos_sync_feed_page_v2",
  pos_sync_counts: "pos_sync_counts_history_v2",
  pos_sync_pull: "pos_sync_pull_history_v2",
};
const nameOf = routine => routine.signature.split("(")[0];
const normalize = text => text.replaceAll("\r\n", "\n");
function replace(text, old, next, count = 1) {
  if (text.split(old).length - 1 !== count) throw new Error("Scoped transport source anchor changed: " + old.slice(0, 90));
  return text.replaceAll(old, next);
}
function rewriteRange(text, first, after, next) {
  const start = text.indexOf(first), end = text.indexOf(after, start + first.length);
  if (start < 0 || end < 0 || text.lastIndexOf(first) !== start || text.lastIndexOf(after) !== end)
    throw new Error("Scoped transport source block changed: " + first);
  return text.slice(0, start) + next + text.slice(end);
}
function nameFor(routine) {
  const name = nameOf(routine);
  return replace(routine.signature, name + "(", NAMES[name] + "(");
}
function definitionFor(routine) {
  const name = nameOf(routine);
  let definition = replace(routine.definition, "FUNCTION public." + name + "(", "FUNCTION public." + NAMES[name] + "(");
  for (const helper of ["pos_sync_history_company_scope_v1", "pos_sync_history_row_visible_v1"])
    definition = definition.replaceAll("public." + helper + "(", "public." + NAMES[helper] + "(");
  return definition;
}
function metadata(routine) {
  const keys = ["signature", "acl_values", "owner", "config", "definer", "strict", "volatility", "language", "returns",
    "parallel", "cost", "rows", "leakproof", "support"];
  return Object.fromEntries(keys.map(key => [key, routine[key]]));
}
function target(routine, definition) {
  const helper = routine.body !== undefined;
  const delimiter = helper ? "$history_scope$" : "$function$";
  const pieces = definition.split(delimiter);
  if (pieces.length !== 3) throw new Error("Scoped transport function body changed: " + routine.signature);
  const argumentsText = helper ? definition.slice(definition.indexOf("(") + 1, definition.indexOf(")")).split(",").join(", ") : null;
  return {
    ...metadata(routine), signature: nameFor(routine),
    cost: routine.cost ?? 100, rows: routine.rows ?? 0, parallel: routine.parallel ?? "u",
    leakproof: routine.leakproof ?? false, support: routine.support ?? "-",
    body_md5: md5(pieces[1]),
    ...(helper ? { arguments: argumentsText } : { definition_md5: md5(definition) }),
    definition: replace(definition, "CREATE OR REPLACE FUNCTION", "CREATE FUNCTION"),
  };
}
function boundedHistoryPage(routine, index) {
  let definition = definitionFor(routine);
  definition = replace(definition, "  v_raw jsonb;\n", [
    "  v_history_company boolean;",
    "  v_after_id uuid;",
    "  v_cursor_json jsonb;",
    "  v_ids uuid[];",
    "  v_history public.change_history%ROWTYPE;",
    "",
  ].join("\n"));
  // Share the reviewed projector/immutability checks. This reader selects at
  // most ten UUIDs first, and projects individual rows only when needed.
  const indexDefinition = definitionFor(index);
  const guardStart = indexDefinition.indexOf(" v_history_company := ");
  const guardEnd = indexDefinition.indexOf(" IF p_action IS NULL");
  if (guardStart < 0 || guardEnd <= guardStart) throw new Error("Scoped history page runtime guard changed");
  const guard = replace(indexDefinition.slice(guardStart, guardEnd),
    "EXECUTE FUNCTION change_history_immutable()", "EXECUTE FUNCTION public.change_history_immutable()");
  definition = rewriteRange(definition, "  -- Check before delegation:", "  IF p_max_bytes IS NULL", guard);
  definition = rewriteRange(definition, "  v_raw := public.pos_sync_bootstrap(", "    v_projected :=", [
    "  IF p_history_days IS NULL OR p_history_days NOT BETWEEN 30 AND 7300 THEN",
    "    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='POS_HISTORY_STREAM_INVALID_ARGUMENT';",
    "  END IF;",
    "  IF p_after_cursor IS NOT NULL THEN",
    "    BEGIN",
    "      v_cursor_json := p_after_cursor::jsonb;",
    "      IF jsonb_typeof(v_cursor_json) IS DISTINCT FROM 'object'",
    "       OR jsonb_typeof(v_cursor_json->'id') IS DISTINCT FROM 'string' OR v_cursor_json-'id'<>'{}'::jsonb",
    "       OR v_cursor_json->>'id' !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'",
    "      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='POS_HISTORY_STREAM_INVALID_ARGUMENT'; END IF;",
    "      v_after_id := (v_cursor_json->>'id')::uuid;",
    "    EXCEPTION WHEN invalid_text_representation THEN",
    "      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='POS_HISTORY_STREAM_INVALID_ARGUMENT';",
    "    END;",
    "  END IF;",
    "  SELECT COALESCE(array_agg(page.id ORDER BY page.id),ARRAY[]::uuid[]) INTO v_ids FROM (",
    "    SELECT h.id FROM public.change_history h",
    "    WHERE (v_after_id IS NULL OR h.id>v_after_id)",
    "      AND public.pos_sync_history_row_visible_transport_v1(v_history_company,p_organization_id,p_branch_id,h.organization_id,h.scope_type,h.scope_id)",
    "    ORDER BY h.id LIMIT 10",
    "  ) page;",
    "  v_total := cardinality(v_ids);",
    "  FOREACH v_last_id IN ARRAY v_ids LOOP",
    "    SELECT h.* INTO v_history FROM public.change_history h WHERE h.id=v_last_id",
    "      AND public.pos_sync_history_row_visible_transport_v1(v_history_company,p_organization_id,p_branch_id,h.organization_id,h.scope_type,h.scope_id);",
    "    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS_HISTORY_STREAM_INVALID_SOURCE'; END IF;",
    "    v_row := to_jsonb(v_history);",
    "",
  ].join("\n"));
  definition = replace(definition, "CASE WHEN v_count+1=v_total THEN v_raw->>'cursor' ELSE", "CASE WHEN v_count+1=v_total AND v_total<10 THEN NULL ELSE");
  return replace(definition, "'cursor',v_raw->>'cursor'", "'cursor',NULL");
}
function build(capture) {
  const { original, updates, additions, helpers, history_shape } = reviewedScope(capture);
  const reviewed = new Map([...updates, ...additions, ...helpers].map(routine => [nameOf(routine), routine]));
  const get = name => {
    const routine = reviewed.get(name);
    if (!routine) throw new Error("Missing reviewed scoped routine: " + name);
    return routine;
  };
  const pull = get("pos_sync_pull"), scopedPull = definitionFor(pull);
  const feed = get("pos_sync_feed_page_v1");
  let scopedFeed = replace(definitionFor(feed), "public.pos_sync_pull(", "public.pos_sync_pull_history_v2(", 2);
  scopedFeed = replace(scopedFeed, pull.definition_md5, md5(scopedPull));
  const page = get("pos_sync_history_page_v1"), index = get("pos_sync_history_index_v2");
  const overrides = new Map([[pull, scopedPull], [feed, scopedFeed], [page, boundedHistoryPage(page, index)]]);
  const targets = [
    ...helpers, pull, index, get("pos_sync_history_rows_v2"), page, feed, get("pos_sync_counts"),
  ].map(routine => target(routine, overrides.get(routine) ?? definitionFor(routine)));
  const dependencies = original.map(routine => ({
    ...metadata(routine),
    definition_hashes: [routine.definition_md5, ...updates.filter(update => update.signature === routine.signature).map(update => update.definition_md5)],
  }));
  return { dependencies, targets, historyShape: history_shape };
}

function render(capture) {
  const { dependencies, targets, historyShape } = build(capture);
  const json = value => "$history_transport_data$" + JSON.stringify(value).replaceAll("CREATE FUNCTION", "\\u0043REATE FUNCTION") + "$history_transport_data$::jsonb";
  return [
    "-- Add only guarded, service-only scoped readers under unused names.",
    "-- Exact-project approval is required before hosted execution.",
    "DO $history_transport_upgrade$",
    "DECLARE",
    " dependencies constant jsonb := " + json(dependencies) + ";",
    " targets constant jsonb := " + json(targets) + ";",
    " history_shape constant jsonb := " + json(historyShape) + ";",
    " entry jsonb; actual jsonb; fn oid; installed integer:=0;",
    "BEGIN",
    " IF current_user<>'postgres' THEN RAISE EXCEPTION 'HISTORY_TRANSPORT_OWNER'; END IF;",
    " PERFORM set_config('search_path','pg_catalog,public',true);",
    " LOCK TABLE public.change_history,public.sync_change_feed IN ACCESS SHARE MODE NOWAIT;",
    " SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)",
    " INTO actual FROM pg_attribute a WHERE a.attrelid='public.change_history'::regclass AND a.attnum>0 AND NOT a.attisdropped;",
    " IF actual IS DISTINCT FROM history_shape",
    " OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.change_history'::regclass AND relrowsecurity AND pg_get_userbyid(relowner)='postgres')",
    " OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.change_history'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[] AND convalidated AND NOT condeferrable)",
    " OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal)<>1",
    " OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O'",
    "  AND pg_get_triggerdef(oid)='CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_immutable()')",
    " THEN RAISE EXCEPTION 'HISTORY_TRANSPORT_SHAPE'; END IF;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(dependencies) LOOP",
    "  fn:=to_regprocedure('public.'||(entry->>'signature'));",
    "  IF fn IS NULL OR NOT (entry->'definition_hashes' ? md5(replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10))))",
    "  THEN RAISE EXCEPTION 'HISTORY_TRANSPORT_SOURCE_CHANGED: %',entry->>'signature'; END IF;",
    " END LOOP;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(targets) LOOP",
    "  fn:=to_regprocedure('public.'||(entry->>'signature'));",
    "  IF fn IS NOT NULL THEN installed:=installed+1; END IF;",
    " END LOOP;",
    " IF installed NOT IN (0,jsonb_array_length(targets)) THEN RAISE EXCEPTION 'HISTORY_TRANSPORT_PARTIAL'; END IF;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(dependencies||targets) WITH ORDINALITY AS routines(value,position) ORDER BY position LOOP",
    "  IF installed=0 AND entry ? 'definition' THEN",
    "   EXECUTE entry->>'definition';",
    "   EXECUTE 'REVOKE ALL ON FUNCTION public.'||(entry->>'signature')||' FROM PUBLIC,anon,authenticated,service_role';",
    "   EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||(entry->>'signature')||' TO service_role';",
    "  END IF;",
    "  fn:=to_regprocedure('public.'||(entry->>'signature'));",
    "  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn",
    "   AND pg_get_userbyid(p.proowner)=entry->>'owner' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=entry->'acl_values'",
    "   AND to_jsonb(p.proconfig)=entry->'config' AND p.prosecdef=(entry->>'definer')::boolean AND p.proisstrict=(entry->>'strict')::boolean",
    "   AND p.provolatile::text=entry->>'volatility' AND l.lanname=entry->>'language' AND pg_get_function_result(p.oid)=entry->>'returns'",
    "   AND p.prokind='f' AND p.proparallel::text=entry->>'parallel' AND p.procost=(entry->>'cost')::real",
    "   AND p.prorows=(entry->>'rows')::real AND p.proleakproof=(entry->>'leakproof')::boolean AND p.prosupport::text=entry->>'support'",
    "   AND (NOT(entry ? 'body_md5') OR md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=entry->>'body_md5')",
    "   AND (NOT(entry ? 'definition_md5') OR md5(replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)))=entry->>'definition_md5')",
    "   AND (NOT(entry ? 'arguments') OR pg_get_function_arguments(fn)=entry->>'arguments'))",
    "  THEN RAISE EXCEPTION 'HISTORY_TRANSPORT_METADATA: %',entry->>'signature'; END IF;",
    " END LOOP;",
    "END;",
    "$history_transport_upgrade$;",
    "",
  ].join("\n");
}

module.exports = { MIGRATION, NAMES, build, render };
if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const capture = JSON.parse(fs.readFileSync(path.join(root, "src/lib/__tests__/fixtures/history-scope-live-metadata.json"), "utf8"));
  const file = path.join(root, "supabase/migrations", MIGRATION);
  fs.writeFileSync(file, normalize(render(capture)), "utf8");
  console.log("Prepared only " + path.relative(root, file));
}
