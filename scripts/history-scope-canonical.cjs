"use strict";
// Fresh-schema assembly only. Live application keeps its exact captured guards.
const { createHash } = require("node:crypto");
const START = "-- HISTORY_SCOPE82_BEGIN", END = "-- HISTORY_SCOPE82_END";
const bootstrapSignature = "pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)";
const pageSignature = "pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer)";
const canonicalBootstrapSource = "3853ee2700d9f117ab293f6f540f7b9d";
const md5 = text => createHash("md5").update(text).digest("hex");
function once(text, before, after) {
  if (text.split(before).length !== 2) throw new Error("The reviewed history-scope assembly anchor changed.");
  return text.replace(before, () => after);
}
function historyScopeCanonicalBlock(migration) {
  if (migration.split(START).length !== 2 || migration.split(END).length !== 2) throw new Error("The history scope migration boundary changed.");
  let block = START + migration.split(START)[1].split(END)[0] + END;
  const expected = scopeRoutineList(block, "expected");
  const desired = scopeRoutineList(block, "desired");
  const bootstrap = expected.routines.find(entry => entry.signature === bootstrapSignature);
  const bootstrapTarget = desired.routines.find(entry => entry.signature === bootstrapSignature);
  const pageTarget = desired.routines.find(entry => entry.signature === pageSignature);
  const oldBootstrapTargetHash = bootstrapTarget.definition_md5;
  // Keep the canonical bootstrap's existing catalogue, member privacy, voucher
  // and search-path behavior when composing the reviewed history projection.
  for (const entry of [bootstrap, bootstrapTarget]) {
    entry.config = ["search_path=public, pg_temp"];
    entry.definition = [
      ["SET search_path TO 'public'\n", "SET search_path TO 'public', 'pg_temp'\n"],
      ['FROM public."issued_vouchers" x WHERE (x.store_id::text=p_branch_id)', 'FROM public."issued_vouchers" x WHERE (true)'],
      ["ARRAY['auth_user_id']::text[]", "ARRAY['auth_user_id','is_verified','verified_at','verified_channel','membership_member_id','membership_revision','membership_status']::text[]"],
      ['EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND public.product_available_in_catalogue(p.id,p_branch_id))', "x.product_id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))"],
      ["public.product_available_in_catalogue(x.id,p_branch_id)", "x.id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))"],
    ].reduce((definition, [before, after]) => once(definition, before, after), entry.definition);
    entry.definition_md5 = md5(entry.definition);
  }
  if (bootstrap.definition_md5 !== canonicalBootstrapSource) throw new Error("The reviewed canonical bootstrap source changed.");
  pageTarget.definition = once(pageTarget.definition, oldBootstrapTargetHash, bootstrapTarget.definition_md5);
  pageTarget.definition_md5 = md5(pageTarget.definition);
  const canonicalPredecessors = new Map([
    ["pos_sync_counts_scoped(text,text,text,integer)", "cc0d68802ee50a57c8e6e79e92d23edb"],
    ["pos_sync_counts(text,text,text,integer)", "0b30a999e8aec9f544e67e1db25eed40"],
    [pageSignature, "539354d149d2a8a5b08e1ae0555ad086"],
    ["pos_sync_pull(text,text,text,bigint,integer)", "c82bcf77174fbf20db5c983971ff38b4"],
  ]);
  for (const entry of expected.routines) {
    const alternate = canonicalPredecessors.get(entry.signature);
    if (alternate) entry.canonical_alternate_md5 = [...new Set([...(entry.canonical_alternate_md5 ?? []), alternate])];
  }
  block = replaceScopeRoutineList(replaceScopeRoutineList(block, expected), desired);
  block = once(block,
    "IF md5(definition)<>entry->>'definition_md5' AND (target IS NULL OR md5(definition)<>target->>'definition_md5') THEN",
    "IF md5(definition)<>entry->>'definition_md5' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(entry->'canonical_alternate_md5','[]'::jsonb)) alias(value) WHERE alias.value=md5(definition)) AND (target IS NULL OR md5(definition)<>target->>'definition_md5') THEN");
  block = once(block,
    "AND pg_get_userbyid(p.proowner)=entry->>'owner' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=entry->'acl_values'",
    "AND pg_get_userbyid(p.proowner)=entry->>'owner' AND ((SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=entry->'acl_values' OR (entry->>'signature'='change_history_immutable()' AND (p.proacl IS NULL OR (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))))");
  block = once(block,
    "IF target IS NOT NULL THEN IF md5(definition)=entry->>'definition_md5' THEN",
    "IF target IS NOT NULL THEN IF md5(definition)=entry->>'definition_md5' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(entry->'canonical_alternate_md5','[]'::jsonb)) alias(value) WHERE alias.value=md5(definition)) THEN");
  // A complete known component may already exist during a full canonical replay
  // after the legacy definitions above it were regenerated. Never accept a
  // partial/changed helper or RPC; their exact source/metadata checks still run.
  block = once(block,
    "IF NOT ((seen_old=7 AND seen_new=0 AND added=0) OR (seen_old=0 AND seen_new=7 AND added=4)) THEN",
    "IF NOT ((seen_old=7 AND seen_new=0 AND added IN (0,4)) OR (seen_old=0 AND seen_new=7 AND added=4)) THEN");
  return block;
}
function scopeRoutineList(sql, name) {
  const source = sql.split("\n").find(line => line.startsWith(` ${name} constant jsonb := $history_scope_data$`));
  const [prefix, values, suffix] = source?.split("$history_scope_data$") ?? [];
  if (!prefix || !values || suffix !== "::jsonb;") throw new Error("The reviewed history-scope metadata boundary changed.");
  return { source, prefix, suffix, routines: JSON.parse(values) };
}
function replaceScopeRoutineList(block, { source, prefix, suffix, routines }) {
  const json = JSON.stringify(routines).replaceAll("CREATE OR REPLACE FUNCTION", "\\u0043REATE OR REPLACE FUNCTION");
  return once(block, source, prefix + "$history_scope_data$" + json + "$history_scope_data$" + suffix);
}
function withHistoryScopeContract(schema, migration) {
  if (schema.includes(START)) {
    if (schema.split(START).length !== 2 || schema.split(END).length !== 2 || schema.indexOf(END) < schema.indexOf(START)) throw new Error("The canonical history scope boundary changed.");
    schema = schema.slice(0, schema.indexOf(START)).trimEnd() + "\n\n" + schema.slice(schema.indexOf(END) + END.length).trimStart();
  } else if (schema.includes(END)) throw new Error("The canonical history scope boundary changed.");
  const hardening = schema.lastIndexOf("-- Final public-schema privilege hardening");
  if (hardening < 0) throw new Error("Final privilege hardening must follow history scope assembly.");
  return schema.slice(0, hardening).trimEnd() + "\n\n" + historyScopeCanonicalBlock(migration) + "\n\n" + schema.slice(hardening).trimStart().trimEnd() + "\n";
}
function boundedHeldStatusCanonicalBlock(migration) {
  const begin = "-- BOUNDED_HELD_STATUS_BEGIN", end = "-- BOUNDED_HELD_STATUS_END";
  if (migration.split(begin).length !== 2 || migration.split(end).length !== 2) throw new Error("The held-status migration boundary changed.");
  return begin + migration.split(begin)[1].split(end)[0] + end;
}
function withBoundedHeldStatusContract(schema, migration) {
  const begin = "-- BOUNDED_HELD_STATUS_BEGIN", end = "-- BOUNDED_HELD_STATUS_END";
  if (schema.includes(begin)) {
    if (schema.split(begin).length !== 2 || schema.split(end).length !== 2 || schema.indexOf(end) < schema.indexOf(begin)) throw new Error("The canonical held-status boundary changed.");
    schema = schema.slice(0, schema.indexOf(begin)).trimEnd() + "\n\n" + schema.slice(schema.indexOf(end) + end.length).trimStart();
  } else if (schema.includes(end)) throw new Error("The canonical held-status boundary changed.");
  const hardening = schema.lastIndexOf("-- Final public-schema privilege hardening");
  if (hardening < 0) throw new Error("Final privilege hardening must follow held-status assembly.");
  return schema.slice(0, hardening).trimEnd() + "\n\n" + boundedHeldStatusCanonicalBlock(migration) + "\n\n" + schema.slice(hardening).trimStart().trimEnd() + "\n";
}
const transportBegin = "-- SCOPED_HISTORY_TRANSPORT_BEGIN", transportEnd = "-- SCOPED_HISTORY_TRANSPORT_END";
function scopedHistoryTransportCanonicalBlock(migration, historyScope) {
  const sql = migration.replaceAll("\r\n", "\n");
  const anchor = /^( dependencies constant jsonb := \$history_transport_data\$)(\[.*\])(\$history_transport_data\$::jsonb;)$/m;
  const dependency = anchor.exec(sql);
  const known = scopeRoutineList(historyScope.replaceAll("\r\n", "\n"), "expected").routines;
  const desired = scopeRoutineList(historyScope.replaceAll("\r\n", "\n"), "desired").routines;
  if (!dependency || sql.split("DO $history_transport_upgrade$").length !== 2 ||
      sql.split("\n$history_transport_upgrade$;").length !== 2)
    throw new Error("The scoped history transport assembly boundary changed.");
  const dependencies = JSON.parse(dependency[2]);
  for (const entry of dependencies) {
    const predecessor = known.find(routine => routine.signature === entry.signature);
    const canonical = desired.find(routine => routine.signature === entry.signature);
    const hashes = [predecessor.definition_md5, ...(predecessor.canonical_alternate_md5 ?? [])];
    if (canonical) hashes.push(canonical.definition_md5);
    entry.definition_hashes = [...new Set([...entry.definition_hashes, ...hashes])];
    entry.config = predecessor.config;
  }
  let block = once(sql, dependency[0], dependency[1] + JSON.stringify(dependencies) + dependency[3]);
  // The fresh-schema privilege hardener has the already-reviewed immutable
  // function ACL forms. The exact hosted artifact accepts only captured ACLs.
  block = once(block,
    "AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=entry->'acl_values'",
    "AND ((SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=entry->'acl_values' OR (entry->>'signature'='change_history_immutable()' AND (p.proacl IS NULL OR (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))))");
  return transportBegin + "\n" + block.trim() + "\n" + transportEnd;
}
function withScopedHistoryTransportContract(schema, migration) {
  if (schema.includes(transportBegin)) {
    if (schema.split(transportBegin).length !== 2 || schema.split(transportEnd).length !== 2 ||
        schema.indexOf(transportEnd) < schema.indexOf(transportBegin)) throw new Error("The canonical scoped history transport boundary changed.");
    schema = schema.slice(0, schema.indexOf(transportBegin)).trimEnd() + "\n\n" + schema.slice(schema.indexOf(transportEnd) + transportEnd.length).trimStart();
  } else if (schema.includes(transportEnd)) throw new Error("The canonical scoped history transport boundary changed.");
  const hardening = schema.lastIndexOf("-- Final public-schema privilege hardening");
  const historyStart = schema.indexOf(START), historyEnd = schema.indexOf(END);
  if (hardening < 0 || historyStart < 0 || historyEnd <= historyStart || historyEnd >= hardening)
    throw new Error("The scoped history definitions must precede the new transport and final privilege hardening.");
  const block = scopedHistoryTransportCanonicalBlock(migration, schema.slice(historyStart, historyEnd));
  return schema.slice(0, hardening).trimEnd() + "\n\n" + block + "\n\n" + schema.slice(hardening).trimStart().trimEnd() + "\n";
}
module.exports = { historyScopeCanonicalBlock, withHistoryScopeContract, boundedHeldStatusCanonicalBlock, withBoundedHeldStatusContract,
  scopedHistoryTransportCanonicalBlock, withScopedHistoryTransportContract };
