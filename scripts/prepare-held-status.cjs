"use strict";
// Pure file preparation. This module never opens a database connection.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const MIGRATION = "20261107024729_bounded_held_status_reconciliation.sql";
const SIGNATURE = "pos_sync_held_status_v1(text,text,text,jsonb,boolean,integer)";
const normalize = value => value.replaceAll("\r\n", "\n");
function render() {
  const source = normalize(fs.readFileSync(path.join(root, "scripts/preparation/bounded-held-status.sql"), "utf8"));
  const captured = JSON.parse(fs.readFileSync(path.join(root, "src/lib/__tests__/fixtures/history-scope-live-metadata.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(root, "src/lib/__tests__/fixtures/held-status-live-metadata.json"), "utf8"));
  const helpers = captured.functions.filter(item => ["pos_sync_validate_scope(text,text,text)", "pos_sync_history_project_v1(jsonb,text,boolean)"].includes(item.signature))
    .map(item => ({ ...item, definition_md5: createHash("md5").update(normalize(item.definition)).digest("hex"), acl_values: item.acl.slice(1, -1).split(",").sort() }));
  if (helpers.length !== 2 || source.split("$held_status$").length !== 3) throw new Error("Held-status source contract changed");
  const required = {
    held_orders: ["id", "store_id", "shift_id", "status", "row_version", "updated_at", "bill_no", "total", "lines", "cart_discount", "cart_discount_type", "exchange_ref", "member_id", "coupon", "pending_request_id", "approval_snapshot_hash", "note"],
    sales: ["id", "store_id", "bill_number", "shift_id"],
    bookings: ["id", "store_id", "shift_id"]
  };
  const columns = schema.columns.filter(item => required[item.table_name]?.includes(item.column_name));
  if (columns.length !== Object.values(required).reduce((sum, list) => sum + list.length, 0)) throw new Error("Missing captured held-status columns");
  // Preserve decoded source bytes while distinguishing inert fingerprints from
  // actual DDL for existing canonical-source extractors.
  const json = value => "$held_metadata$" + JSON.stringify(value).replaceAll("CREATE OR REPLACE FUNCTION", "\\u0043REATE OR REPLACE FUNCTION") + "$held_metadata$::jsonb";
  return [
    "-- Read-only bounded Operations ticket reconciliation. No business record or existing grant is changed.",
    "-- Exact target/file approval is required before live application.",
    "-- BOUNDED_HELD_STATUS_BEGIN",
    "DO $held_status_upgrade$",
    "DECLARE",
    " expected constant jsonb := " + json(helpers) + ";",
    " required_columns constant jsonb := " + json(columns) + ";",
    " ddl constant text := $held_status_definition$" + source + "$held_status_definition$;",
    " entry jsonb;fn oid;name text;actual text;",
    "BEGIN",
    " IF current_user<>'postgres' THEN RAISE EXCEPTION 'HELD_STATUS_MIGRATION_OWNER';END IF;",
    " PERFORM set_config('search_path','pg_catalog,public',true);",
    " FOREACH name IN ARRAY ARRAY['held_orders','sales','bookings'] LOOP",
    "  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=name AND c.relkind='r' AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')",
    "   THEN RAISE EXCEPTION 'HELD_STATUS_TABLE_UNSUPPORTED';END IF;",
    " END LOOP;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(required_columns) LOOP",
    "  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||(entry->>'table_name'))",
    "   AND a.attname=entry->>'column_name' AND a.attnum>0 AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=entry->>'type' AND a.attnotnull=(entry->>'not_null')::boolean)",
    "   THEN RAISE EXCEPTION 'HELD_STATUS_COLUMN_UNSUPPORTED';END IF;",
    " END LOOP;",
    " IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.held_orders'::regclass AND i.indisprimary AND i.indisvalid AND i.indisready",
    "  AND i.indnkeyatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='id'))",
    " OR NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.bookings'::regclass AND i.indisprimary AND i.indisvalid AND i.indisready",
    "  AND i.indnkeyatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='id'))",
    " OR NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid='public.sales'::regclass",
    "  AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND a.amname='btree' AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='bill_number'))",
    " THEN RAISE EXCEPTION 'HELD_STATUS_LOOKUP_INDEX_UNSUPPORTED';END IF;",
    " FOR entry IN SELECT value FROM jsonb_array_elements(expected) LOOP",
    "  fn:=to_regprocedure('public.'||(entry->>'signature'));",
    "  IF fn IS NULL OR md5(replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)))<>entry->>'definition_md5'",
    "   OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn",
    "    AND pg_get_userbyid(p.proowner)=entry->>'owner' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=entry->'acl_values'",
    "    AND to_jsonb(p.proconfig)=entry->'config' AND p.prosecdef=(entry->>'definer')::boolean AND p.proisstrict=(entry->>'strict')::boolean",
    "    AND p.provolatile::text=entry->>'volatility' AND l.lanname=entry->>'language' AND pg_get_function_result(p.oid)=entry->>'returns'",
    "    AND p.prokind='f' AND NOT p.proleakproof AND p.prosupport=0 AND p.proparallel='u' AND p.procost=100 AND p.prorows=0)",
    "   THEN RAISE EXCEPTION 'HELD_STATUS_SOURCE_UNSUPPORTED';END IF;",
    " END LOOP;",
    " fn:=to_regprocedure('public." + SIGNATURE + "');",
    " IF fn IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn",
    "  AND replace(p.prosrc,chr(13)||chr(10),chr(10))=split_part(replace(ddl,chr(13)||chr(10),chr(10)),'$held_status$',2) AND pg_get_userbyid(p.proowner)='postgres'",
    "  AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='s' AND p.prorettype='jsonb'::regtype AND p.prokind='f'",
    "  AND NOT p.proleakproof AND p.prosupport=0 AND p.proparallel='u' AND p.procost=100 AND p.prorows=0",
    "  AND p.proconfig=ARRAY['search_path=pg_catalog, public']",
    "  AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))",
    " THEN RAISE EXCEPTION 'HELD_STATUS_EXISTING_CHANGED';END IF;",
    " EXECUTE replace(ddl,chr(13)||chr(10),chr(10));",
    " REVOKE ALL ON FUNCTION public." + SIGNATURE + " FROM PUBLIC,anon,authenticated,service_role;",
    " GRANT EXECUTE ON FUNCTION public." + SIGNATURE + " TO service_role;",
    " SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure('public." + SIGNATURE + "');",
    " IF actual IS DISTINCT FROM split_part(replace(ddl,chr(13)||chr(10),chr(10)),'$held_status$',2) THEN RAISE EXCEPTION 'HELD_STATUS_READBACK';END IF;",
    "END;",
    "$held_status_upgrade$;",
    "-- BOUNDED_HELD_STATUS_END",
    ""
  ].join("\n");
}
module.exports = { MIGRATION, SIGNATURE, render };
if (require.main === module) {
  const file = path.join(root, "supabase/migrations", MIGRATION);
  if (!fs.existsSync(file)) throw new Error("Create this migration using Supabase CLI first");
  fs.writeFileSync(file, render(), "utf8");
  console.log("Prepared only " + path.relative(root, file));
}
