const { safeError } = require("./errors.cjs");
const { loadRegistry } = require("./schema-registry.cjs");
const fs = require("node:fs");
const path = require("node:path");
const normalizeSqlExpression = (value) => String(value ?? "").replace(/[()\s]/g, "").toLowerCase();

function requiredIndexes() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "database", "sqlserver", "schema.sql"), "utf8");
  const indexes = [];
  const pattern = /CREATE\s+(UNIQUE\s+)?INDEX\s+\[([^\]]+)\]\s+ON\s+dbo\.\[([^\]]+)\]\s*\(([^)]+)\)(?:\s+WHERE\s+([^;]+))?;/gi;
  for (const match of schema.matchAll(pattern)) indexes.push({
    unique: Boolean(match[1]), name: match[2], table: match[3],
    columns: [...match[4].matchAll(/\[([^\]]+)\]/g)].map((item) => item[1].toLowerCase()),
    filter: normalizeSqlExpression(match[5]),
  });
  return indexes;
}

async function validateDatabase(manager, profile) {
  try {
    const registry = loadRegistry();
    return await manager.temporary(profile, profile.database, async (pool) => {
      const catalog = await pool.request().query(`SELECT t.name AS table_name, c.name AS column_name,
        ty.name AS data_type, c.max_length, c.precision, c.scale, c.is_nullable,
        dc.definition AS default_definition
        FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
        JOIN sys.columns c ON c.object_id=t.object_id
        JOIN sys.types ty ON ty.user_type_id=c.user_type_id
        LEFT JOIN sys.default_constraints dc ON dc.parent_object_id=c.object_id AND dc.parent_column_id=c.column_id
        WHERE s.name='dbo' ORDER BY t.name,c.column_id;`);
      const actual = new Map();
      for (const row of catalog.recordset ?? []) {
        if (!actual.has(row.table_name)) actual.set(row.table_name, new Map());
        actual.get(row.table_name).set(row.column_name, row);
      }
      const keyRows = await pool.request().query(`SELECT t.name table_name,i.name index_name,i.is_primary_key,i.is_unique,i.has_filter,i.filter_definition,c.name column_name,ic.key_ordinal
        FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id>0 AND i.is_hypothetical=0
        JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
        WHERE s.name='dbo' AND ic.key_ordinal>0;`);
      const foreignRows = await pool.request().query(`SELECT pt.name table_name,pc.name column_name,rt.name referenced_table,rc.name referenced_column
        FROM sys.foreign_key_columns fkc JOIN sys.tables pt ON pt.object_id=fkc.parent_object_id JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
        JOIN sys.columns pc ON pc.object_id=pt.object_id AND pc.column_id=fkc.parent_column_id JOIN sys.tables rt ON rt.object_id=fkc.referenced_object_id
        JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fkc.referenced_column_id WHERE ps.name='dbo';`);
      const keys=keyRows.recordset??[], foreignKeys=foreignRows.recordset??[];
      const actualIndexes = new Map();
      for (const row of keys) {
        const id = `${String(row.table_name).toLowerCase()}.${String(row.index_name).toLowerCase()}`;
        const index = actualIndexes.get(id) ?? { unique:Boolean(row.is_unique), columns:[], filter:normalizeSqlExpression(row.filter_definition) };
        index.columns[Number(row.key_ordinal)-1] = String(row.column_name).toLowerCase();
        actualIndexes.set(id,index);
      }
      const normalizeType=(row)=>{const name=String(row.data_type).toLowerCase();if(["nvarchar","varchar","varbinary"].includes(name))return `${name}(${row.max_length===-1?"max":name.startsWith("n")?row.max_length/2:row.max_length})`;if(["decimal","numeric"].includes(name))return `${name}(${row.precision},${row.scale})`;if(["datetime2","datetimeoffset","time"].includes(name))return `${name}(${row.scale})`;return name;};
      const normalizeDefault=(value)=>{let text=String(value??"").trim().toLowerCase().replace(/\s+/g,"");while(text.startsWith("(")&&text.endsWith(")"))text=text.slice(1,-1);return text.replace(/^n'/,"'");};
      const details = [];
      const differences = [];
      for (const table of registry.tables ?? []) {
        const columns = actual.get(table.sqlServerTable ?? table.name);
        const tableName=table.sqlServerTable??table.name;
        const missingColumns = [], incompatible=[];
        if(!columns)differences.push({kind:"table",table:tableName,object:tableName,issue:"missing",expected:"table present",actual:"not found"});
        for(const column of table.columns??[]){const name=column.sqlServerColumn??column.name;const found=columns?.get(name);if(!found){missingColumns.push(name);differences.push({kind:"column",table:tableName,object:name,issue:"missing",expected:column.sqlServerType,actual:"not found"});continue;}
          if(normalizeType(found)!==String(column.sqlServerType).toLowerCase()){incompatible.push(`${name}:type`);differences.push({kind:"column",table:tableName,object:name,issue:"type",expected:String(column.sqlServerType).toLowerCase(),actual:normalizeType(found)});}
          if(Boolean(found.is_nullable)!==Boolean(column.nullable)){incompatible.push(`${name}:nullability`);differences.push({kind:"column",table:tableName,object:name,issue:"nullability",expected:column.nullable?"nullable":"not nullable",actual:found.is_nullable?"nullable":"not nullable"});}
          if(column.defaultRule&&normalizeDefault(column.defaultRule)!==normalizeDefault(found.default_definition)){incompatible.push(`${name}:default`);differences.push({kind:"constraint",table:tableName,object:name,issue:"default",expected:String(column.defaultRule),actual:found.default_definition??"missing"});}
          if(column.primaryKey&&!keys.some(key=>key.table_name===tableName&&key.column_name===name&&key.is_primary_key)){incompatible.push(`${name}:primary-key`);differences.push({kind:"constraint",table:tableName,object:name,issue:"primary key missing",expected:"primary key",actual:"not found"});}
          if(column.unique&&!keys.some(key=>key.table_name===tableName&&key.column_name===name&&key.is_unique)){incompatible.push(`${name}:unique`);differences.push({kind:"constraint",table:tableName,object:name,issue:"unique constraint missing",expected:"unique",actual:"not found"});}
          if(column.foreignKey&&column.foreignKeyTarget&&!foreignKeys.some(key=>key.table_name===tableName&&key.column_name===name&&key.referenced_table===column.foreignKeyTarget.table&&key.referenced_column===column.foreignKeyTarget.column)){incompatible.push(`${name}:foreign-key`);differences.push({kind:"constraint",table:tableName,object:name,issue:"foreign key missing",expected:`${column.foreignKeyTarget.table}.${column.foreignKeyTarget.column}`,actual:"not found"});}
        }
        details.push({ table: tableName, present: Boolean(columns), missingColumns, incompatible });
      }
      for (const expected of requiredIndexes()) {
        const actualIndex=actualIndexes.get(`${expected.table.toLowerCase()}.${expected.name.toLowerCase()}`);
        if(!actualIndex)differences.push({kind:"index",table:expected.table,object:expected.name,issue:"missing",expected:`${expected.unique?"unique ":""}index (${expected.columns.join(", ")})`,actual:"not found"});
        else if(actualIndex.unique!==expected.unique||actualIndex.columns.join(",")!==expected.columns.join(",")||actualIndex.filter!==expected.filter)differences.push({kind:"index",table:expected.table,object:expected.name,issue:"definition",expected:`${expected.unique?"unique ":""}(${expected.columns.join(", ")})${expected.filter?` where ${expected.filter}`:""}`,actual:`${actualIndex.unique?"unique ":""}(${actualIndex.columns.join(", ")})${actualIndex.filter?` where ${actualIndex.filter}`:""}`});
      }
      const missingTables = details.filter((row) => !row.present).map((row) => row.table);
      const incompatibleColumns = details.flatMap((row) => [...row.missingColumns.map((column) => `${row.table}.${column}:missing`),...row.incompatible.map((issue)=>`${row.table}.${issue}`)]);
      const changeTracking = await pool.request().query("SELECT is_auto_cleanup_on, retention_period, retention_period_units_desc FROM sys.change_tracking_databases WHERE database_id=DB_ID();");
      const transaction = pool.transaction();
      await transaction.begin();
      let writeTest = false;
      try {
        await transaction.request().query("CREATE TABLE #pos_write_probe (id uniqueidentifier NOT NULL PRIMARY KEY); INSERT INTO #pos_write_probe(id) VALUES (NEWID());");
        writeTest = true;
      } finally { await transaction.rollback(); }
      if(!changeTracking.recordset?.length)differences.push({kind:"database",table:null,object:"change tracking",issue:"disabled",expected:"enabled",actual:"disabled"});
      const ready = registry.tables?.length > 0 && missingTables.length === 0 && incompatibleColumns.length === 0 && differences.filter((item)=>item.kind==="index").length===0 && writeTest && Boolean(changeTracking.recordset?.length);
      return { ok: true, ready, schemaVersion: registry.version, requiredTables: registry.tables?.length ?? 0,
        presentTables: (registry.tables?.length ?? 0) - missingTables.length, missingTables,
        columnsCompatible: incompatibleColumns.length === 0, incompatibleColumns, writeTest,
        changeTracking: Boolean(changeTracking.recordset?.length), differences, details,
        status: ready ? "ready" : actual.size ? "migration_required" : "not_pos_database" };
    });
  } catch (error) { return { ...safeError(error), ready: false, status: "error" }; }
}

module.exports = { validateDatabase };
