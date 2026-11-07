// Main-only history read protocol. Identity membership is not an upload receipt,
// financial proof or full-row equality witness.
const { parseExactJson, instant } = require('./shift-recovery-exact.mjs');
const { recordId } = require('./uuid-fields.cjs');
const {POLICY,visibleHistoryRow}=require('./history-read-scope.cjs');
const INDEX = 'history-index-v2', ROWS = 'history-rows-v2';
const PROJECTION = 'history-project-v1:a5be97695f3e105ebde271e2f017ddee';
const MAX_INDEX = 1000, MAX_ROWS = 10, MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INDEX_KEYS = ['protocol','projection','policy','history_scope','organization_id','branch_id','terminal_id','keep_commerce','action','upper_id','after_id','ids','next_id','complete','range_count'];
const ROW_KEYS = ['protocol','projection','policy','history_scope','organization_id','branch_id','terminal_id','keep_commerce','requested_ids','rows','remaining_ids'];
const WIRE_COLUMNS = ['id','organization_id','entity_type','entity_id','action','old_value_json','new_value_json','revision','scope_type','scope_id','changed_by','source_application','device_id','terminal_id','server_timestamp'];
const NULLABLE = new Set(['old_value_json','new_value_json','scope_id','changed_by','device_id','terminal_id']);
const failure = () => Object.assign(new Error('The protected history reconciliation response is invalid; its progress remains pending.'), {code:'EHISTORY_INDEX_PROTOCOL',table:'change_history'});
function object(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))) throw failure();
  return value;
}
function text(value, max=MAX_BYTES) { if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>max)throw failure();return value; }
function uuid(value) { if(typeof value!=='string'||!UUID.test(value))throw failure();return value; }
function uuidOrNull(value) { return value===null?null:uuid(value); }
function ids(values,max) { if(!Array.isArray(values)||values.length>max||new Set(values.map(uuid)).size!==values.length)throw failure();return values; }
function scope(value, expected, adoptMode=false) {
  if(value.policy!==POLICY||value.history_scope!==(expected.historyScope??'branch')||value.projection!==PROJECTION||value.organization_id!==expected.organizationId||value.branch_id!==expected.branchId||
    value.terminal_id!==expected.terminalId||typeof value.keep_commerce!=='boolean'||
    !(adoptMode&&expected.keepCommerce===undefined)&&value.keep_commerce!==expected.keepCommerce)throw failure();
}
function normalizeIndex(value, expected, request) {
  object(value,INDEX_KEYS);scope(value,expected,request.action==='begin');
  if(value.protocol!==INDEX||!['begin','page','finish'].includes(request.action)||value.action!==request.action)throw failure();
  uuidOrNull(value.upper_id);uuidOrNull(value.after_id);uuidOrNull(value.next_id);ids(value.ids,MAX_INDEX);
  if(typeof value.complete!=='boolean'||value.after_id!==(request.afterId??null)||
    (request.action!=='begin'&&value.upper_id!==request.upperId)||
    value.after_id!==null&&(value.upper_id===null||value.after_id>value.upper_id))throw failure();
  if(request.action==='finish') {
    if(value.ids.length||value.next_id!==null||!value.complete||value.after_id!==null||typeof value.range_count!=='string'||
      value.range_count.length>19||!/^(?:0|[1-9][0-9]*)$/.test(value.range_count)||BigInt(value.range_count)>9223372036854775807n)throw failure();
  } else {
    if(value.range_count!==null)throw failure();
    let previous=value.after_id;
    for(const id of value.ids){if(value.upper_id===null||id>value.upper_id||previous!==null&&id<=previous)throw failure();previous=id;}
    if(value.complete?value.next_id!==null:!value.ids.length||value.next_id!==value.ids.at(-1))throw failure();
    if(value.upper_id===null&&(value.ids.length||!value.complete||value.after_id!==null))throw failure();
  }
  return Object.freeze({...value,ids:Object.freeze([...value.ids])});
}
function normalizeRow(row) {
  object(row,WIRE_COLUMNS);uuid(row.id);
  for(const name of WIRE_COLUMNS){const value=row[name];if(value===null){if(!NULLABLE.has(name))throw failure();}else text(value);}
  if(Buffer.byteLength(row.organization_id,'utf16le')>900||row.revision.length>20||! /^-?(?:0|[1-9][0-9]*)$/.test(row.revision)||row.revision==='-0'||
    BigInt(row.revision)<-9223372036854775808n||BigInt(row.revision)>9223372036854775807n||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(row.server_timestamp)||row.server_timestamp.startsWith('0000-')||instant(row.server_timestamp)===undefined)throw failure();
  for(const name of ['old_value_json','new_value_json'])if(row[name]!==null) {
    try{parseExactJson(row[name],{maxBytes:MAX_BYTES,maxDepth:128});}catch{throw failure();}
  }
  // Preserve the native UUID normalizer's applicable scalar identifier rules;
  // JSON text remains lossless, never reserialized by JSON.stringify.
  return Object.freeze(Object.fromEntries(WIRE_COLUMNS.map(name=>[name,name==='id'||name.endsWith('_id')?recordId(row[name]):row[name]])));
}
function normalizeRows(value, expected, requestedIds) {
  ids(requestedIds,MAX_ROWS);if(!requestedIds.length)throw failure();
  object(value,ROW_KEYS);scope(value,expected);
  if(value.protocol!==ROWS||JSON.stringify(value.requested_ids)!==JSON.stringify(requestedIds)||!Array.isArray(value.rows)||
      value.rows.length<1||value.rows.length>requestedIds.length||JSON.stringify(value.remaining_ids)!==JSON.stringify(requestedIds.slice(value.rows.length)))throw failure();
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_BYTES)throw failure();
  const rows=value.rows.map(normalizeRow);
  if(rows.some((row,index)=>row.id!==requestedIds[index]||!visibleHistoryRow(row,{...expected,historyScope:expected.historyScope??'branch'})))throw failure();
  return Object.freeze({...value,requested_ids:Object.freeze([...requestedIds]),rows:Object.freeze(rows),remaining_ids:Object.freeze([...value.remaining_ids])});
}
module.exports={INDEX,ROWS,PROJECTION,MAX_INDEX,MAX_ROWS,MAX_BYTES,WIRE_COLUMNS,normalizeIndex,normalizeRows};
