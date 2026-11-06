import{describe,it,expect}from'vitest';
import{normalizeStockCoverageFrontier as normalize,stockCoverageFrontierJson as json}from'../../../electron/shared/stock-coverage-frontier.mjs';
const id='ABCDEF00-0000-4000-8000-000000000001';
const fixture=()=>({version:1,projectOrigin:'https://STOCK.fixture:443/',branchId:'BranchA',terminalId:'TillA',authorId:id,databaseId:id,challengeId:id,nonce:'A'.repeat(43),cohortHash:'a'.repeat(64),
 writerRevision:'stock-history-source.v1',sourceSequence:'0',sourceRoot:null as string|null,sourceGeneration:'b'.repeat(64),gapHash:'c'.repeat(64),pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:'2026-11-06T08:00:00.1234567+08:00'});
describe('bounded original stock coverage frontier data',()=>{
 it('has stable canonical bytes while preserving non-UUID codes and exact100ns',()=>{
  const f=fixture(),value=normalize(f);expect(value.projectOrigin).toBe('https://stock.fixture');expect(value.authorId).toBe(id.toLowerCase());expect(value.branchId).toBe('BranchA');
  expect(value.observedAt).toBe('2026-11-06T00:00:00.1234567Z');expect(json(JSON.parse(json(f)))).toBe(json(f));expect(json(Object.fromEntries(Object.entries(f).reverse()))).toBe(json(f));
  expect(json({...f,branchId:'brancha'})).not.toBe(json(f));expect(normalize({...f,terminalId:id}).terminalId).toBe(id.toLowerCase());
 });
 it('retains zero and exact INT64 limits without inferring acceptance or completeness',()=>{
  const f=fixture(),maximum='9223372036854775807';expect(normalize({...f,sourceSequence:maximum,sourceRoot:'d'.repeat(64),pending:{business:maximum,metadata:'9007199254740993',unsigned:'1',unknown:'0'}}).pending.metadata).toBe('9007199254740993');
  const value=normalize(f);expect(value).not.toHaveProperty('complete');expect(value).not.toHaveProperty('verified');expect(value).not.toHaveProperty('allowed');expect(value).not.toHaveProperty('signature');
  expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.pending)).toBe(true);
 });
 it.each(['-1','+1','01','1.0','1e1','9223372036854775808',1,null])('rejects malformed/out-of-range exact counts %j',count=>{
  expect(()=>normalize({...fixture(),sourceSequence:count})).toThrow();expect(()=>normalize({...fixture(),pending:{...fixture().pending,business:count}})).toThrow();
 });
 it.each([{sourceSequence:'0',sourceRoot:'a'.repeat(64)},{sourceSequence:'1',sourceRoot:null},{sourceSequence:'1',sourceRoot:'A'.repeat(64)},
  {nonce:'A'.repeat(42)+'B'},{nonce:'A'.repeat(44)},{writerRevision:'unknown'},{cohortHash:'g'.repeat(64)},{sourceGeneration:null},{gapHash:'a'.repeat(63)}])('rejects an inconsistent prefix/protocol/nonce %j',change=>expect(()=>normalize({...fixture(),...change})).toThrow());
 it.each(['http://localhost','https://u:p@stock.fixture','https://stock.fixture/path','https://stock.fixture/?x','https://stock.fixture/#x',' https://stock.fixture'])('rejects non-project origins %s',projectOrigin=>expect(()=>normalize({...fixture(),projectOrigin})).toThrow());
 it.each(['2026-02-30T00:00:00Z','2026-11-06T00:00:00','2026-11-06T00:00:00.12345678Z','0001-01-01T00:00:00+14:00','9999-12-31T23:59:59-14:00'])('rejects ambiguous or out-of-range claimed time %s',observedAt=>expect(()=>normalize({...fixture(),observedAt})).toThrow());
 it('does not manufacture clock truth from a far past/future observation and keeps100ns differences',()=>{
  expect(normalize({...fixture(),observedAt:'2000-01-01T00:00:00.0000001Z'}).observedAt).toBe('2000-01-01T00:00:00.0000001Z');
  expect(normalize({...fixture(),observedAt:'2099-01-01T00:00:00Z'}).observedAt).toBe('2099-01-01T00:00:00.0000000Z');
  expect(json({...fixture(),observedAt:'2026-11-06T00:00:00.1234566Z'})).not.toBe(json(fixture()));
 });
 it('rejects unknown, hidden, symbol, inherited and accessor fields without evaluating getters',()=>{
  const f=fixture();for(const value of [{...f,complete:true},Object.defineProperty({...f},'hidden',{value:true}),{...f,[Symbol('x')]:true},Object.create(f),
   Object.defineProperty({...f},'nonce',{get(){throw new Error('getter evaluated');}}),{...f,pending:Object.defineProperty({...f.pending},'business',{get(){throw new Error('getter evaluated');}})}])
   expect(()=>normalize(value)).toThrowError(expect.objectContaining({code:'ESTOCK_COVERAGE_FRONTIER_INVALID'}));
 });
 it('preserves valid multibyte codes but rejects invalid UTF-8 identities and oversized scalar fields',()=>{
  expect(normalize({...fixture(),branchId:'店铺📦'}).branchId).toBe('店铺📦');expect(new TextEncoder().encode(json({...fixture(),branchId:'店'.repeat(128),terminalId:'店'.repeat(128)})).length).toBeLessThanOrEqual(8192);
  for(const branchId of ['',' x','x\ny','x'.repeat(129),'\ud800','\udc00'])expect(()=>normalize({...fixture(),branchId})).toThrow();
 });
});
