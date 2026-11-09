/*
  Read-only POS synchronization inventory for SQL Server.
  Connect to the selected POS database and run this script with a read-only
  login with VIEW DEFINITION in that database and SELECT on
  sys.sql_expression_dependencies. Export each result set for comparison with
  the sync registry and Supabase catalogs. Restricted metadata visibility can
  leave the inventory incomplete.

  This script reads metadata only. It works before capture is enabled and does
  not read POS records, capture payloads, or credentials.
*/
SET NOCOUNT ON;

SELECT
    DB_NAME() AS database_name,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS product_version,
    CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS edition,
    CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engine_edition,
    databases.is_cdc_enabled,
    CONVERT(bit, CASE WHEN tracking.database_id IS NULL THEN 0 ELSE 1 END) AS is_ct_enabled,
    tracking.retention_period AS ct_retention_period,
    tracking.retention_period_units_desc AS ct_retention_unit,
    tracking.is_auto_cleanup_on AS is_ct_auto_cleanup_on,
    CONVERT(varchar(20), CHANGE_TRACKING_CURRENT_VERSION()) AS ct_current_version,
    databases.snapshot_isolation_state_desc,
    databases.is_read_committed_snapshot_on,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION') AS can_view_database_definition
FROM sys.databases AS databases
LEFT JOIN sys.change_tracking_databases AS tracking ON tracking.database_id = databases.database_id
WHERE databases.database_id = DB_ID();

SELECT
    schemas.name AS schema_name,
    tables.name AS table_name,
    tables.is_ms_shipped,
    tables.temporal_type_desc,
    tables.is_memory_optimized,
    tables.is_tracked_by_cdc,
    CONVERT(bit, CASE WHEN tracking.object_id IS NULL THEN 0 ELSE 1 END) AS has_ct_journal,
    tracking.is_track_columns_updated_on AS is_ct_column_tracking_on,
    CONVERT(varchar(20), tracking.min_valid_version) AS ct_min_valid_version
FROM sys.tables AS tables
JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
LEFT JOIN sys.change_tracking_tables AS tracking ON tracking.object_id = tables.object_id
ORDER BY schemas.name, tables.name;

SELECT
    schemas.name AS schema_name,
    objects.name AS object_name,
    objects.type_desc AS object_type,
    columns.column_id,
    columns.name AS column_name,
    SCHEMA_NAME(types.schema_id) AS type_schema,
    types.name AS data_type,
    columns.max_length AS max_length_bytes,
    columns.precision,
    columns.scale,
    columns.collation_name,
    columns.is_nullable,
    columns.is_identity,
    columns.is_computed
FROM sys.objects AS objects
JOIN sys.schemas AS schemas ON schemas.schema_id = objects.schema_id
JOIN sys.columns AS columns ON columns.object_id = objects.object_id
JOIN sys.types AS types ON types.user_type_id = columns.user_type_id
WHERE objects.type IN ('U', 'V')
ORDER BY schemas.name, objects.name, columns.column_id;

SELECT
    schemas.name AS schema_name,
    objects.name AS object_name,
    objects.type_desc AS object_type,
    indexes.name AS index_name,
    indexes.type_desc AS index_type,
    indexes.is_primary_key,
    indexes.is_unique,
    indexes.is_unique_constraint,
    indexes.is_disabled,
    indexes.has_filter,
    columns.name AS column_name,
    index_columns.key_ordinal,
    index_columns.is_descending_key,
    index_columns.is_included_column,
    index_columns.partition_ordinal
FROM sys.objects AS objects
JOIN sys.schemas AS schemas ON schemas.schema_id = objects.schema_id
JOIN sys.indexes AS indexes ON indexes.object_id = objects.object_id
JOIN sys.index_columns AS index_columns
    ON index_columns.object_id = indexes.object_id AND index_columns.index_id = indexes.index_id
JOIN sys.columns AS columns
    ON columns.object_id = index_columns.object_id AND columns.column_id = index_columns.column_id
WHERE objects.type IN ('U', 'V') AND indexes.index_id > 0 AND indexes.is_hypothetical = 0
ORDER BY schemas.name, objects.name, indexes.name, index_columns.index_column_id;

SELECT
    SCHEMA_NAME(source_table.schema_id) AS source_schema,
    source_table.name AS source_table,
    foreign_keys.name AS foreign_key_name,
    foreign_key_columns.constraint_column_id AS key_ordinal,
    source_column.name AS source_column,
    SCHEMA_NAME(target_table.schema_id) AS target_schema,
    target_table.name AS target_table,
    target_column.name AS target_column,
    foreign_keys.update_referential_action_desc,
    foreign_keys.delete_referential_action_desc,
    foreign_keys.is_disabled,
    foreign_keys.is_not_trusted
FROM sys.foreign_keys AS foreign_keys
JOIN sys.foreign_key_columns AS foreign_key_columns ON foreign_key_columns.constraint_object_id = foreign_keys.object_id
JOIN sys.tables AS source_table ON source_table.object_id = foreign_key_columns.parent_object_id
JOIN sys.columns AS source_column
    ON source_column.object_id = source_table.object_id AND source_column.column_id = foreign_key_columns.parent_column_id
JOIN sys.tables AS target_table ON target_table.object_id = foreign_key_columns.referenced_object_id
JOIN sys.columns AS target_column
    ON target_column.object_id = target_table.object_id AND target_column.column_id = foreign_key_columns.referenced_column_id
ORDER BY source_schema, source_table, foreign_keys.name, foreign_key_columns.constraint_column_id;

SELECT
    SCHEMA_NAME(tables.schema_id) AS schema_name,
    tables.name AS table_name,
    partition_schemes.name AS partition_scheme,
    partition_functions.name AS partition_function,
    partitions.partition_number,
    partitions.data_compression_desc
FROM sys.tables AS tables
JOIN sys.partitions AS partitions ON partitions.object_id = tables.object_id AND partitions.index_id IN (0, 1)
JOIN sys.indexes AS indexes ON indexes.object_id = tables.object_id AND indexes.index_id = partitions.index_id
JOIN sys.partition_schemes AS partition_schemes ON partition_schemes.data_space_id = indexes.data_space_id
JOIN sys.partition_functions AS partition_functions ON partition_functions.function_id = partition_schemes.function_id
ORDER BY schema_name, tables.name, partitions.partition_number;

SELECT DISTINCT
    SCHEMA_NAME(views.schema_id) AS view_schema,
    views.name AS view_name,
    views.is_ms_shipped,
    dependencies.referenced_server_name,
    dependencies.referenced_database_name,
    COALESCE(dependencies.referenced_schema_name, OBJECT_SCHEMA_NAME(dependencies.referenced_id)) AS referenced_schema,
    dependencies.referenced_entity_name
FROM sys.views AS views
LEFT JOIN sys.sql_expression_dependencies AS dependencies ON dependencies.referencing_id = views.object_id
ORDER BY view_schema, view_name, referenced_server_name, referenced_database_name, referenced_schema, referenced_entity_name;

-- Save this final result as JSON for scripts/verify-sync-registry.cjs --installed.
SELECT (
    SELECT
        CONVERT(int, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION')) AS can_view_database_definition,
        JSON_QUERY((
            SELECT SCHEMA_NAME(objects.schema_id) AS schema_name, objects.name AS relation_name,
                RTRIM(objects.type) AS relation_type
            FROM sys.objects AS objects
            WHERE objects.type IN ('U', 'V') AND objects.is_ms_shipped = 0
            ORDER BY schema_name, relation_name
            FOR JSON PATH
        )) AS relations,
        JSON_QUERY((
            SELECT SCHEMA_NAME(objects.schema_id) AS schema_name, objects.name AS relation_name,
                columns.name AS column_name
            FROM sys.objects AS objects
            JOIN sys.columns AS columns ON columns.object_id = objects.object_id
            WHERE objects.type IN ('U', 'V') AND objects.is_ms_shipped = 0
            ORDER BY schema_name, relation_name, columns.column_id
            FOR JSON PATH
        )) AS columns
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS pos_sync_sqlserver_inventory;
