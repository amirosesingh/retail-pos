// Freeze new business writes only after the renderer has parked its audit buffer.
// Already accepted transactions must settle before the final sync checkpoint.
class WriteBarrier {
  constructor() { this.sealed=false; this.active=new Set(); }
  run(work) {
    if(this.sealed)return Promise.resolve({ok:false,code:"EAPP_CLOSING",error:"The application is synchronizing before closing. Retry if closing is cancelled."});
    const operation=Promise.resolve().then(work);
    this.active.add(operation);
    operation.then(()=>this.active.delete(operation),()=>this.active.delete(operation));
    return operation;
  }
  async sealAndDrain() { this.sealed=true; await Promise.allSettled([...this.active]); }
  reopen() { this.sealed=false; }
}
const BUSINESS_WRITE_CHANNELS = new Set([
  "print:silent", "print:raw", "drawer:open", "pos:write", "pos:write-batch",
  "business:reserve-bill", "business:write-batch", "business:commit-aggregate", "business:save-authorization-rule",
  "business:shift-close-start", "business:shift-close-count", "business:shift-recount",
  "business:shift-variance-approve", "receipts:refund",
]);
module.exports={WriteBarrier,BUSINESS_WRITE_CHANNELS};
