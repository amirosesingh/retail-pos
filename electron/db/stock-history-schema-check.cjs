// Trusted stock-history physical-object catalog. Both the prepared upgrade and
// runtime capability compare this evidence; table names alone are insufficient.
const catalogSql=`
WITH objects AS(
 SELECT t.name table_name,N'check' kind,c.name object_name,CONCAT(c.is_disabled,N'|',c.is_not_trusted,N'|',c.definition) definition
 FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'default',c.name,c.definition FROM sys.tables t JOIN sys.default_constraints c ON c.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'index',i.name,CONCAT(i.is_unique,N'|',i.is_primary_key,N'|',i.type,N'|',i.is_disabled,N'|',COALESCE(i.filter_definition,N''))
 FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'index-column',CONCAT(i.name,N':',c.name),CONCAT(ic.key_ordinal,N'|',ic.is_descending_key,N'|',ic.is_included_column)
 FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0
 JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'foreign-key',f.name,CONCAT(f.is_disabled,N'|',f.is_not_trusted,N'|',f.delete_referential_action,N'|',f.update_referential_action)
 FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'foreign-key-column',CONCAT(f.name,N':',c.name),CONCAT(fc.constraint_column_id,N'|',OBJECT_SCHEMA_NAME(fc.referenced_object_id),N'.',OBJECT_NAME(fc.referenced_object_id),N'|',r.name)
 FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
 JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns r ON r.object_id=fc.referenced_object_id AND r.column_id=fc.referenced_column_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'trigger',tr.name,CONCAT(tr.is_disabled,N'|',REPLACE(m.definition,CHAR(13)+CHAR(10),CHAR(10)))
 FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id JOIN sys.sql_modules m ON m.object_id=tr.object_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'stock_history_heads',N'stock_history_baselines',N'stock_history_openings',N'stock_history_movements',N'stock_history_source_cohorts')
 UNION ALL
 SELECT t.name,N'column-collation',c.name,c.collation_name
 FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
 WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name=N'stock_history_source_cohorts' AND c.name IN(N'store_id',N'terminal_id')
)
SELECT table_name,kind,object_name,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(nvarchar(max),definition)),2) object_hash
FROM objects`;
const rowKey=row=>JSON.stringify([row.table_name,row.kind,row.object_name,String(row.object_hash).toUpperCase()]);
function physicalObjects(rows,expected){return expected.length>0&&rows.map(rowKey).sort().join('\n')===expected.map(rowKey).sort().join('\n');}
module.exports={catalogSql,physicalObjects};
