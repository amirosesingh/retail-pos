const { createHash } = require('node:crypto');
const { toCloudRow } = require('../sync/row-codec.cjs');
const protocol = require('../security/shift-author-protocol.cjs');
const fail = () => { throw Object.assign(new Error('The saved closing-start evidence could not be confirmed. Keep this shift pending for review.'), {code:'ESYNC_SHIFT_AUTHOR_INVALID',table:'shifts'}); };
const parentFields = ['id','store_id','terminal_id','opened_at','opened_by_staff_id','opened_by_name','closing_started_at','closing_started_by','close_reason'];
async function query(repository, transaction, statement, inputs) {
 const request = new (repository.connectionManager.sql().Request)(transaction);
 for(const [key,value] of Object.entries(inputs))request.input(key,value);
 return request.query(statement);
}
async function save(repository, transaction, author, {branchId,shiftId,eventId}) {
 author.assertCurrent();
 const parents=(await query(repository,transaction,'SELECT * FROM dbo.[shifts] WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;',{shift:shiftId,branch:branchId})).recordset??[];
 const events=(await query(repository,transaction,'SELECT * FROM dbo.[shift_close_events] WITH(UPDLOCK,HOLDLOCK) WHERE id=@event AND shift_id=@shift AND store_id=@branch;',{event:eventId,shift:shiftId,branch:branchId})).recordset??[];
 if(parents.length!==1||events.length!==1)fail();
 const projected=(name,row)=>JSON.parse(JSON.stringify(toCloudRow(repository.tables.get(name),row)));
 const parent=projected('shifts',parents[0]),event=projected('shift_close_events',events[0]);
 delete event.row_version;delete event.updated_at;
 if(event.event!=='closing_started'||event.actor_name!==author.subject||event.actor_staff_id!==author.subject||parent.closing_started_by!==author.subject||parent.state!=='CASH_COUNT_REQUIRED')fail();
 const payloadJson=JSON.stringify({version:1,branchId,shiftId,eventId,event,parent:Object.fromEntries(parentFields.map(key=>[key,parent[key]??null]))});
 const proof=author.signClosingStart({branchId,shiftId,eventId,payloadJson});
 await query(repository,transaction,'INSERT dbo.pos_sync_shift_closing_starts(shift_id,branch_id,event_id,proof_json) VALUES(@shift,@branch,@event,@proof);',{shift:shiftId,branch:branchId,event:eventId,proof:JSON.stringify(proof)});
 author.assertCurrent();
 return proof;
}
function parse(value,branchId,shiftId){
 let proof;try{proof=protocol.normalizeClosingStart(JSON.parse(value));}catch{fail();}
 if(proof.branchId!==branchId||proof.shiftId!==shiftId||createHash('sha256').update(proof.payloadJson,'utf8').digest('hex')!==proof.payloadHash)fail();
 return proof;
}
function assertGraph(proof,graph){
 const {canonical}=require('./repositories/aggregates.cjs');
 let payload;try{payload=JSON.parse(proof.payloadJson);}catch{fail();}
 const parent=graph.get('shifts')?.find(row=>row.id===proof.shiftId),event=graph.get('shift_close_events')?.find(row=>row.id===proof.eventId);
 if(!parent||!event||payload.eventId!==proof.eventId||payload.shiftId!==proof.shiftId||payload.branchId!==proof.branchId)fail();
 const eventFacts={...event};delete eventFacts.row_version;delete eventFacts.updated_at;
 const parentFacts=Object.fromEntries(parentFields.map(key=>[key,parent[key]??null]));
 if(JSON.stringify(canonical(payload.event))!==JSON.stringify(canonical(eventFacts))||JSON.stringify(canonical(payload.parent))!==JSON.stringify(canonical(parentFacts)))fail();
}
module.exports={save,parse,assertGraph};
