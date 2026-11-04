// Recovery-only comparison. Ordinary sync's existing sameRow is unchanged.
// Numeric tokens must originate from lossless JSON parsing or SQL text casts.
const recordId = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : value;
class ExactNumber { constructor(raw) { this.raw=raw; Object.freeze(this); } }
const witnesses=new WeakMap();
function parseExactJson(text,{maxBytes=6*1024*1024,maxDepth=128}={}) {
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>maxBytes)throw new Error('Exact JSON exceeds its bounded input');
  let at=0;const number=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const whitespace=()=>{while(true){const ch=text.charCodeAt(at);if(ch!==32&&ch!==9&&ch!==10&&ch!==13)break;at++;}};
  function string(){const start=at++;while(at<text.length){const ch=text[at++];if(ch==='"')return JSON.parse(text.slice(start,at));if(ch==='\\')at++;}throw new Error('Unterminated JSON string');}
  function value(depth){
    if(depth>maxDepth)throw new Error('Exact JSON exceeds its depth limit');whitespace();const ch=text[at];
    if(ch==='"')return string();
    if(ch==='{'||ch==='['){const object=ch==='{'?Object.create(null):[];const seen=new Set();at++;whitespace();const end=ch==='{'?'}':']';if(text[at]===end){at++;return object;}
      while(at<text.length){whitespace();let key;if(ch==='{'){if(text[at]!=='"')throw new Error('Invalid JSON key');key=string();if(seen.has(key))throw new Error('Duplicate JSON key');seen.add(key);whitespace();if(text[at++]!==':')throw new Error('Invalid JSON colon');}
        const item=value(depth+1);if(ch==='{')object[key]=item;else object.push(item);whitespace();if(text[at]===end){at++;return object;}if(text[at++]!==',')throw new Error('Invalid JSON separator');}
      throw new Error('Unterminated JSON container');}
    for(const [word,result] of [['true',true],['false',false],['null',null]])if(text.startsWith(word,at)){at+=word.length;return result;}
    number.lastIndex=at;const match=number.exec(text);
    if(match){at+=match[0].length;return new ExactNumber(match[0]);}
    throw new Error('Invalid exact JSON value');
  }
  const result=value(0);whitespace();if(at!==text.length)throw new Error('Trailing exact JSON data');return result;
}
function decimal(raw){
  if(raw instanceof ExactNumber)raw=raw.raw;
  if(typeof raw!=='string'||raw.length>1024)return undefined;
  const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if(!m||Math.abs(Number(m[4]??0))>1000)return undefined;
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,'')||'0',exponent=Number(m[4]??0)-(m[3]?.length??0);
  while(digits!=='0'&&digits.endsWith('0')){digits=digits.slice(0,-1);exponent++;}
  return digits==='0'?'0':`${m[1]==='-'?'-':''}${digits}e${exponent}`;
}
function instant(raw){
  // A Date has already discarded submillisecond evidence and is never proof.
  if(typeof raw!=='string')return undefined;
  const m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if(!m||Number(m[1])<1||Number(m[4])>23||Number(m[5])>59||Number(m[6])>59)return undefined;
  const base=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`,ms=Date.parse(base);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==base)return undefined;
  let offset=0;if(m[8]!=='Z'){const hours=Number(m[8].slice(1,3)),minutes=Number(m[8].slice(4));if(hours>14||minutes>59||hours===14&&minutes!==0)return undefined;offset=(hours*60+minutes)*(m[8][0]==='-'?-1:1);}
  return String(BigInt(ms)*10000n-BigInt(offset)*600000000n+BigInt((m[7]??'').padEnd(7,'0')));
}
function tree(value){
  if(value instanceof ExactNumber){const n=decimal(value);if(n===undefined)throw new Error('Unprovable JSON number');return ['number',n];}
  if(typeof value==='number')throw new Error('Rounded JSON numbers cannot prove equality');
  if(value===null||typeof value==='string'||typeof value==='boolean')return [typeof value,value];
  if(Array.isArray(value))return ['array',value.map(tree)];
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,tree(value[k])])];
  throw new Error('Unprovable JSON value');
}
function cell(column,value,{local=false}={}){
  if(value===null)return ['null'];if(value===undefined)throw new Error('Missing registered fact');
  const type=String(column.cloudType).toLowerCase();
  if(/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type)){
    if(local&&typeof value==='string'||value instanceof ExactNumber){const n=decimal(value);if(n!==undefined)return ['numeric',n];}
    throw new Error('Numeric equality requires unrounded source tokens');
  }
  if(/^timestamp/.test(type)){const stamp=instant(value);if(stamp===undefined)throw new Error('Unprovable timestamp');return ['timestamp',stamp];}
  if(type==='date'){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||instant(value+'T00:00:00Z')===undefined)throw new Error('Unprovable date');return ['date',value];}
  if(type==='uuid'){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('Unprovable UUID');return ['uuid',recordId(value)];}
  if(type==='boolean'){if(local&&[0,1].includes(value))value=Boolean(value);if(typeof value!=='boolean')throw new Error('Unprovable boolean');return ['boolean',value];}
  if(type==='jsonb'||type.endsWith('[]'))return tree(local&&typeof value==='string'?parseExactJson(value):value);
  if(typeof value!=='string')throw new Error('Unprovable text');return ['text',value];
}
function projection(table,alias='source'){
  if(!/^[a-z_][a-z0-9_]*$/i.test(alias))throw new Error('Untrusted SQL alias');
  return table.columns.map(c=>{const name=c.sqlServerColumn;if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw new Error('Untrusted SQL column');const type=String(c.sqlServerType).toLowerCase();const expr=`${alias}.[${name}]`;
    return /^(decimal|numeric|money|smallmoney|bigint|int|smallint|tinyint|float|real)/.test(type)?`CONVERT(nvarchar(100),${expr}${/^(float|real)/.test(type)?',3':''}) AS [${name}]`:/^(datetime|date|time)/.test(type)?`CONVERT(nvarchar(40),${expr},127) AS [${name}]`:expr;}).join(',');
}
function exactRows(table,local,remote){
  if(!Array.isArray(local)||!Array.isArray(remote)||local.length!==remote.length||local.length>2000)return false;
  try{
    const ids=new Set();const encode=(row,isLocal)=>JSON.stringify(table.columns.map(c=>cell(c,row[isLocal?c.sqlServerColumn:c.cloudColumn],{local:isLocal})));
    const expected=new Map(remote.map(row=>{const id=recordId(row.id);if(typeof id!=='string'||ids.has(id))throw new Error('Duplicate row');ids.add(id);return[id,encode(row,false)];}));
    const seen=new Set();return local.every(row=>{const id=recordId(row.id);if(seen.has(id))return false;seen.add(id);return expected.get(id)===encode(row,true);});
  }catch{return false;}
}
function stringifyExactJson(value,{maxBytes=6*1024*1024,maxDepth=128}={}){
  const active=new Set();
  function emit(item,depth){
    if(depth>maxDepth)throw new Error('Exact JSON exceeds its depth limit');
    if(item instanceof ExactNumber){if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(item.raw))throw new Error('Invalid exact numeric token');return item.raw;}
    if(item===null||typeof item==='boolean'||typeof item==='string')return JSON.stringify(item);
    if(!item||typeof item!=='object'||active.has(item))throw new Error('Unprovable exact JSON output');
    active.add(item);let output;
    const own=key=>{const descriptor=Object.getOwnPropertyDescriptor(item,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new Error('Untrusted exact JSON accessor');return descriptor.value;};
    if(Array.isArray(item))output='['+Array.from({length:item.length},(_,index)=>emit(own(String(index)),depth+1)).join(',')+']';
    else if(Object.getPrototypeOf(item)===null||Object.getPrototypeOf(item)===Object.prototype)output='{'+Object.keys(item).map(key=>JSON.stringify(key)+':'+emit(own(key),depth+1)).join(',')+'}';
    else throw new Error('Untrusted exact JSON output object');
    active.delete(item);return output;
  }
  const result=emit(value,0);if(new TextEncoder().encode(result).byteLength>maxBytes)throw new Error('Exact JSON exceeds its bounded output');return result;
}
async function boundedText(response,maxBytes=6*1024*1024+16*1024){
  if(!response.body?.getReader){const text=await response.text();if(new TextEncoder().encode(text).byteLength>maxBytes)throw new Error('Exact JSON exceeds its bounded input');return text;}
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes)throw new Error('Exact JSON exceeds its bounded input');chunks.push(part.value);}const output=new Uint8Array(bytes);let offset=0;for(const part of chunks){output.set(part,offset);offset+=part.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(output);}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
function rememberGraph(graph,raw,capability){
  if(capability!=='1')return graph;
  const exact=parseExactJson(raw,{maxBytes:6*1024*1024+16*1024}),shape=JSON.stringify(graph);
  if(!graph||typeof graph!=='object'||!exact||typeof exact!=='object')throw new Error('Missing exact closing response');
  witnesses.set(graph,{exact,shape,bytes:new TextEncoder().encode(raw).byteLength+new TextEncoder().encode(shape).byteLength});return graph;
}
function exactGraph(graph,branch,shift){
  const proof=witnesses.get(graph);
  if(!proof||JSON.stringify(graph)!==proof.shape||proof.exact.ok!==true||decimal(proof.exact.shiftGraphVersion)!=='1e0'||recordId(proof.exact.branchId)!==recordId(branch)||recordId(proof.exact.shiftId)!==recordId(shift)||proof.exact.graphToken!==graph.graphToken||proof.exact.closedAtRaw!==graph.closedAtRaw)return null;
  return proof.exact;
}
function witnessBytes(graph){return witnesses.get(graph)?.bytes??0;}
const isExactNumber=value=>value instanceof ExactNumber;
export {parseExactJson,stringifyExactJson,isExactNumber,decimal,instant,projection,exactRows,boundedText,rememberGraph,exactGraph,witnessBytes};
