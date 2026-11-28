"use strict";
// Packaging/test metadata only. No operator connection is opened here.
const assert = require("node:assert/strict");
const {createHash}=require('node:crypto');
const { canonical, structuralNewlines } = require("./existing-local-upgrade.cjs");
const literal = value => "N'" + value.replaceAll("'", "''") + "'";
const fields = {
  objects: "table_name:s,type:s,memory_optimized:i,temporal_type:i,tracked:i,track_columns:i",
  columns: "table_name:s,name:s,type_schema:s,type_name:s,max_length:i,precision:i,scale:i,nullable:i,identity:i,computed:i,collation:s,default_name:s,default_definition:s,computed_definition:s,persisted:i,ansi_padded:i,rowguid:i,sparse:i,column_set:i,filestream:i,hidden:i,generated:i,identity_seed:s,identity_increment:s",
  indexes: "table_name:s,name:s,type:i,unique_key:i,primary_key:i,unique_constraint:i,disabled:i,hypothetical:i,ignore_duplicate:i,has_filter:i,filter:s,padded:i,fill_factor:i,row_locks:i,page_locks:i",
  indexColumns: "table_name:s,index_name:s,column_name:s,ordinal:i,descending_key:i,included:i,partition_ordinal:i",
  checks: "table_name:s,name:s,disabled:i,untrusted:i,replication:i,definition:s",
  foreignKeys: "table_name:s,name:s,referenced_schema:s,referenced_table:s,disabled:i,untrusted:i,replication:i,delete_action:i,update_action:i",
  foreignColumns: "table_name:s,name:s,ordinal:i,column_name:s,referenced_column:s",
  triggers: "table_name:s,name:s,type:s,disabled:i,instead:i,replication:i,ansi_nulls:i,quoted_identifier:i,definition:s",
  properties: "table_name:s,column_name:s,name:s,value_type:s,value:s",
};
const orderKeys={objects:['table_name'],columns:['table_name','name'],indexes:['table_name','name'],indexColumns:['table_name','index_name','ordinal','included','column_name','partition_ordinal'],checks:['table_name','name'],foreignKeys:['table_name','name'],foreignColumns:['table_name','name','ordinal'],triggers:['table_name','name'],properties:['table_name','column_name','name']};
const fingerprintAlgorithm='SHA256_SQL_JSON_UTF16LE_V1';
const definitionFields={columns:['default_definition','computed_definition'],indexes:['filter'],checks:['definition'],triggers:['definition']};
const primaryName = "CASE WHEN kc.is_system_named=1 THEN CASE WHEN i.is_primary_key=1 THEN N'$SYSTEM_PRIMARY' ELSE N'$SYSTEM_UNIQUE' END ELSE i.name END";
const rawDefinition = value => value;
// Opt-in distribution manifests recognize SQL Server-generated names by their
// complete key mapping, not the instance-specific suffix. Definitions, trust,
// actions, columns and row counts remain part of the exact fingerprint.
function metadataOrder(manifest, name) {
  return manifest.selectors.normalizeSystemNames
    ? fields[name].split(',').map(field => field.split(':')[0])
    : orderKeys[name];
}
function queries(selectors, expectedColumns=false) {
  assert(selectors && Array.isArray(selectors.tables) && Array.isArray(selectors.columns ?? []));
  const names = selectors.tables, only = selectors.columns ?? [], ignore = selectors.ignoreColumns ?? [];
  for (const name of [...names, ...only.map(c => c.table), ...ignore.map(c => c.table)]) assert(/^[a-z][a-z0-9_]{0,127}$/.test(name));
  for (const item of [...only, ...ignore]) assert(/^[a-z][a-z0-9_]{0,127}$/.test(item.column));
  const tableFilter = `t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(${names.length ? names.map(literal).join(",") : "N''"})`;
  const columnsFilter = `t.schema_id=SCHEMA_ID(N'dbo') AND ((${tableFilter})${only.map(c => ` OR (t.name=${literal(c.table)} AND c.name=${literal(c.column)})`).join("")})${ignore.map(c => ` AND NOT(t.name=${literal(c.table)} AND c.name=${literal(c.column)})`).join("")}`;
  const tables = "FROM sys.tables t";
  const indexName = selectors.normalizeSystemNames
    ? `CASE WHEN kc.is_system_named=1 THEN CASE WHEN i.is_primary_key=1 THEN N'$SYSTEM_PRIMARY:' ELSE N'$SYSTEM_UNIQUE:' END + COALESCE((SELECT N'|'+sc.name+N':'+CONVERT(nvarchar(10),sic.key_ordinal)+N':'+CONVERT(nvarchar(10),sic.is_included_column) FROM sys.index_columns sic JOIN sys.columns sc ON sc.object_id=sic.object_id AND sc.column_id=sic.column_id WHERE sic.object_id=i.object_id AND sic.index_id=i.index_id ORDER BY sic.key_ordinal,sic.is_included_column,sc.name COLLATE Latin1_General_100_BIN2 FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),N'') ELSE i.name END`
    : primaryName;
  const foreignName = selectors.normalizeSystemNames
    ? `CASE WHEN f.is_system_named=1 THEN N'$SYSTEM_FOREIGN:'+OBJECT_SCHEMA_NAME(f.referenced_object_id)+N'.'+OBJECT_NAME(f.referenced_object_id)+COALESCE((SELECT N'|'+pc.name+N'>'+rc.name FROM sys.foreign_key_columns fkc JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id WHERE fkc.constraint_object_id=f.object_id ORDER BY fkc.constraint_column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),N'') ELSE f.name END`
    : 'f.name';
  const checkName = selectors.normalizeSystemNames
    ? "CASE WHEN c.is_system_named=1 THEN N'$SYSTEM_CHECK' ELSE c.name END"
    : 'c.name';
  return {
    objects: `SELECT t.name table_name,o.type,CONVERT(int,t.is_memory_optimized) memory_optimized,t.temporal_type,CASE WHEN ct.object_id IS NULL THEN 0 ELSE 1 END tracked,CONVERT(int,ct.is_track_columns_updated_on) track_columns ${tables} JOIN sys.objects o ON o.object_id=t.object_id LEFT JOIN sys.change_tracking_tables ct ON ct.object_id=t.object_id WHERE ${tableFilter}`,
    columns: `SELECT t.name table_name,c.name,SCHEMA_NAME(ty.schema_id) type_schema,ty.name type_name,c.max_length,c.precision,c.scale,CONVERT(int,c.is_nullable) nullable,CONVERT(int,c.is_identity) [identity],CONVERT(int,c.is_computed) computed,
      ${expectedColumns?"CASE WHEN e.collation=N'$DATABASE_DEFAULT' AND c.collation_name=CONVERT(sysname,DATABASEPROPERTYEX(DB_NAME(),'Collation')) THEN N'$DATABASE_DEFAULT' ELSE c.collation_name END":"c.collation_name"} collation,
      CASE WHEN dc.is_system_named=1 THEN N'$SYSTEM_NAMED' ELSE dc.name END default_name,${rawDefinition("dc.definition")} default_definition,${rawDefinition("cc.definition")} computed_definition,CONVERT(int,cc.is_persisted) persisted,
      CONVERT(int,c.is_ansi_padded) ansi_padded,CONVERT(int,c.is_rowguidcol) rowguid,CONVERT(int,c.is_sparse) sparse,CONVERT(int,c.is_column_set) column_set,CONVERT(int,c.is_filestream) filestream,CONVERT(int,c.is_hidden) hidden,c.generated_always_type generated,
      CONVERT(nvarchar(100),ic.seed_value) identity_seed,CONVERT(nvarchar(100),ic.increment_value) identity_increment
      ${tables} JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
      ${expectedColumns?"LEFT JOIN @expectedColumns e ON e.table_name=t.name AND e.name=c.name":""} WHERE ${columnsFilter}`,
    indexes: `SELECT t.name table_name,${indexName} name,i.type,CONVERT(int,i.is_unique) unique_key,CONVERT(int,i.is_primary_key) primary_key,CONVERT(int,i.is_unique_constraint) unique_constraint,CONVERT(int,i.is_disabled) disabled,CONVERT(int,i.is_hypothetical) hypothetical,CONVERT(int,i.ignore_dup_key) ignore_duplicate,CONVERT(int,i.has_filter) has_filter,${rawDefinition("i.filter_definition")} filter,CONVERT(int,i.is_padded) padded,CONVERT(int,i.fill_factor) fill_factor,CONVERT(int,i.allow_row_locks) row_locks,CONVERT(int,i.allow_page_locks) page_locks
      ${tables} JOIN sys.indexes i ON i.object_id=t.object_id LEFT JOIN sys.key_constraints kc ON kc.parent_object_id=i.object_id AND kc.unique_index_id=i.index_id WHERE ${tableFilter} AND i.index_id>0`,
    indexColumns: `SELECT t.name table_name,${indexName} index_name,c.name column_name,ic.key_ordinal ordinal,CONVERT(int,ic.is_descending_key) descending_key,CONVERT(int,ic.is_included_column) included,ic.partition_ordinal
      ${tables} JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id LEFT JOIN sys.key_constraints kc ON kc.parent_object_id=i.object_id AND kc.unique_index_id=i.index_id WHERE ${tableFilter} AND i.index_id>0`,
    checks: `SELECT t.name table_name,${checkName}${selectors.normalizeSystemNames?' name':''},CONVERT(int,c.is_disabled) disabled,CONVERT(int,c.is_not_trusted) untrusted,CONVERT(int,c.is_not_for_replication) [replication],${rawDefinition("c.definition")} definition ${tables} JOIN sys.check_constraints c ON c.parent_object_id=t.object_id WHERE ${tableFilter}`,
    foreignKeys: `SELECT t.name table_name,${foreignName}${selectors.normalizeSystemNames?' name':''},SCHEMA_NAME(rt.schema_id) referenced_schema,rt.name referenced_table,CONVERT(int,f.is_disabled) disabled,CONVERT(int,f.is_not_trusted) untrusted,CONVERT(int,f.is_not_for_replication) [replication],f.delete_referential_action delete_action,f.update_referential_action update_action ${tables} JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id JOIN sys.tables rt ON rt.object_id=f.referenced_object_id WHERE ${tableFilter}`,
    foreignColumns: `SELECT t.name table_name,${foreignName}${selectors.normalizeSystemNames?' name':''},fc.constraint_column_id ordinal,c.name column_name,rc.name referenced_column ${tables} JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE ${tableFilter}`,
    triggers: `SELECT t.name table_name,tr.name,tr.type,CONVERT(int,tr.is_disabled) disabled,CONVERT(int,tr.is_instead_of_trigger) [instead],CONVERT(int,tr.is_not_for_replication) [replication],CONVERT(int,m.uses_ansi_nulls) ansi_nulls,CONVERT(int,m.uses_quoted_identifier) quoted_identifier,${rawDefinition("OBJECT_DEFINITION(tr.object_id)")} definition ${tables} JOIN sys.triggers tr ON tr.parent_id=t.object_id LEFT JOIN sys.sql_modules m ON m.object_id=tr.object_id WHERE ${tableFilter}`,
    properties: `SELECT t.name table_name,c.name column_name,ep.name,CONVERT(nvarchar(128),SQL_VARIANT_PROPERTY(ep.value,'BaseType')) value_type,CONVERT(nvarchar(max),ep.value) value ${tables} JOIN sys.extended_properties ep ON ep.class=1 AND ep.major_id=t.object_id LEFT JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=ep.minor_id WHERE ${tableFilter}`,
  };
}
function stable(rows) { return rows.map(row=>({...row})).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0); }
async function capture(pool, selectors, collation) {
  const result = {};
  for(const [name,query] of Object.entries(queries(selectors))){
    const rows=(await pool.request().input("expected","{}").query(query)).recordset;
    result[name]=stable(rows.map(row=>{const value=name==='columns'&&row.collation===collation?{...row,collation:'$DATABASE_DEFAULT'}:{...row};for(const field of definitionFields[name]??[])value[field]=structuralNewlines(value[field]);return value;}));
  }
  const shape={selectors,...result};return{...shape,fingerprintAlgorithm,fingerprints:await fingerprints(pool,shape)};
}
function columnMapSql(manifest){
 const map=manifest.columns.map(({table_name,name,collation})=>({table_name,name,collation}));
 const variants=[];
 for(const[category,names]of Object.entries(definitionFields))for(const row of manifest[category])for(const field of names){
  const value=row[field];if(value===null)continue;const canonical=structuralNewlines(value),windows=structuralNewlines(value,'\r\n');assert.equal(value,canonical,'Noncanonical metadata definition');
  if(canonical!==windows)variants.push({category,table_name:row.table_name,name:row.name,field,canonical,lf_hash:createHash('sha256').update(Buffer.from(canonical,'utf16le')).digest('hex'),windows_hash:createHash('sha256').update(Buffer.from(windows,'utf16le')).digest('hex')});
 }
 return `DECLARE @expectedColumns TABLE(table_name nvarchar(128) NOT NULL,name nvarchar(128) NOT NULL,collation nvarchar(128) NULL,PRIMARY KEY(table_name,name));
 INSERT @expectedColumns SELECT table_name,name,collation FROM OPENJSON(${literal(JSON.stringify(map))}) WITH(table_name nvarchar(128) '$.table_name',name nvarchar(128) '$.name',collation nvarchar(128) '$.collation');
 DECLARE @definitionVariants TABLE(category varchar(24),table_name nvarchar(128),name nvarchar(128),field varchar(32),canonical nvarchar(max),lf_hash binary(32),windows_hash binary(32),PRIMARY KEY(category,table_name,name,field));
 INSERT @definitionVariants SELECT category,table_name,name,field,canonical,CONVERT(binary(32),lf_hash,2),CONVERT(binary(32),windows_hash,2) FROM OPENJSON(${literal(JSON.stringify(variants))}) WITH(category varchar(24),table_name nvarchar(128),name nvarchar(128),field varchar(32),canonical nvarchar(max),lf_hash varchar(64),windows_hash varchar(64));`;
}
function fingerprintSelects(manifest){
 const selects=queries(manifest.selectors,true),result={};
  for(const [name,definition] of Object.entries(fields)){
    assert(Array.isArray(manifest[name]),'Missing metadata '+name);
    const columns=definition.split(',').map(field=>field.split(':'));
    const variants=definitionFields[name]??[];
    const projected=columns.map(([key,type])=>{const index=variants.indexOf(key),value=index<0?`current_shape.[${key}]`:`CASE WHEN variant${index}.category IS NOT NULL THEN variant${index}.canonical ELSE current_shape.[${key}] END`;return `CONVERT(${type==='s'?'nvarchar(max)':'int'},${value}) AS [${key}]`;}).join(',');
    const joins=variants.map((field,index)=>` OUTER APPLY(SELECT category,canonical FROM @definitionVariants v WHERE v.category=N'${name}' AND v.table_name=current_shape.table_name AND v.name=current_shape.name AND v.field=N'${field}' AND HASHBYTES('SHA2_256',CONVERT(varbinary(max),current_shape.[${field}])) IN(v.lf_hash,v.windows_hash)) variant${index}`).join('');
    const order=metadataOrder(manifest,name).map(key=>columns.find(([name])=>name===key)[1]==='s'?`CONVERT(nvarchar(${manifest.selectors.normalizeSystemNames?'max':'128'}),[${key}]) COLLATE Latin1_General_100_BIN2`:`[${key}]`).join(',');
    // SQL's own serializer fixes field types, property order, escaping and null
    // presence. Binary row ordering is independent of the operator collation.
    // A scalar FOR JSON subquery can be NULL for zero rows. Prove emptiness
    // independently; never coalesce a present row's NULL fields or failures.
    const json=`CASE WHEN EXISTS(SELECT 1 FROM (${selects[name]}) nonempty_shape) THEN (SELECT ${projected} FROM (${selects[name]}) current_shape${joins} ORDER BY ${order} FOR JSON PATH,INCLUDE_NULL_VALUES) ELSE N'[]' END`;
    result[name]=`CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),${json})),2)`;
  }
  return result;
}
async function fingerprints(pool,manifest){
 const parts=fingerprintSelects(manifest),sql=columnMapSql(manifest)+'\n'+Object.entries(parts).map(([name,expression])=>`SELECT N'${name}' category,${expression} fingerprint;`).join('\n');
 const result=await pool.request().batch(sql),rows=result.recordsets.flat();assert.equal(rows.length,Object.keys(fields).length);
 const hashes=Object.fromEntries(rows.map(row=>{assert(/^[A-F0-9]{64}$/.test(row.fingerprint),'Invalid catalogue fingerprint '+row.category+': '+String(row.fingerprint));return[row.category,row.fingerprint];}));
 for(const name of Object.keys(fields))assert.equal(hashes[name],manifestFingerprint(manifest,name),'SQL/manifest catalogue serialization differs: '+name);
 return hashes;
}
function manifestFingerprint(manifest,name){
 const columns=fields[name].split(',').map(field=>field.split(':'));
 const rows=manifest[name].map(row=>{assert.equal(Object.keys(row).length,columns.length,'Unexpected metadata fields '+name);return Object.fromEntries(columns.map(([key,type])=>{assert(Object.hasOwn(row,key),'Missing metadata property '+name+'.'+key);const value=row[key];assert(value===null||(type==='s'?typeof value==='string':Number.isSafeInteger(value)),'Invalid metadata type '+name+'.'+key);return[key,value];}));});
  const compare=(a,b)=>{for(const key of metadataOrder(manifest,name)){if(a[key]===b[key])continue;if(a[key]===null)return-1;if(b[key]===null)return 1;return a[key]<b[key]?-1:1;}return 0;};
 const json=JSON.stringify(rows.sort(compare)).replaceAll('/','\\/');
 return createHash('sha256').update(Buffer.from(json,'utf16le')).digest('hex').toUpperCase();
}
function validationSql(manifest, label) {
  assert(manifest && typeof label === "string");assert.equal(manifest.fingerprintAlgorithm,fingerprintAlgorithm,'Unknown catalogue fingerprint protocol');
  const result=[columnMapSql(manifest),'DECLARE @fingerprint varchar(64);'];
  for(const[name,expression]of Object.entries(fingerprintSelects(manifest))){
    const expected=manifest.fingerprints?.[name];assert(/^[A-F0-9]{64}$/.test(expected),'Missing reviewed fingerprint '+name);
    assert.equal(expected,manifestFingerprint(manifest,name),'Inspectable manifest/fingerprint mismatch: '+name);
    result.push(`SET @fingerprint=${expression};\nIF @fingerprint IS NULL OR @fingerprint<>${literal(expected)} THROW 51028,${literal(`Unrecognized ${label} ${name}; the entire update was rolled back.`)},1;`);
  }
  return canonical(result.join("\n"));
}
module.exports={fields,queries,capture,validationSql,stable,literal,fingerprints,fingerprintAlgorithm,fingerprintSelects,manifestFingerprint,structuralNewlines};
