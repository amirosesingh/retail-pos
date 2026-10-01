const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "supabase", "schema.sql");
const registry = JSON.parse(
  fs.readFileSync(path.join(root, "database", "sqlserver", "schema-registry.json"), "utf8"),
);
const begin = "-- SQLSERVER_SYNC_CONTRACT_BEGIN";
const end = "-- SQLSERVER_SYNC_CONTRACT_END";
const q = (value) => `"${value}"`;
const primary = (table) => table.columns.filter((column) => column.primaryKey);
const columnNames = (table) => new Set(table.columns.map((column) => column.cloudColumn));
const keyJson = (table, alias) =>
  `jsonb_build_object(${primary(table)
    .map((column) => `'${column.cloudColumn}',${alias}.${q(column.cloudColumn)}`)
    .join(",")})::text`;
const keyValue = (column, feedAlias) => {
  const jsonValue = `((${feedAlias}.entity_id::jsonb)->>'${column.cloudColumn}')`;
  const type = String(column.cloudType ?? "text").toLowerCase();
  // Keep the indexed column bare. Casting it to text forces PostgreSQL to
  // scan the full source table once per feed row. Cast the trigger-generated
  // JSON key back to its registered type so primary-key indexes remain usable.
  if (type === "uuid") return `${jsonValue}::uuid`;
  if (type === "integer" || type === "bigint" || type === "smallint")
    return `${jsonValue}::${type}`;
  return jsonValue;
};
const keyMatch = (table, rowAlias, feedAlias = "f") =>
  primary(table)
    .map(
      (column) =>
        `${rowAlias}.${q(column.cloudColumn)}=${keyValue(column, feedAlias)}`,
    )
    .join(" AND ");

function scopedPredicate(table, alias, branchParameter = "p_branch_id", terminalParameter = "p_terminal_id") {
  const scope = table.cloudTable.startsWith("authorization_action") ? "scope_type" : "scope";
  if (!["settings_overrides", "settings_scoped", "authorization_actions", "authorization_action_history"].includes(table.cloudTable)) return null;
  return `(lower(${alias}.${scope})='global' OR (lower(${alias}.${scope})='branch' AND ${alias}.scope_id::text=${branchParameter}) OR (lower(${alias}.${scope})='cluster' AND EXISTS(SELECT 1 FROM public.stores scoped_store WHERE scoped_store.id::text=${branchParameter} AND COALESCE(NULLIF(scoped_store.group_id,''),'default')=${alias}.scope_id::text))${table.cloudTable.startsWith("settings_") ? ` OR (lower(${alias}.${scope})='terminal' AND ${alias}.scope_id::text=${terminalParameter})` : ""})`;
}

function directBranchPredicate(table, alias, parameter = "p_branch_id", terminalParameter = "p_terminal_id") {
  const scoped = scopedPredicate(table, alias, parameter, terminalParameter);
  if (scoped) return scoped;
  const names = columnNames(table);
  if (table.cloudTable === "products")
    return `(NULLIF(${alias}.owner_store_id::text,'') IS NULL OR ${alias}.owner_store_id::text=${parameter})`;
  if (names.has("store_id")) return `${alias}.store_id::text=${parameter}`;
  if (names.has("branch_id")) return `${alias}.branch_id::text=${parameter}`;
  if (names.has("from_store_id") && names.has("to_store_id"))
    return `${parameter} IN (${alias}.from_store_id::text,${alias}.to_store_id::text)`;
  return null;
}

function branchPredicate(table, alias = "x", seen = new Set()) {
  const direct = directBranchPredicate(table, alias);
  if (direct) return direct;
  if (seen.has(table.cloudTable)) return "false";
  const nextSeen = new Set(seen).add(table.cloudTable);
  for (const column of table.columns.filter((item) => item.foreignKey && item.foreignKeyTarget)) {
    const parent = registry.tables.find(
      (item) => item.cloudTable === column.foreignKeyTarget.table,
    );
    if (!parent) continue;
    const parentFilter = branchPredicate(parent, "p", nextSeen);
    if (parentFilter !== "true" && parentFilter !== "false")
      return `EXISTS(SELECT 1 FROM public.${q(parent.cloudTable)} p WHERE p.${q(column.foreignKeyTarget.column)}::text=${alias}.${q(column.cloudColumn)}::text AND ${parentFilter})`;
  }
  return "true";
}

function deleteBranchPredicate(table, alias = "x") {
  if (["settings_overrides", "settings_scoped"].includes(table.cloudTable))
    return `((lower(${alias}.scope)='branch' AND ${alias}.scope_id::text=p_branch_id) OR (lower(${alias}.scope)='terminal' AND ${alias}.scope_id::text=p_terminal_id))`;
  return branchPredicate(table, alias);
}

function incomingBranchGuard(table, rows = "p_rows") {
  const names = columnNames(table);
  if (table.cloudTable === "products")
    return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE NULLIF(r->>'owner_store_id','') IS NOT NULL AND r->>'owner_store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF;`;
  if (["settings_overrides", "settings_scoped"].includes(table.cloudTable))
    return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')) THEN RAISE EXCEPTION 'SYNC_SCOPE_FORBIDDEN'; END IF; SELECT COALESCE(jsonb_agg(r) FILTER (WHERE (lower(COALESCE(r->>'scope',''))='branch' AND r->>'scope_id'=p_branch_id) OR (lower(COALESCE(r->>'scope',''))='terminal' AND r->>'scope_id'=p_terminal_id)),'[]'::jsonb) INTO ${rows} FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r;`;
  if (table.cloudTable === "audit_logs")
    return `SELECT COALESCE(jsonb_agg(CASE WHEN NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id) ELSE r END),'[]'::jsonb) INTO ${rows} FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r; IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
  if (names.has("store_id"))
    return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE r->>'store_id' IS NULL OR r->>'store_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
  if (names.has("branch_id"))
    return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
  if (names.has("from_store_id") && names.has("to_store_id"))
    return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE p_branch_id<>COALESCE(r->>'from_store_id','') AND p_branch_id<>COALESCE(r->>'to_store_id','')) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
  for (const column of table.columns.filter((item) => item.foreignKey && item.foreignKeyTarget)) {
    const parent = registry.tables.find(
      (item) => item.cloudTable === column.foreignKeyTarget.table,
    );
    if (!parent) continue;
    const parentNames = columnNames(parent);
    const link = `p.${q(column.foreignKeyTarget.column)}::text=r->>'${column.cloudColumn}'`;
    if (parentNames.has("store_id"))
      return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public.${q(parent.cloudTable)} p WHERE ${link} AND p.store_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
    if (parentNames.has("branch_id"))
      return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public.${q(parent.cloudTable)} p WHERE ${link} AND p.branch_id::text=p_branch_id)) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
    if (parentNames.has("from_store_id") && parentNames.has("to_store_id"))
      return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE NOT EXISTS(SELECT 1 FROM public.${q(parent.cloudTable)} p WHERE ${link} AND p_branch_id IN (p.from_store_id::text,p.to_store_id::text))) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;`;
    if (parentNames.has("owner_store_id"))
      return `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) r WHERE ${column.nullable ? `NULLIF(r->>'${column.cloudColumn}','') IS NOT NULL AND ` : ""}NOT EXISTS(SELECT 1 FROM public.${q(parent.cloudTable)} p WHERE ${link} AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id))) THEN RAISE EXCEPTION 'SYNC_PRODUCT_SCOPE_FORBIDDEN'; END IF;`;
  }
  return "";
}

function dateColumn(table) {
  const names = columnNames(table);
  return (
    ["created_at", "paid_at", "occurred_at", "updated_at"].find((name) => names.has(name)) ?? null
  );
}

function feedBranches(table) {
  const names = columnNames(table);
  const scope = table.cloudTable.startsWith("authorization_action") ? "scope_type" : "scope";
  if (["settings_overrides", "settings_scoped", "authorization_actions", "authorization_action_history"].includes(table.cloudTable)) {
    const row = `COALESCE(NEW.${scope},OLD.${scope})`;
    const id = `COALESCE(NEW.scope_id,OLD.scope_id)`;
    const terminal = table.cloudTable.startsWith("settings_")
      ? ` UNION ALL SELECT token.location_id::text,${id}::text FROM public.terminal_tokens token WHERE lower(${row})='terminal' AND token.id::text=${id}::text`
      : "";
    return `SELECT 'global'::text branch_id,NULL::text terminal_id WHERE lower(${row})='global' UNION ALL SELECT ${id}::text,NULL::text WHERE lower(${row})='branch' UNION ALL SELECT store.id::text,NULL::text FROM public.stores store WHERE lower(${row})='cluster' AND COALESCE(NULLIF(store.group_id,''),'default')=${id}::text${terminal}`;
  }
  if (table.cloudTable === "products")
    return "SELECT COALESCE(NULLIF(COALESCE(NEW.owner_store_id,OLD.owner_store_id)::text,''),'global') branch_id,NULL::text terminal_id";
  if (names.has("store_id"))
    return "SELECT COALESCE(NEW.store_id,OLD.store_id,'global')::text branch_id,NULL::text terminal_id";
  if (names.has("branch_id"))
    return "SELECT COALESCE(NEW.branch_id,OLD.branch_id,'global')::text branch_id,NULL::text terminal_id";
  if (names.has("from_store_id") && names.has("to_store_id"))
    return "SELECT DISTINCT branch_id,NULL::text terminal_id FROM (VALUES(COALESCE(NEW.from_store_id,OLD.from_store_id)::text),(COALESCE(NEW.to_store_id,OLD.to_store_id)::text)) b(branch_id) WHERE branch_id IS NOT NULL";
  for (const column of table.columns.filter((item) => item.foreignKey && item.foreignKeyTarget)) {
    const parent = registry.tables.find(
      (item) => item.cloudTable === column.foreignKeyTarget.table,
    );
    if (!parent) continue;
    const parentNames = columnNames(parent);
    const link = `p.${q(column.foreignKeyTarget.column)}::text=COALESCE(NEW.${q(column.cloudColumn)},OLD.${q(column.cloudColumn)})::text`;
    if (parentNames.has("store_id"))
      return `SELECT p.store_id::text branch_id,NULL::text terminal_id FROM public.${q(parent.cloudTable)} p WHERE ${link}`;
    if (parentNames.has("branch_id"))
      return `SELECT p.branch_id::text branch_id,NULL::text terminal_id FROM public.${q(parent.cloudTable)} p WHERE ${link}`;
    if (parentNames.has("from_store_id") && parentNames.has("to_store_id"))
      return `SELECT DISTINCT branch_id,NULL::text terminal_id FROM public.${q(parent.cloudTable)} p CROSS JOIN LATERAL (VALUES(p.from_store_id::text),(p.to_store_id::text)) b(branch_id) WHERE ${link} AND branch_id IS NOT NULL`;
    if (parentNames.has("owner_store_id"))
      return `SELECT COALESCE(NULLIF(p.owner_store_id::text,''),'global') branch_id,NULL::text terminal_id FROM public.${q(parent.cloudTable)} p WHERE ${link}`;
  }
  return "SELECT 'global'::text branch_id,NULL::text terminal_id";
}

const tables = registry.tables.filter((table) => primary(table).length);
const pushTables = tables.filter((table) => table.direction !== "pull");
const out = [
  begin,
  `CREATE TABLE IF NOT EXISTS public.sync_idempotency_receipts (
 batch_id uuid PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL, table_name text NOT NULL,
 payload_hash text NOT NULL DEFAULT '', applied_count integer NOT NULL DEFAULT 0, applied_at timestamptz NOT NULL DEFAULT now());`,
  `ALTER TABLE public.sync_idempotency_receipts ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS public.sync_change_feed (
 cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id text NOT NULL, branch_id text NOT NULL,
 terminal_id text,
 table_name text NOT NULL, entity_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('insert','update','delete')),
 row_version bigint NOT NULL DEFAULT 1, tombstone boolean NOT NULL DEFAULT false, changed_at timestamptz NOT NULL DEFAULT now());`,
  `CREATE INDEX IF NOT EXISTS sync_change_feed_branch_cursor_idx ON public.sync_change_feed(organization_id,branch_id,cursor);`,
  `ALTER TABLE public.sync_change_feed ADD COLUMN IF NOT EXISTS terminal_id text;`,
  `ALTER TABLE public.sync_idempotency_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sync_change_feed ENABLE ROW LEVEL SECURITY;`,
  `CREATE OR REPLACE FUNCTION public.pos_sync_validate_scope(p_organization_id text,p_branch_id text,p_terminal_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF p_organization_id IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'SYNC_ORGANIZATION_FORBIDDEN'; END IF;
 IF NULLIF(btrim(p_branch_id),'') IS NULL OR NULLIF(btrim(p_terminal_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id AND t.status IN ('active','used') AND t.revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_validate_scope(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_validate_scope(text,text,text) TO service_role;`,
];

for (const table of tables) {
  const columns = table.columns.map((column) => q(column.cloudColumn));
  const updates = table.columns
    .filter(
      (column) =>
        !column.primaryKey &&
        !(
          table.cloudTable === "products" &&
          ["stock_quantity", "stock_by_store"].includes(column.cloudColumn)
        ),
    )
    .map((column) => `${q(column.cloudColumn)}=EXCLUDED.${q(column.cloudColumn)}`);
  const versionWhere = columnNames(table).has("row_version")
    ? ` WHERE EXCLUDED."row_version">public.${q(table.cloudTable)}."row_version"`
    : "";
  const immutable =
    table.conflictRule === "immutable_reversal" || table.conflictRule === "movement_delta";
  const conflictAction =
    table.cloudTable === "sales"
      ? `UPDATE SET "is_refunded"=(public."sales"."is_refunded" OR EXCLUDED."is_refunded"),"row_version"=GREATEST(public."sales"."row_version",EXCLUDED."row_version")`
      : table.cloudTable === "sale_items"
        ? `UPDATE SET "refunded_qty"=GREATEST(public."sale_items"."refunded_qty",EXCLUDED."refunded_qty"),"row_version"=GREATEST(public."sale_items"."row_version",EXCLUDED."row_version")`
        : table.cloudTable === "activity_events"
          ? `UPDATE SET "cleared_by"=EXCLUDED."cleared_by"`
          : ["authorization_requests", "authorization_log"].includes(table.cloudTable)
            ? "NOTHING"
            : updates.length && !immutable
              ? `UPDATE SET ${updates.join(",")}${versionWhere}`
              : "NOTHING";
  const refundOn = ["sales", "sale_items"].includes(table.cloudTable)
    ? "PERFORM set_config('pos.refunding','on',true);"
    : "";
  const refundOff = ["sales", "sale_items"].includes(table.cloudTable)
    ? "PERFORM set_config('pos.refunding','off',true);"
    : "";
  const shiftGuardOn = ["shifts", "shift_cash_counts", "shift_close_events", "shift_reconciliations"].includes(table.cloudTable)
    ? "PERFORM set_config('pos.shift_fn','on',true);"
    : "";
  const shiftGuardOff = shiftGuardOn ? "PERFORM set_config('pos.shift_fn','',true);" : "";
  const applyStock =
    table.cloudTable === "item_activity_logs"
      ? `FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    IF NULLIF(v_row->>'id','') IS NOT NULL AND NULLIF(v_row->>'product_id','') IS NOT NULL AND NULLIF(v_row->>'store_id','') IS NOT NULL AND COALESCE((v_row->>'quantity_delta')::integer,0)<>0 THEN
      PERFORM public.stock_apply_delta((v_row->>'id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'quantity_delta')::integer,0));
    END IF;
  END LOOP;`
      : "";
  if (table.cloudTable === "stock_delta_applied") {
    out.push(`CREATE OR REPLACE FUNCTION public.sync_apply_stock_delta_applied(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_count integer:=0; v_row jsonb;
BEGIN FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
  PERFORM public.stock_apply_delta((v_row->>'movement_id')::uuid,(v_row->>'product_id')::uuid,v_row->>'store_id',COALESCE((v_row->>'delta')::integer,0)); v_count:=v_count+1;
 END LOOP; RETURN v_count; END $fn$;`);
  } else
    out.push(`CREATE OR REPLACE FUNCTION public.sync_apply_${table.cloudTable}(p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_count integer; v_row jsonb;
BEGIN
  ${refundOn}
  ${shiftGuardOn}
  INSERT INTO public.${q(table.cloudTable)} (${columns.join(",")})
  SELECT ${columns.join(",")} FROM jsonb_populate_recordset(NULL::public.${q(table.cloudTable)}, COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (${primary(table)
    .map((column) => q(column.cloudColumn))
    .join(",")}) DO ${conflictAction};
  GET DIAGNOSTICS v_count=ROW_COUNT;
  ${applyStock}
  ${shiftGuardOff}
  ${refundOff}
  RETURN v_count;
END $fn$;`);
  const deleteWhere = primary(table)
    .map(
      (column) =>
        `x.${q(column.cloudColumn)}::text=COALESCE(c->'key'->>'${column.cloudColumn}',(c->>'entityId')::jsonb->>'${column.cloudColumn}',(c->>'entity_id')::jsonb->>'${column.cloudColumn}')`,
    )
    .join(" AND ");
  const deleteStatement = table.deleteRule === "none"
    ? "BEGIN RETURN 0; END"
    : `BEGIN DELETE FROM public.${q(table.cloudTable)} x USING jsonb_array_elements(COALESCE(p_changes,'[]'::jsonb)) c
 WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') AND (${deleteBranchPredicate(table)}) AND ${deleteWhere};
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END`;
  out.push(`CREATE OR REPLACE FUNCTION public.sync_delete_${table.cloudTable}(p_changes jsonb,p_branch_id text,p_terminal_id text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_count integer;
${deleteStatement} $fn$;
REVOKE ALL ON FUNCTION public.sync_apply_${table.cloudTable}(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_${table.cloudTable}(jsonb,text,text) FROM PUBLIC;`);
  const names = columnNames(table);
  const organization = names.has("organization_id")
    ? "COALESCE(NEW.organization_id,OLD.organization_id,'default')"
    : "'default'";
  const version = names.has("row_version") ? "COALESCE(NEW.row_version,OLD.row_version,1)" : "1";
  const key = `CASE WHEN TG_OP='DELETE' THEN ${keyJson(table, "OLD")} ELSE ${keyJson(table, "NEW")} END`;
  out.push(`CREATE OR REPLACE FUNCTION public.sync_feed_${table.cloudTable}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $trg$
BEGIN INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone)
 SELECT ${organization},branches.branch_id,branches.terminal_id,'${table.cloudTable}',${key},lower(TG_OP),${version},TG_OP='DELETE' FROM (${feedBranches(table)}) branches; RETURN NULL; END $trg$;
DROP TRIGGER IF EXISTS sync_feed_change ON public.${q(table.cloudTable)};
CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON public.${q(table.cloudTable)} FOR EACH ROW EXECUTE FUNCTION public.sync_feed_${table.cloudTable}();`);
  out.push(
    `REVOKE ALL ON FUNCTION public.sync_feed_${table.cloudTable}() FROM PUBLIC, anon, authenticated;`,
  );
}

const applyCases = (rowsExpression, changesExpression) =>
  pushTables
    .map(
      (table) =>
        `WHEN '${table.cloudTable}' THEN ${incomingBranchGuard(table, rowsExpression)} v_count:=public.sync_apply_${table.cloudTable}(${rowsExpression})+public.sync_delete_${table.cloudTable}(${changesExpression},p_branch_id,p_terminal_id);`,
    )
    .join("\n    ");
const rowCases = tables
  .map(
    (table) =>
      `WHEN '${table.cloudTable}' THEN (SELECT to_jsonb(x) FROM public.${q(table.cloudTable)} x WHERE ${keyMatch(table, "x")} LIMIT 1)`,
  )
  .join("\n    ");

out.push(`CREATE OR REPLACE FUNCTION public.pos_sync_push_batch(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_rows jsonb,p_changes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_count integer:=0; v_hash text:=md5(p_table||COALESCE(p_rows,'[]'::jsonb)::text||COALESCE(p_changes,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF auth.role()<>'service_role' THEN
  SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
 END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 CASE p_table ${applyCases("p_rows", "p_changes")} ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,p_table,v_hash,v_count);
 RETURN jsonb_build_object('ok',true,'applied',v_count,'batch_id',p_batch_id);
END $fn$;`);

out.push(`CREATE OR REPLACE FUNCTION public.pos_sync_push_aggregate(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_op jsonb; v_table text; v_rows jsonb; v_count integer:=0; v_total integer:=0; v_hash text:=md5(COALESCE(p_operations,'[]'::jsonb)::text); v_prior text;
BEGIN
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 PERFORM set_config('pos.source_application','electron',true);
 PERFORM set_config('pos.sync_terminal',p_terminal_id,true);
 PERFORM set_config('pos.device_id',p_terminal_id,true);
 IF jsonb_typeof(p_operations)<>'array' OR jsonb_array_length(p_operations)>200 THEN RAISE EXCEPTION 'SYNC_AGGREGATE_INVALID'; END IF;
 IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
  IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
  IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT payload_hash INTO v_prior FROM public.sync_idempotency_receipts WHERE batch_id=p_batch_id;
 IF FOUND THEN IF v_prior<>v_hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF; RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',p_batch_id); END IF;
 FOR v_op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP v_table:=v_op->>'table'; v_rows:=COALESCE(v_op->'rows','[]'::jsonb);
  IF v_table='products' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) related WHERE related->>'table' IN ('item_activity_logs','stock_delta_applied')) THEN
   SELECT COALESCE(jsonb_agg((row_value-'stock_quantity'-'stock_by_store')||jsonb_build_object('stock_quantity',0,'stock_by_store','{}'::jsonb)),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) AS product_rows(row_value);
  END IF;
  CASE v_table ${applyCases("v_rows", "v_op->'changes'")} ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE; v_total:=v_total+v_count;
 END LOOP;
 INSERT INTO public.sync_idempotency_receipts(batch_id,organization_id,branch_id,table_name,payload_hash,applied_count) VALUES(p_batch_id,p_organization_id,p_branch_id,'__aggregate__',v_hash,v_total);
 RETURN jsonb_build_object('ok',true,'applied',v_total,'batch_id',p_batch_id);
END $fn$;`);

const pullFunction = `CREATE OR REPLACE FUNCTION public.pos_sync_pull(p_organization_id text,p_branch_id text,p_terminal_id text,p_after_cursor bigint DEFAULT 0,p_limit integer DEFAULT 500)
RETURNS TABLE(cursor bigint,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,row_data jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY WITH feed_page AS MATERIALIZED (
  SELECT candidate.cursor,candidate.table_name,candidate.entity_id,candidate.operation,candidate.row_version,candidate.tombstone
  FROM public.sync_change_feed candidate
  WHERE candidate.organization_id=p_organization_id AND candidate.branch_id IN (p_branch_id,'global')
    AND (candidate.terminal_id IS NULL OR candidate.terminal_id=p_terminal_id) AND candidate.cursor>p_after_cursor
  ORDER BY candidate.cursor LIMIT LEAST(GREATEST(p_limit,100),2000)
 )
 SELECT f.cursor,f.table_name,f.entity_id,f.operation,f.row_version,f.tombstone,CASE f.table_name ${rowCases} ELSE NULL END
 FROM feed_page f ORDER BY f.cursor;
END $fn$;`;
out.push(pullFunction);

const bootstrapCases = tables
  .map((table) => {
    const key = keyJson(table, "x");
    const history =
      table.retentionClass === "historical" && dateColumn(table)
        ? `AND (p_history_days>=7300 OR x.${q(dateColumn(table))}>=now()-make_interval(days=>GREATEST(p_history_days,30)))`
        : "";
    return `WHEN '${table.cloudTable}' THEN SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),max(page.cursor) INTO v_rows,v_cursor FROM (SELECT ${key} cursor,x row_data FROM public.${q(table.cloudTable)} x WHERE (${branchPredicate(table)}) ${history} AND (p_after_cursor IS NULL OR ${key}>p_after_cursor) ORDER BY ${key} LIMIT LEAST(GREATEST(p_limit,100),2000)) page;`;
  })
  .join("\n    ");
out.push(`CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap(p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_after_cursor text DEFAULT NULL,p_history_days integer DEFAULT 90,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 CASE p_table ${bootstrapCases} ELSE RAISE EXCEPTION 'SYNC_TABLE_FORBIDDEN'; END CASE;
 RETURN jsonb_build_object('rows',v_rows,'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,100),2000) THEN v_cursor ELSE NULL END);
END $fn$;`);

const countQueries = tables
  .map((table) => {
    const history =
      table.retentionClass === "historical" && dateColumn(table)
        ? ` AND (p_history_days>=7300 OR x.${q(dateColumn(table))}>=now()-make_interval(days=>GREATEST(p_history_days,30)))`
        : "";
    return `SELECT '${table.cloudTable}'::text table_name,COUNT_BIG_PLACEHOLDER FROM public.${q(table.cloudTable)} x WHERE ${branchPredicate(table)}${history}`;
  })
  .join(" UNION ALL ")
  .replaceAll("COUNT_BIG_PLACEHOLDER", "count(*)::bigint row_count");
out.push(`CREATE OR REPLACE FUNCTION public.pos_sync_counts(p_organization_id text,p_branch_id text,p_terminal_id text,p_history_days integer DEFAULT 90)
RETURNS TABLE(table_name text,row_count bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_me public.app_users%ROWTYPE;
BEGIN PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id); IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 RETURN QUERY ${countQueries};
END $fn$;`);

out.push(`CREATE OR REPLACE FUNCTION public.pos_old_receipt_lookup(p_lookup text,p_branch_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_me public.app_users%ROWTYPE; v_sale public.sales%ROWTYPE;
BEGIN IF auth.role()<>'service_role' THEN SELECT * INTO v_me FROM public.app_users WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF v_me.id IS NULL OR NOT (v_me.role='admin' OR COALESCE((v_me.permissions->>'can_process_refund')::boolean,false)) THEN RAISE EXCEPTION 'REFUND_FORBIDDEN'; END IF;
 IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; END IF;
 SELECT * INTO v_sale FROM public.sales WHERE store_id=p_branch_id AND (id::text=p_lookup OR bill_number=p_lookup OR client_transaction_id::text=p_lookup) LIMIT 1;
 IF v_sale.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sale',to_jsonb(v_sale),'items',(SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.sale_items i WHERE i.sale_id=v_sale.id),'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.payment_transactions p WHERE p.sale_id=v_sale.id));
END $fn$;`);
out.push(
  `REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_counts(text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_old_receipt_lookup(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_old_receipt_lookup(text,text) TO service_role;`,
  end,
);

let schema = fs.readFileSync(schemaPath, "utf8");
const block = out
  .join("\n\n")
  .replaceAll(
    "LANGUAGE plpgsql SECURITY INVOKER AS",
    "LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS",
  )
  .replaceAll(
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS",
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS",
  )
  .replace(/^[ \t]+$/gm, "");
const start = schema.indexOf(begin);
const finish = schema.indexOf(end);
if (start >= 0 && finish >= start)
  schema = schema.slice(0, start) + block + schema.slice(finish + end.length);
else schema = `${schema.trimEnd()}\n\n${block}\n`;
fs.writeFileSync(schemaPath, schema);
console.log(`Supabase sync contract generated for ${tables.length} keyed tables`);

const migrationIndex = process.argv.indexOf("--migration");
if (migrationIndex >= 0) {
  const requested = process.argv[migrationIndex + 1];
  const migrationPath = requested ? path.resolve(root, requested) : "";
  const migrationsDir = path.join(root, "supabase", "migrations") + path.sep;
  if (!migrationPath.startsWith(migrationsDir) || !fs.existsSync(migrationPath))
    throw new Error("--migration must name an existing file under supabase/migrations");
  const hardeningStart = schema.indexOf("-- Scoped synchronization and RLS hardening.");
  const contractEnd = schema.indexOf(end, hardeningStart) + end.length;
  if (hardeningStart < 0 || contractEnd < end.length) throw new Error("Could not find the scoped sync migration block.");
  const preamble = `ALTER TABLE public.settings_overrides ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.settings_scoped ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.preserve_or_bump_row_version() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  NEW.row_version := GREATEST(COALESCE(NEW.row_version,0),COALESCE(OLD.row_version,0)+1);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS settings_overrides_bump_row_version ON public.settings_overrides;
CREATE TRIGGER settings_overrides_bump_row_version BEFORE UPDATE ON public.settings_overrides FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();
DROP TRIGGER IF EXISTS settings_scoped_bump_row_version ON public.settings_scoped;
CREATE TRIGGER settings_scoped_bump_row_version BEFORE UPDATE ON public.settings_scoped FOR EACH ROW EXECUTE FUNCTION public.preserve_or_bump_row_version();

`;
  fs.writeFileSync(migrationPath, preamble + schema.slice(hardeningStart, contractEnd));
  console.log(`Migration sync contract written to ${path.relative(root, migrationPath)}`);
}

const pullMigrationIndex = process.argv.indexOf("--pull-migration");
if (pullMigrationIndex >= 0) {
  const requested = process.argv[pullMigrationIndex + 1];
  const migrationPath = requested ? path.resolve(root, requested) : "";
  const migrationsDir = path.join(root, "supabase", "migrations") + path.sep;
  if (!migrationPath.startsWith(migrationsDir) || !fs.existsSync(migrationPath))
    throw new Error("--pull-migration must name an existing file under supabase/migrations");
  const migration = `${pullFunction}

REVOKE ALL ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_pull(text,text,text,bigint,integer) TO service_role;
`;
  fs.writeFileSync(migrationPath, migration);
  console.log(`Pull migration written to ${path.relative(root, migrationPath)}`);
}
