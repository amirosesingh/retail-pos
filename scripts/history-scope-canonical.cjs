"use strict";
// Fresh-schema assembly only. Live application keeps its exact captured guards.
const START = "-- HISTORY_SCOPE82_BEGIN", END = "-- HISTORY_SCOPE82_END";
function once(text, before, after) {
  if (text.split(before).length !== 2) throw new Error("The reviewed history-scope assembly anchor changed.");
  return text.replace(before, after);
}
function historyScopeCanonicalBlock(migration) {
  if (migration.split(START).length !== 2 || migration.split(END).length !== 2) throw new Error("The history scope migration boundary changed.");
  let block = START + migration.split(START)[1].split(END)[0] + END;
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
  const reviewed = /^ expected constant jsonb := \$history_scope_data\$(\[.*\])\$history_scope_data\$::jsonb;$/m.exec(historyScope.replaceAll("\r\n", "\n"));
  if (!dependency || !reviewed || sql.split("DO $history_transport_upgrade$").length !== 2 ||
      sql.split("\n$history_transport_upgrade$;").length !== 2)
    throw new Error("The scoped history transport assembly boundary changed.");
  const known = JSON.parse(reviewed[1]);
  const dependencies = JSON.parse(dependency[2]);
  for (const entry of dependencies) {
    const variants = known.find(routine => routine.signature === entry.signature)?.canonical_alternate_md5 ?? [];
    entry.definition_hashes = [...new Set([...entry.definition_hashes, ...variants])];
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
