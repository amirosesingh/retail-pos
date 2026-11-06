'use strict';
// Main-owned original-TX evidence only. This writes no business stock, creates
// no key and grants no author/clock/coverage authority to an unsigned cohort.
const {createHash}=require('node:crypto');
const contract=require('./stock-history-contract.cjs');
const protocol=require('../security/stock-event-author-protocol.cjs');
async function persistSourceCohort(store,tx,{rows,manifests,author,databaseKey,assertCurrent}){
 if(!rows.length||!author?.signSourceCohort||['SALE','REFUND'].includes(author.action))return null;
 if(manifests.length!==rows.length||manifests.some(value=>value===null))return null;
 const first=rows[0],branch=contract.identifier(first.store_id),terminal=contract.identifier(first.terminal_id);
 if(rows.some(row=>row.store_id!==branch||row.terminal_id!==terminal||row.operation_id!==first.operation_id||row.actor_id!==first.actor_id))return null;
 const database=contract.identifier(databaseKey.slice(0,36),true);
 const prior=(await store.request(tx).input('cohort_database',database).input('cohort_branch',branch).input('cohort_terminal',terminal).query(`
  SELECT TOP(1) CONVERT(nvarchar(30),source_sequence) source_sequence,source_root
  FROM dbo.stock_history_source_cohorts WITH(UPDLOCK,HOLDLOCK,INDEX(UQ_stock_history_source_sequence))
  WHERE database_guid=CONVERT(uniqueidentifier,@cohort_database) AND store_id=@cohort_branch AND terminal_id=@cohort_terminal
  ORDER BY source_sequence DESC;`)).recordset?.[0];
 assertCurrent();
 const sequence=String(BigInt(prior?.source_sequence??'0')+1n);
 if(BigInt(sequence)>9223372036854775807n)contract.fail('ESTOCK_SOURCE_COHORT_OVERSIZED');
 const result=await author.signSourceCohort({operationId:first.operation_id,sourceDatabaseId:database,
  sourceSequence:sequence,sourcePredecessorRoot:prior?.source_root??null,manifests:manifests.map(value=>JSON.parse(value))});
 assertCurrent();
 const proof=protocol.normalizeStockSourceCohortProof(result?.proof),members=result?.members;
 if(proof.sourceDatabaseId!==database||proof.sourceSequence!==sequence||proof.sourcePredecessorRoot!==(prior?.source_root??null)||
  proof.operationId!==first.operation_id||proof.branchId!==branch||proof.terminalId!==terminal||proof.authorId!==first.actor_id||proof.action!==author.action||
  proof.sourceCount!==rows.length||!Array.isArray(members)||members.length!==rows.length)contract.fail('ESTOCK_AUTHOR_INVALID');
 const expected=new Map(manifests.map(value=>[JSON.parse(value).productId,value]));
 for(let index=0;index<members.length;index++){
  const member=members[index],source=JSON.parse(member.manifestJson);
  if(member.index!==index||member.count!==rows.length||member.root!==proof.sourceRoot||expected.get(source.productId)!==member.manifestJson)
   contract.fail('ESTOCK_AUTHOR_INVALID');
  expected.delete(source.productId);
 }
 if(expected.size)contract.fail('ESTOCK_AUTHOR_INVALID');
 const id=contract.stableId(['stock-history.source-cohort.v1',first.operation_id,branch]);
 const aggregate=contract.uploadAggregateId(first.operation_id,branch),proofJson=JSON.stringify(proof),membersJson=JSON.stringify(members);
 const body=JSON.stringify([1,id,first.operation_id,branch,terminal,first.actor_id,author.action,proof.sourceRoot,proof.sourceCount,
  database,sequence,proof.sourcePredecessorRoot,proofJson,membersJson,aggregate,first.recorded_at_raw]);
 // Keep the complete immutable source set, not just the first upload page.
 if(Buffer.byteLength(membersJson,'utf8')>12*1024*1024)contract.fail('ESTOCK_SOURCE_COHORT_OVERSIZED');
 const hash=createHash('sha256').update(body,'utf8').digest('hex');
 await store.request(tx).input('cohort_id',id).input('cohort_operation',first.operation_id).input('cohort_branch',branch).input('cohort_terminal',terminal)
  .input('cohort_actor',first.actor_id).input('cohort_action',author.action).input('cohort_root',proof.sourceRoot).input('cohort_count',proof.sourceCount)
  .input('cohort_database',database).input('cohort_sequence',sequence).input('cohort_previous',proof.sourcePredecessorRoot)
  .input('cohort_proof',proofJson).input('cohort_members',membersJson).input('cohort_hash',hash).input('cohort_aggregate',aggregate).input('cohort_at',first.recorded_at_raw)
  .query(`INSERT dbo.stock_history_source_cohorts(id,operation_id,store_id,terminal_id,actor_id,action,source_root,source_count,database_guid,
   source_sequence,predecessor_root,proof_json,members_json,payload_hash,upload_aggregate_id,recorded_at_raw)
   VALUES(CONVERT(uniqueidentifier,@cohort_id),CONVERT(uniqueidentifier,@cohort_operation),@cohort_branch,@cohort_terminal,@cohort_actor,
    @cohort_action,@cohort_root,@cohort_count,CONVERT(uniqueidentifier,@cohort_database),CONVERT(bigint,@cohort_sequence),@cohort_previous,
    @cohort_proof,@cohort_members,@cohort_hash,CONVERT(uniqueidentifier,@cohort_aggregate),@cohort_at);`);
 assertCurrent();return Object.freeze({id,count:rows.length,root:proof.sourceRoot,sequence});
}
module.exports={persistSourceCohort};
