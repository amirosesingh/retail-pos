-- Run on the authorized staging Supabase Postgres database. This single SELECT
-- inventories installed metadata without reading application rows or sequence
-- values. Definitions, defaults, predicates and trigger arguments are omitted
-- because they can contain sensitive literals. Inventory is not proof of access
-- or delivery, and publisher names alone are not proof that a write is covered.
WITH schemas AS (
  SELECT oid, nspname AS schema_name
  FROM pg_catalog.pg_namespace
  WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), relations AS (
  SELECT c.oid, s.schema_name, c.relname AS relation_name, c.relkind,
         c.relispartition, c.relreplident, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN schemas s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'f', 'v', 'm')
), columns AS (
  SELECT r.schema_name, r.relation_name, a.attnum AS ordinal,
         a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null, a.atthasdef AS has_default_or_generation,
         a.attidentity AS identity_mode, a.attgenerated AS generation_mode
  FROM relations r
  JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped
), indexes AS (
  SELECT r.schema_name, r.relation_name, ic.relname AS index_name,
         am.amname AS access_method, i.indisprimary AS is_primary,
         i.indisunique AS is_unique, i.indisvalid AS is_valid,
         i.indisready AS is_ready, i.indisreplident AS is_replica_identity,
         i.indpred IS NOT NULL AS is_partial,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinal)
           LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
           WHERE k.ordinal <= i.indnkeyatts
           ORDER BY k.ordinal
         ) AS key_columns_with_null_for_expressions,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinal)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
           WHERE k.ordinal > i.indnkeyatts
           ORDER BY k.ordinal
         ) AS included_columns
  FROM relations r
  JOIN pg_catalog.pg_index i ON i.indrelid = r.oid
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_catalog.pg_am am ON am.oid = ic.relam
), foreign_keys AS (
  SELECT r.schema_name, r.relation_name, fk.conname AS constraint_name,
         k.ordinal AS key_ordinal, a.attname AS column_name,
         ns.nspname AS referenced_schema, rc.relname AS referenced_relation,
         ra.attname AS referenced_column, fk.convalidated AS is_validated,
         fk.condeferrable AS is_deferrable, fk.condeferred AS initially_deferred,
         fk.confupdtype AS update_action, fk.confdeltype AS delete_action
  FROM relations r
  JOIN pg_catalog.pg_constraint fk ON fk.conrelid = r.oid AND fk.contype = 'f'
  JOIN pg_catalog.pg_class rc ON rc.oid = fk.confrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = rc.relnamespace
  CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS k(attnum, ref_attnum, ordinal)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
  JOIN pg_catalog.pg_attribute ra ON ra.attrelid = rc.oid AND ra.attnum = k.ref_attnum
), inheritance AS (
  SELECT child.schema_name, child.relation_name, parent_ns.nspname AS parent_schema,
         parent.relname AS parent_relation, child.relispartition AS is_partition,
         part.partstrat AS parent_partition_strategy
  FROM relations child
  JOIN pg_catalog.pg_inherits link ON link.inhrelid = child.oid
  JOIN pg_catalog.pg_class parent ON parent.oid = link.inhparent
  JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
  LEFT JOIN pg_catalog.pg_partitioned_table part ON part.partrelid = parent.oid
), partition_keys AS (
  SELECT r.schema_name, r.relation_name, p.partstrat AS partition_strategy,
         k.ordinal AS key_ordinal, a.attname AS column_name
  FROM relations r
  JOIN pg_catalog.pg_partitioned_table p ON p.partrelid = r.oid
  CROSS JOIN LATERAL unnest(p.partattrs) WITH ORDINALITY AS k(attnum, ordinal)
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
), view_dependencies AS (
  SELECT DISTINCT v.schema_name, v.relation_name, ns.nspname AS referenced_schema,
         source.relname AS referenced_relation
  FROM relations v
  JOIN pg_catalog.pg_rewrite rule ON rule.ev_class = v.oid AND rule.rulename = '_RETURN'
  JOIN pg_catalog.pg_depend d ON d.objid = rule.oid
    AND d.classid = 'pg_catalog.pg_rewrite'::regclass
    AND d.refclassid = 'pg_catalog.pg_class'::regclass
  JOIN pg_catalog.pg_class source ON source.oid = d.refobjid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = source.relnamespace
  WHERE v.relkind IN ('v', 'm') AND source.oid <> v.oid
), triggers AS (
  SELECT r.schema_name, r.relation_name, t.tgname AS trigger_name,
         t.tgenabled AS firing_mode, t.tgtype AS event_type_mask,
         t.tgqual IS NOT NULL AS has_condition,
         ns.nspname AS routine_schema, p.proname AS routine_name
  FROM relations r
  JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
  JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
), sync_routines AS (
  SELECT s.schema_name, p.proname AS routine_name,
         pg_catalog.oidvectortypes(p.proargtypes) AS argument_types,
         p.prosecdef AS security_definer
  FROM pg_catalog.pg_proc p
  JOIN schemas s ON s.oid = p.pronamespace
  WHERE p.proname ~ '^(pos_sync_|sync_feed_)'
    OR (s.schema_name = 'realtime' AND p.proname IN ('send', 'broadcast_changes'))
), realtime_policies AS (
  SELECT p.polname AS policy_name, p.polcmd AS command, p.polpermissive AS is_permissive
  FROM relations r
  JOIN pg_catalog.pg_policy p ON p.polrelid = r.oid
  WHERE r.schema_name = 'realtime' AND r.relation_name = 'messages'
), publication_membership AS (
  SELECT pubname AS publication_name, schemaname AS schema_name, tablename AS relation_name
  FROM pg_catalog.pg_publication_tables
  WHERE schemaname <> 'information_schema' AND schemaname !~ '^pg_'
), publications AS (
  SELECT pubname AS publication_name, puballtables AS includes_all_tables,
         pubinsert AS publishes_insert, pubupdate AS publishes_update,
         pubdelete AS publishes_delete, pubtruncate AS publishes_truncate,
         pubviaroot AS publishes_via_partition_root
  FROM pg_catalog.pg_publication
)
SELECT jsonb_build_object(
  'server_version_num', current_setting('server_version_num')::integer,
  'wal_level', current_setting('wal_level'),
  'schemas', COALESCE((SELECT jsonb_agg(schema_name ORDER BY schema_name) FROM schemas), '[]'),
  'relations', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'oid' ORDER BY schema_name, relation_name) FROM relations r), '[]'),
  'columns', COALESCE((SELECT jsonb_agg(c ORDER BY schema_name, relation_name, ordinal) FROM columns c), '[]'),
  'indexes', COALESCE((SELECT jsonb_agg(i ORDER BY schema_name, relation_name, index_name) FROM indexes i), '[]'),
  'foreign_keys', COALESCE((SELECT jsonb_agg(f ORDER BY schema_name, relation_name, constraint_name, key_ordinal) FROM foreign_keys f), '[]'),
  'inheritance_and_partitions', COALESCE((SELECT jsonb_agg(i ORDER BY schema_name, relation_name, parent_schema, parent_relation) FROM inheritance i), '[]'),
  'partition_keys', COALESCE((SELECT jsonb_agg(p ORDER BY schema_name, relation_name, key_ordinal) FROM partition_keys p), '[]'),
  'view_dependencies', COALESCE((SELECT jsonb_agg(v ORDER BY schema_name, relation_name, referenced_schema, referenced_relation) FROM view_dependencies v), '[]'),
  'non_internal_triggers', COALESCE((SELECT jsonb_agg(t ORDER BY schema_name, relation_name, trigger_name) FROM triggers t), '[]'),
  'sync_routines', COALESCE((SELECT jsonb_agg(p ORDER BY schema_name, routine_name, argument_types) FROM sync_routines p), '[]'),
  'realtime_message_policies', COALESCE((SELECT jsonb_agg(p ORDER BY policy_name) FROM realtime_policies p), '[]'),
  'publications', COALESCE((SELECT jsonb_agg(p ORDER BY publication_name) FROM publications p), '[]'),
  'publication_membership', COALESCE((SELECT jsonb_agg(p ORDER BY publication_name, schema_name, relation_name) FROM publication_membership p), '[]')
) AS pos_sync_postgres_inventory;
