"use strict";
// Preparation only: consumes schema/routine metadata, never connects to a DB.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const POLICY = "branch-history-v1";
const MIGRATION = "20261107021328_isolate_branch_history_sync.sql";
const normalize = value => value.replaceAll("\r\n", "\n");
const md5 = value => createHash("md5").update(normalize(value)).digest("hex");
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function replace(text, before, after, count = 1) {
  if (text.split(before).length - 1 !== count) throw new Error("History scope preparation anchor changed: " + before.slice(0, 100));
  return text.replaceAll(before, after);
}
const COMPANY = "public.pos_sync_history_company_scope_v1(p_organization_id,p_branch_id,p_terminal_id)";
const visible = alias => "public.pos_sync_history_row_visible_v1(v_history_company,p_organization_id,p_branch_id," + alias + ".organization_id," + alias + ".scope_type," + alias + ".scope_id)";
function admit(definition) {
  let value = replace(definition, "AS $function$\nDECLARE", "AS $function$\nDECLARE\n v_history_company boolean;");
  return replace(value, "PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);", "v_history_company := " + COMPANY + ";");
}
const companyDefinition = [
  "CREATE OR REPLACE FUNCTION public.pos_sync_history_company_scope_v1(p_organization_id text,p_branch_id text,p_terminal_id text)",
  "RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $history_scope$",
  "BEGIN",
  " PERFORM public.pos_sync_validate_read_scope(p_organization_id,p_branch_id,p_terminal_id);",
  " RETURN EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id",
  "  AND t.platform='pc' AND t.location_id IS NULL AND t.management_sync_enabled",
  "  AND t.is_claimed AND t.status IN ('active','used') AND t.revoked_at IS NULL);",
  "END;",
  "$history_scope$;"
].join("\n");
const rowDefinition = [
  "CREATE OR REPLACE FUNCTION public.pos_sync_history_row_visible_v1(p_company boolean,p_organization_id text,p_branch_id text,p_row_organization_id text,p_scope_type text,p_scope_id text)",
  "RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $history_scope$",
  ' SELECT COALESCE(p_row_organization_id COLLATE "C"=p_organization_id COLLATE "C" AND',
  '  (p_company IS TRUE OR (p_scope_type COLLATE "C"=\'BRANCH\' AND CASE',
  '   WHEN p_scope_id COLLATE "C" ~ \'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$\'',
  '    AND p_branch_id COLLATE "C" ~ \'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$\'',
  '   THEN lower(p_scope_id)=lower(p_branch_id) ELSE p_scope_id COLLATE "C"=p_branch_id COLLATE "C" END)),false);',
  "$history_scope$;"
].join("\n");
function build(metadata) {
  const original = new Map(metadata.functions.map(item => [item.signature, { ...item, acl_values: item.acl.slice(1,-1).split(",").sort(), definition: normalize(item.definition), stored_definition_md5: item.definition_md5, definition_md5: md5(item.definition) }]));
  // Canonical regeneration has the already-reviewed pre-COUNT80 wrapper and a
  // fresh 70-table delegate. These alternatives never relax the live preflight.
  const oldCounts = JSON.parse(fs.readFileSync(path.join(root, "src/lib/__tests__/fixtures/history-count-contract-live-metadata.json"), "utf8")).functions.find(item => item.signature === "pos_sync_counts(text,text,text,integer)");
  const scopedCounts = original.get("pos_sync_counts_scoped(text,text,text,integer)");
  original.get("pos_sync_counts(text,text,text,integer)").canonical_alternate_md5 = [md5(oldCounts.definition)];
  scopedCounts.canonical_alternate_md5 = [md5(replace(scopedCounts.definition, 'x WHERE true;\nEND $function$', 'x WHERE true UNION ALL SELECT \'change_history\'::text table_name,count(*)::bigint row_count FROM public."change_history" x WHERE true;\nEND $function$'))];
  const take = name => {
    const values = [...original.values()].filter(item => item.signature.startsWith(name + "("));
    if (values.length !== 1) throw new Error("Ambiguous captured function " + name);
    return values[0];
  };
  const updates = [];
  const update = (name, transform) => {
    const old = take(name), definition = transform(old.definition);
    if (definition === old.definition) throw new Error("Missing preparation change " + name);
    const value = { ...old, definition, definition_md5: md5(definition), old_md5: old.definition_md5 };
    updates.push(value); return value;
  };
  const bootstrap = update("pos_sync_bootstrap_scoped", definition => {
    const found = definition.match(/WHEN 'change_history' THEN[^;]*;/g);
    if (found?.length !== 1) throw new Error("Ambiguous history bootstrap");
    return replace(admit(definition), found[0], replace(found[0], "WHERE (true)", "WHERE (" + visible("x") + ")"));
  });
  update("pos_sync_counts", definition => {
    let value = replace(definition, "AS $function$\nBEGIN", "AS $function$\nDECLARE v_history_company boolean;\nBEGIN\n v_history_company := " + COMPANY + ";");
    value = replace(value, "WHERE scoped.table_name <> 'issued_vouchers'", "WHERE scoped.table_name NOT IN ('issued_vouchers','change_history')");
    return replace(value, "SELECT 'change_history'::text,count(*)::bigint FROM public.change_history;", "SELECT 'change_history'::text,count(*)::bigint FROM public.change_history h WHERE " + visible("h") + ";");
  });
  const pull = update("pos_sync_pull", definition => {
    let value = admit(definition);
    const feed = "(c.table_name<>'change_history' OR (NOT c.tombstone AND EXISTS(SELECT 1 FROM public.change_history history_scope_row WHERE history_scope_row.id=((c.entity_id::jsonb)->>'id')::uuid AND " + visible("history_scope_row") + ")))";
    value = replace(value, "c.cursor>p_after_cursor", "c.cursor>p_after_cursor AND " + feed, 2);
    const found = value.match(/WHEN 'change_history' THEN[^;]*? LIMIT 1\)/g);
    if (found?.length !== 1) throw new Error("Ambiguous history pull");
    return replace(value, found[0], replace(found[0], " LIMIT 1)", " AND " + visible("x") + " LIMIT 1)"));
  });
  update("pos_sync_history_page_v1", definition => replace(definition, take("pos_sync_bootstrap_scoped").stored_definition_md5, bootstrap.definition_md5));
  update("pos_sync_feed_page_v1", definition => replace(definition, take("pos_sync_pull").stored_definition_md5, pull.definition_md5));
  const index = update("pos_sync_history_index_v1", definition => {
    let value = admit(definition);
    value = replace(value, "FROM public.change_history h ORDER BY h.id DESC", "FROM public.change_history h WHERE " + visible("h") + " ORDER BY h.id DESC");
    return replace(value, "FROM public.change_history h WHERE v_upper IS NOT NULL", "FROM public.change_history h WHERE " + visible("h") + " AND v_upper IS NOT NULL", 2);
  });
  const rows = update("pos_sync_history_rows_v1", definition => {
    let value = admit(definition);
    return replace(value, "SELECT * INTO v_raw FROM public.change_history WHERE id=v_id::uuid;", "SELECT * INTO v_raw FROM public.change_history h WHERE h.id=v_id::uuid AND " + visible("h") + ";");
  });
  const additions = [index, rows].map(value => {
    const name = value.signature.split("(")[0], newName = name.replace("_v1", "_v2");
    let definition = replace(value.definition, "FUNCTION public." + name + "(", "FUNCTION public." + newName + "(");
    definition = replace(definition, "'protocol','history-" + (name.includes("_index_") ? "index" : "rows") + "-v1','projection'", "'protocol','history-" + (name.includes("_index_") ? "index" : "rows") + "-v2','policy','" + POLICY + "','history_scope',CASE WHEN v_history_company THEN 'company' ELSE 'branch' END,'projection'");
    definition = replace(definition, "jsonb_build_object('X-POS-History-Reconcile-Version','1')", "jsonb_build_object('X-POS-History-Reconcile-Version','2')");
    return { ...value, signature: value.signature.replace("_v1(", "_v2("), definition, definition_md5: md5(definition) };
  });
  const helpers = [
    { signature: "pos_sync_history_company_scope_v1(text,text,text)", definition: companyDefinition, language: "plpgsql", volatility: "v", config: ["search_path=pg_catalog, public"] },
    { signature: "pos_sync_history_row_visible_v1(boolean,text,text,text,text,text)", definition: rowDefinition, language: "sql", volatility: "i", config: ["search_path=pg_catalog"] }
  ].map(value => ({ ...value, body: value.definition.split("$history_scope$")[1], owner: "postgres", acl: "{postgres=X/postgres,service_role=X/postgres}", acl_values: ["postgres=X/postgres","service_role=X/postgres"], definer: false, strict: false, returns: "boolean" }));
  return { original: [...original.values()], updates, additions, helpers, history_shape: metadata.history_shape, history_triggers: metadata.history_triggers };
}
function render(metadata) {
  const data = build(metadata), targets = [...data.updates, ...data.additions], helperSignatures = data.helpers.map(item => item.signature);
  // These definitions are inert JSON metadata, not top-level DDL. Escaping the
  // first character keeps older source extractors from mistaking a fingerprint
  // for an executable definition; JSON decoding restores the exact same bytes.
  const literal = value => "$history_scope_data$" + JSON.stringify(value).replaceAll("CREATE OR REPLACE FUNCTION", "\\u0043REATE OR REPLACE FUNCTION") + "$history_scope_data$::jsonb";
  const sql = [
    "-- HISTORY_SCOPE82: preparation only; exact-project approval is required before application.",
    "-- One tool-owned transaction. No business rows, triggers, grants on existing routines, or cursors are rewritten.",
    "-- HISTORY_SCOPE82_BEGIN",
    "DO $history_scope_upgrade$",
    "DECLARE",
    " expected constant jsonb := " + literal(data.original) + ";",
    " desired constant jsonb := " + literal(targets) + ";",
    " helpers constant jsonb := " + literal(data.helpers) + ";",
    " shape constant jsonb := " + literal(data.history_shape) + ";",
    " entry jsonb; target jsonb; actual jsonb; fn oid; signature text; definition text; seen_old integer:=0; seen_new integer:=0; added integer:=0;",
    "BEGIN",
    " IF current_user<>'postgres' THEN RAISE EXCEPTION 'HISTORY_SCOPE_MIGRATION_OWNER'; END IF;",
    " PERFORM set_config('search_path','pg_catalog,public',true);",
    " LOCK TABLE public.change_history IN SHARE ROW EXCLUSIVE MODE NOWAIT;",
    " SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)",
    " INTO actual FROM pg_attribute a WHERE a.attrelid='public.change_history'::regclass AND a.attnum>0 AND NOT a.attisdropped;",
    " IF actual IS DISTINCT FROM shape OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.change_history'::regclass AND relrowsecurity AND pg_get_userbyid(relowner)='postgres')",
    " OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.change_history'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[] AND convalidated AND NOT condeferrable)",
    " OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal)<>1",
    " OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND tgname='change_history_no_change' AND tgenabled='O'",
    " AND pg_get_triggerdef(oid)='CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION change_history_immutable()')",
    " THEN RAISE EXCEPTION 'HISTORY_SCOPE_HISTORY_SHAPE'; END IF;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(expected) LOOP",
    "  signature:='public.'||(entry->>'signature');fn:=to_regprocedure(signature);",
    "  SELECT value INTO target FROM jsonb_array_elements(desired) WHERE value->>'signature'=entry->>'signature';",
    "  IF fn IS NULL THEN RAISE EXCEPTION 'HISTORY_SCOPE_SOURCE_MISSING'; END IF;",
    "  definition:=replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10));",
    "  IF md5(definition)<>entry->>'definition_md5' AND (target IS NULL OR md5(definition)<>target->>'definition_md5') THEN RAISE EXCEPTION 'HISTORY_SCOPE_SOURCE_CHANGED'; END IF;",
    "  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn",
    "   AND pg_get_userbyid(p.proowner)=entry->>'owner' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=entry->'acl_values'",
    "   AND to_jsonb(p.proconfig)=entry->'config' AND p.prosecdef=(entry->>'definer')::boolean",
    "   AND p.proisstrict=(entry->>'strict')::boolean AND p.provolatile::text=entry->>'volatility'",
    "   AND l.lanname=entry->>'language' AND pg_get_function_result(p.oid)=entry->>'returns'",
    "   AND p.prokind='f' AND p.proparallel::text=entry->>'parallel' AND p.procost=(entry->>'cost')::real",
    "   AND p.prorows=(entry->>'rows')::real AND p.proleakproof=(entry->>'leakproof')::boolean AND p.prosupport::text=entry->>'support')",
    "  THEN RAISE EXCEPTION 'HISTORY_SCOPE_SOURCE_METADATA'; END IF;",
    "  IF target IS NOT NULL THEN IF md5(definition)=entry->>'definition_md5' THEN seen_old:=seen_old+1;ELSE seen_new:=seen_new+1;END IF;END IF;",
    " END LOOP;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(helpers) UNION ALL SELECT value FROM jsonb_array_elements(desired) WHERE value->>'signature' IN (" + data.additions.map(item => quote(item.signature)).join(",") + ") LOOP",
    "  fn:=to_regprocedure('public.'||(entry->>'signature'));",
    "  IF fn IS NOT NULL THEN",
    "   added:=added+1;",
    "   IF entry ? 'body' THEN",
    "    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn",
    "     AND replace(p.prosrc,chr(13)||chr(10),chr(10))=entry->>'body' AND pg_get_userbyid(p.proowner)='postgres'",
    "     AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=entry->'acl_values' AND to_jsonb(p.proconfig)=entry->'config' AND NOT p.prosecdef AND NOT p.proisstrict",
    "     AND p.provolatile::text=entry->>'volatility' AND l.lanname=entry->>'language' AND pg_get_function_result(p.oid)='boolean'",
    "     AND p.prokind='f' AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100 AND p.prorows=0 AND p.prosupport=0)",
    "    THEN RAISE EXCEPTION 'HISTORY_SCOPE_EXISTING_HELPER'; END IF;",
    "   ELSE IF md5(replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)))<>entry->>'definition_md5'",
    "    OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=fn AND pg_get_userbyid(proowner)='postgres' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))",
    "    THEN RAISE EXCEPTION 'HISTORY_SCOPE_EXISTING_V2'; END IF;END IF;",
    "  END IF;",
    " END LOOP;",
    " IF NOT ((seen_old=7 AND seen_new=0 AND added=0) OR (seen_old=0 AND seen_new=7 AND added=4)) THEN RAISE EXCEPTION 'HISTORY_SCOPE_PARTIAL_INSTALL'; END IF;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(helpers) LOOP",
    "  EXECUTE entry->>'definition';",
    "  EXECUTE 'REVOKE ALL ON FUNCTION public.'||(entry->>'signature')||' FROM PUBLIC,anon,authenticated,service_role';",
    "  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||(entry->>'signature')||' TO service_role';",
    " END LOOP;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(desired) LOOP",
    "  EXECUTE entry->>'definition';",
    "  IF entry->>'signature' IN (" + data.additions.map(item => quote(item.signature)).join(",") + ") THEN",
    "   EXECUTE 'REVOKE ALL ON FUNCTION public.'||(entry->>'signature')||' FROM PUBLIC,anon,authenticated,service_role';",
    "   EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||(entry->>'signature')||' TO service_role';",
    "  END IF;",
    "  IF md5(replace(pg_get_functiondef(to_regprocedure('public.'||(entry->>'signature'))),chr(13)||chr(10),chr(10)))<>entry->>'definition_md5' THEN RAISE EXCEPTION 'HISTORY_SCOPE_READBACK'; END IF;",
    " END LOOP;",
    "END;",
    "$history_scope_upgrade$;",
    "-- HISTORY_SCOPE82_END",
    ""
  ].join("\n");
  if (helperSignatures.length !== 2 || data.updates.length !== 7 || data.additions.length !== 2) throw new Error("Unexpected history patch scope");
  return sql;
}
module.exports = { POLICY, MIGRATION, build, render, md5 };
if (require.main === module) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "src/lib/__tests__/fixtures/history-scope-live-metadata.json"), "utf8"));
  const file = path.join(root, "supabase/migrations", MIGRATION);
  if (!fs.existsSync(file)) throw new Error("Create the migration with Supabase CLI before preparation");
  fs.writeFileSync(file, render(metadata), "utf8");
  console.log("Prepared only " + path.relative(root, file));
}
