import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const {JobManager}=createRequire(import.meta.url)('../../../electron/jobs/manager.cjs');
function harness(){
 const jobs=new Map<string,Record<string,unknown>>(),events:Record<string,unknown>[]=[];
 const repository={create:async(job:Record<string,unknown>)=>jobs.set(String(job.job_id),{...job}),checkpoint:async(id:string,patch:Record<string,unknown>)=>{Object.assign(jobs.get(id)!,patch);}};
 const manager=new JobManager(repository,{publish:(event:Record<string,unknown>)=>events.push(event)});
 return{manager,jobs,events};
}
describe('explicit opt-in bounded background job steps',()=>{
 it('persists pending progress and releases the running slot without a completion marker',async()=>{
  const h=harness();const result=await h.manager.runStep('history_index_v1',async(context:{checkpoint:(value:Record<string,unknown>)=>Promise<void>})=>{await context.checkpoint({phase:'index',last_committed_cursor:'cursor'});return{pending:true};});
  expect(result).toMatchObject({pending:true,status:'queued'});expect(h.manager.running).toBe(null);expect(h.jobs.get(result.job_id)).toMatchObject({status:'queued',finished_at:null,last_committed_cursor:'cursor'});expect(h.events.some(x=>x.status==='completed')).toBe(false);
 });
 it('resumes the same durable job and completes only when explicitly confirmed',async()=>{
  const h=harness();const pending=await h.manager.runStep('history_index_v1',async()=>({pending:true,status:'retrying'}));const existing=h.jobs.get(pending.job_id)!;
  const done=await h.manager.runStep('history_index_v1',async()=>({completed:true}),existing);expect(done.status).toBe('completed');expect(h.jobs.size).toBe(1);expect(h.jobs.get(done.job_id)?.finished_at).toBeInstanceOf(Date);
 });
 it('does not change ordinary run completion behavior even for a pending-looking return',async()=>{const h=harness();const result=await h.manager.run('existing_job',async()=>({pending:true}));expect(result.status).toBe('completed');});
 it('retains the previous retry warning until the opted-in handler commits successful progress',async()=>{const h=harness();const initial=await h.manager.runStep('history_index_v1',async()=>({pending:true}));const existing=h.jobs.get(initial.job_id)!;Object.assign(existing,{error_code:'EOFFLINE',error_message:'Prior connection failure'});await h.manager.runStep('history_index_v1',async()=>({pending:true,status:'retrying'}),existing);expect(h.jobs.get(initial.job_id)).toMatchObject({status:'retrying',error_code:'EOFFLINE',error_message:'Prior connection failure'});});
 it('refuses unproven or malformed completion and preserves an actual failed state',async()=>{for(const outcome of [undefined,{pending:'true'},{pending:true,status:'completed'}]){const h=harness();await expect(h.manager.runStep('history_index_v1',async()=>outcome)).rejects.toMatchObject({code:'EJOB_STEP_INVALID'});expect([...h.jobs.values()][0].status).toBe('failed');expect(h.manager.running).toBe(null);}});
 it('retains manual pause and never invokes the automatic handler',async()=>{const h=harness();h.manager.pause();let calls=0;expect(await h.manager.runStep('history_index_v1',async()=>{calls++;return{completed:true};})).toMatchObject({pending:true,paused:true});expect(calls).toBe(0);expect(h.manager.paused).toBe(true);expect(h.jobs.size).toBe(0);});
 it('does not adopt, complete or modify another running job',async()=>{const h=harness();h.manager.running={job_id:'unrelated',status:'running'};let calls=0;expect(await h.manager.runStep('history_index_v1',async()=>{calls++;return{completed:true};})).toMatchObject({pending:true,busy:true});expect(calls).toBe(0);expect(h.manager.running).toEqual({job_id:'unrelated',status:'running'});expect(h.jobs.size).toBe(0);});
 it('does not write completion or failure into a changed database/profile',async()=>{const h=harness();let bound=true;
  await expect(h.manager.runStep('history_index_v1',async()=>{bound=false;return{completed:true};},null,{}, {checkpointAllowed:()=>bound})).rejects.toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});
  expect([...h.jobs.values()][0].status).toBe('running');expect(h.events.some(x=>x.status==='completed'||x.status==='failed')).toBe(false);expect(h.manager.running).toBe(null);
 });
});
